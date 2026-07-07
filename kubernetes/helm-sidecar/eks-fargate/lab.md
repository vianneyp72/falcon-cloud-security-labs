# Falcon Sidecar Injection on EKS Fargate — Serverless Kubernetes Protection

Deploy CrowdStrike Falcon on an EKS **Fargate-only** cluster (no EC2 nodes) using the sidecar injector for runtime protection, plus KAC for admission control and Image Analyzer for image scanning.

> **Performance note:** Fargate provisions a dedicated micro-VM per pod, so first-pod scheduling is slower than EC2. The injected sidecar adds to each pod's total CPU/memory request, which can push the pod up to the next Fargate size — size `container.sensorResources` deliberately.

> **Prerequisites:**
>
> - AWS account with `eksctl`, `aws` CLI, and `kubectl` installed and configured
> - Helm 3 installed (`helm version` shows v3.x)
> - Docker, Podman, or Skopeo installed and running (to copy the images to ECR)
> - CrowdStrike Falcon API credentials (Client ID + Secret)
>   - Required API scopes to pull the images (injector, KAC, IAR):
>     - **Falcon Images Download** (Read)
>     - **Sensor Download** (Read)
>   - Additional scopes IAR needs at runtime to upload image assessments:
>     - **Falcon Container Image** (Read/Write)
>     - **Falcon Container CLI** (Read/Write)
> - CrowdStrike CID (with checksum)
>
> **Image hosting:** This lab hosts all three Falcon images in **same-account ECR**. On Fargate, image pulls are authenticated by the **Fargate pod execution role**, so no image pull secret is used.

> **Windows:** These commands are written for bash. Run them from **WSL** or **Git Bash** — CrowdStrike's `falcon-container-sensor-pull` script is bash-only, and tools like `grep`/`cut`/`awk` aren't available in native PowerShell.

## Reference Docs

| Source | Link |
|--------|------|
| Get Started with Falcon Container Sensor for Linux | https://docs.crowdstrike.com/r/en-US/iopiipqy/e58b97e0 |
| Falcon Container Sensor for Linux Architecture | https://docs.crowdstrike.com/r/en-US/iopiipqy/ff6d35ef |
| Deploy Falcon Container Sensor with a Helm chart | https://docs.crowdstrike.com/r/en-US/qg0ygdwl/ebc28f99 |
| Deploy Falcon Kubernetes Admission Controller with Helm | https://docs.crowdstrike.com/r/en-US/qg0ygdwl/d0a3095c |
| Deploy Image Assessment at Runtime with Helm | https://docs.crowdstrike.com/r/en-US/qg0ygdwl/a0cf9976 |
| EKS Fargate Pod Execution Role | https://docs.aws.amazon.com/eks/latest/userguide/fargate-pod-configuration.html |
| falcon-sensor Helm chart (Injector) | https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-sensor |

---

## Core Concepts

AWS Fargate runs each pod in its own isolated micro-VM with **no host access** — you cannot reach the worker node kernel, run privileged containers, or schedule DaemonSets. That rules out the kernel-mode Falcon sensor entirely. Instead, Fargate is protected with the **Falcon Container Sensor**, which runs fully in **user space** and is injected into each application pod as a sidecar container.

This lab deploys three Fargate-compatible components, each as a standard non-privileged workload:

- **Sidecar Injector** (`falcon-sensor` chart, injector mode) — a Deployment fronted by a `MutatingWebhookConfiguration`. When a pod is created, the webhook patches the pod spec to add the Falcon Container Sensor as a sidecar. Namespace: `falcon-lumos-injector`.
- **Falcon KAC** (`falcon-kac` chart) — Kubernetes Admission Controller for cluster visibility and policy enforcement. A non-privileged Deployment. Namespace: `falcon-kac`.
- **Falcon Image Analyzer / IAR** (`falcon-image-analyzer` chart) — scans images for vulnerabilities. Must run in **Watcher mode** (`deployment.enabled=true`) on Fargate, never Socket/DaemonSet mode. Namespace: `falcon-image-analyzer`.

### Why Fargate changes the rules

| Concern | EC2 nodes | EKS Fargate |
|---------|-----------|-------------|
| Runtime protection | DaemonSet sensor (eBPF, kernel) | Sidecar injection (user space) |
| Privileged containers | Allowed | **Not allowed** |
| DaemonSets | Scheduled per node | **Silently ignored** |
| Image Analyzer mode | Socket (DaemonSet) or Watcher | **Watcher (Deployment) only** |
| Image pull auth | Node instance profile / secret | **Fargate pod execution role (ECR, same account)** |
| Scheduling a namespace | Any node | Requires a **Fargate profile** |

### Image pulls on Fargate use the pod execution role

There are no worker nodes on Fargate, so there is no node instance profile to authenticate registry pulls. Instead, every Fargate pod pulls its images using the **Fargate pod execution role**. The AWS managed policy `AmazonEKSFargatePodExecutionRolePolicy` — auto-attached to the pod execution role by both `eksctl` and the `terraform-aws-modules/eks` module — already grants `ecr:GetAuthorizationToken`, `BatchCheckLayerAvailability`, `GetDownloadUrlForLayer`, and `BatchGetImage`. That means once the Falcon images live in a **same-account ECR** repo, pulls just work — **no image pull secret, no pull token, and no namespace-ordering caveat** to manage. This lab hosts all three images in ECR for exactly that reason.

> IRSA (`serviceAccount` role annotations) does **not** authenticate image pulls on Fargate — that happens before the pod's service account token is available. Image-pull auth is always the pod execution role's job.

### Fargate profiles are mandatory

On Fargate there are no nodes to fall back on — a pod only schedules if its namespace matches a **Fargate profile**. That means every Falcon namespace (`falcon-lumos-injector`, `falcon-kac`, `falcon-image-analyzer`), the `kube-system` namespace (CoreDNS runs on Fargate too), and your application namespaces all need profile coverage, or their pods stay `Pending` forever.

> **CoreDNS caveat:** The injector's default namespace exclusions (`falcon-system`, `kube-system`, `kube-public`) exist for a reason — `kube-system` hosts CoreDNS, which you must **not** inject a sensor into. Keep those exclusions intact.

```
EKS FARGATE CLUSTER (serverless, no EC2 nodes)
Falcon-Injector-Pod: mutating webhook patches each new pod
Fargate Node 1 (micro-VM): app container + falcon-sensor sidecar
Fargate Node 2 (micro-VM): app container + falcon-sensor sidecar
Fargate Node 3 (micro-VM): app container + falcon-sensor sidecar
Falcon Image Analyzer: Deployment (Watcher) spanning all nodes
Falcon KAC: Deployment (Admission Controller) spanning all nodes
Amazon ECR: hosts sensor, KAC, and IAR images (pulled via pod execution role)
CrowdStrike Cloud: sidecar telemetry over TLS 443
```

---

## Deployment Steps

<div data-mode="guide">

### 1. Set credentials and context

Set your API credentials, CID, cluster name, and derive the ECR registry for your account:

```bash
export FALCON_CID=<YOUR_FALCON_CID>
export FALCON_CLIENT_ID=<YOUR_CLIENT_ID>
export FALCON_CLIENT_SECRET=<YOUR_CLIENT_SECRET>
export CLUSTER_NAME=falcon-fargate-lab
export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REGISTRY=${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com
```

### 2. Get image tags

Pull the image tag for each component. Note: `falcon-container` is the **sidecar** sensor (not `falcon-sensor`, which is the kernel/DaemonSet sensor that can't run on Fargate).

```bash
export CONTAINER_TAG=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-container --get-image-path | cut -d: -f2)
export KAC_TAG=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-kac --get-image-path | cut -d: -f2)
export IAR_TAG=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-imageanalyzer --get-image-path | cut -d: -f2)
```

### 3. Create ECR repos and copy the images

Create the three ECR repos (skips any that already exist — e.g. if Terraform pre-created them). The repo names must be exactly `falcon-container`, `falcon-kac`, and `falcon-imageanalyzer` because that's where `--copy` pushes each image:

```bash
for repo in falcon-container falcon-kac falcon-imageanalyzer; do
  aws ecr describe-repositories --repository-names $repo --region $AWS_REGION >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name $repo --region $AWS_REGION
done
```

Log Docker in to your ECR registry (the pull script does not log in to the destination):

```bash
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
```

Copy each image from the CrowdStrike registry into ECR (`--copy` pushes to `$ECR_REGISTRY/<image-name>:<tag>`):

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-container --copy $ECR_REGISTRY
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-kac --copy $ECR_REGISTRY
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-imageanalyzer --copy $ECR_REGISTRY
```

### 4. Add Helm repo and deploy

Add the CrowdStrike chart repo:

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update
```

Install the `falcon-sensor` chart in injector mode, pointing at the ECR image (no pull secret needed — the pod execution role authenticates the pull):

```bash
helm upgrade --install falcon-lumos-injector crowdstrike/falcon-sensor \
  --namespace falcon-lumos-injector \
  --create-namespace \
  --set falcon.tags="eks-fargate" \
  --set falcon.cid=$FALCON_CID \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=$ECR_REGISTRY/falcon-container \
  --set container.image.tag=$CONTAINER_TAG
```

Install KAC (cluster visibility + admission control):

```bash
helm upgrade --install falcon-kac crowdstrike/falcon-kac \
  --namespace falcon-kac --create-namespace \
  --set falcon.cid=$FALCON_CID \
  --set clusterName=$CLUSTER_NAME \
  --set image.repository=$ECR_REGISTRY/falcon-kac \
  --set image.tag=$KAC_TAG
```

Install Image Analyzer in Watcher mode (image vulnerability scanning):

```bash
helm upgrade --install falcon-image-analyzer crowdstrike/falcon-image-analyzer \
  --namespace falcon-image-analyzer --create-namespace \
  --set deployment.enabled=true \
  --set image.repository=$ECR_REGISTRY/falcon-imageanalyzer \
  --set image.tag=$IAR_TAG \
  --set crowdstrikeConfig.cid=$FALCON_CID \
  --set crowdstrikeConfig.clusterName=$CLUSTER_NAME \
  --set crowdstrikeConfig.clientID=$FALCON_CLIENT_ID \
  --set crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET \
  --set crowdstrikeConfig.agentRegion=us-1
```

> `node.enabled=false` disables the DaemonSet sensor (no kernel access on Fargate). `container.enabled=true` turns on injector mode. `deployment.enabled=true` selects IAR **Watcher mode** — the only mode that works on Fargate. `crowdstrikeConfig.cid` is required (the chart's schema rejects a null CID). Set `agentRegion` to your cloud (`us-1`, `us-2`, `eu-1`, `gov1`, `gov2`).

### 5. Verify injection and trigger a detection

Create the app namespace (covered by the `app-workloads` Fargate profile):

```bash
kubectl create namespace detection-vulnapp
```

Deploy the CrowdStrike vulnapp:

```bash
kubectl apply -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

Confirm the Falcon sidecar was injected:

```bash
kubectl get pod -l run=vulnerable.example.com -n detection-vulnapp -o jsonpath='{.items[0].spec.containers[*].name}'
# Should show: crowdstrike-falcon-container vulnapp
```

Port-forward and trigger a simulated attack, then check the console:

```bash
kubectl port-forward -n detection-vulnapp svc/vulnerable-example-com 8060:80
```

Open [http://localhost:8060](http://localhost:8060), click any attack simulation, then check **Falcon Console** > **Next-Gen SIEM** > **Monitor and investigate** > **Detections** (filter **Source product** = **Cloud**). Stop the port-forward (Ctrl+C) when done.

When you're finished, remove the vulnapp:

```bash
kubectl delete -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

</div>

<div data-mode="lab">

## 1. Provision an EKS Fargate-Only Cluster

> **What & Why:** A Fargate-only cluster has zero EC2 nodes — every pod, including CoreDNS, runs in its own micro-VM. This forces the serverless protection model (sidecar injection) and makes the "every namespace needs a Fargate profile" rule impossible to skip. It mirrors production teams who run fully serverless Kubernetes.

### Step 1: Create the cluster configuration

> **What & Why:** The `fargateProfiles` block is the whole game on a nodeless cluster — a namespace with no matching profile can never schedule a pod. We pre-declare profiles for `default`/`kube-system` (CoreDNS), all three Falcon namespaces, and a `detection-vulnapp` namespace for later testing.

- [ ] Create an `eksctl` config with Fargate profiles and no node groups:

```bash
export CLUSTER_NAME=falcon-fargate-lab
export AWS_REGION=us-east-1

cat <<'EOF' > eksctl-fargate.yaml
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig

metadata:
  name: falcon-fargate-lab
  region: us-east-1

iam:
  withOIDC: true

fargateProfiles:
  - name: default
    selectors:
      - namespace: default
      - namespace: kube-system
  - name: falcon
    selectors:
      - namespace: falcon-lumos-injector
      - namespace: falcon-kac
      - namespace: falcon-image-analyzer
  - name: app-workloads
    selectors:
      - namespace: detection-vulnapp
EOF
```

### Step 2: Create the cluster

> **What & Why:** With no managed node groups defined, eksctl automatically reconfigures the CoreDNS deployment to run on Fargate (it removes the EC2 compute-type annotation). This takes a few minutes. eksctl also creates a **Fargate pod execution role** and attaches `AmazonEKSFargatePodExecutionRolePolicy` to it — that policy grants same-account ECR pulls, which is what lets the Falcon pods pull from ECR later with no pull secret.

- [ ] Deploy the cluster:

```bash
eksctl create cluster -f eksctl-fargate.yaml
```

> **Terraform alternative:** The `tf-k8s-eks-fargate-lab` project provisions the same nodeless cluster **and** the three ECR repos this lab uses. If you applied it, skip the `eksctl` steps and run `aws eks update-kubeconfig --region $AWS_REGION --name $CLUSTER_NAME`, then continue from Section 2 (the repos already exist, so the create step there becomes a no-op).

### Step 3: Verify the serverless setup

- [ ] Confirm there are **no** EC2 nodes (they only appear as Fargate-backed nodes once pods schedule):

```bash
kubectl get nodes
```

- [ ] Confirm the Fargate profiles exist:

```bash
eksctl get fargateprofile --cluster $CLUSTER_NAME
```

You should see `default`, `falcon`, and `app-workloads`.

- [ ] Confirm CoreDNS is running on Fargate:

```bash
kubectl get pods -n kube-system -o wide -l k8s-app=kube-dns
```

The node names should be `fargate-ip-...` — proof CoreDNS itself moved to Fargate.

---

## 2. Stage Images in ECR

> **What & Why:** On Fargate, image pulls are authenticated by the pod execution role — not by an `imagePullSecret`. Hosting the three Falcon images in same-account ECR means the pod execution role's `AmazonEKSFargatePodExecutionRolePolicy` authenticates every pull, so there's no pull token to mint, no secret to propagate, and no namespace-ordering caveat. IAR still needs API credentials at runtime for vulnerability reporting — that's unrelated to image pulls.

### Step 1: Set API credentials and context

- [ ] Export your Falcon API credentials, CID, cluster name, and the ECR registry for your account:

```bash
export FALCON_CID=<YOUR_FALCON_CID>
export FALCON_CLIENT_ID=<YOUR_CLIENT_ID>
export FALCON_CLIENT_SECRET=<YOUR_CLIENT_SECRET>
export CLUSTER_NAME=falcon-fargate-lab
export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REGISTRY=${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com
```

### Step 2: Get image tags

> **What & Why:** The sidecar sensor is the `falcon-container` image type — this is the user-space Container Sensor, distinct from `falcon-sensor` (the kernel/DaemonSet image, which cannot run on Fargate). `--copy` pushes each image to ECR with the same tag, so grab the tag now with `--get-image-path | cut -d: -f2`.

- [ ] Pull the tag for each component:

```bash
export CONTAINER_TAG=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-container --get-image-path | cut -d: -f2)
export KAC_TAG=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-kac --get-image-path | cut -d: -f2)
export IAR_TAG=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-imageanalyzer --get-image-path | cut -d: -f2)
```

### Step 3: Create the ECR repositories

> **What & Why:** The pull script's `--copy` flag pushes to `<registry>/<image-name>:<tag>` but does **not** create the destination repo. The image names are fixed — `falcon-container`, `falcon-kac`, `falcon-imageanalyzer` (no hyphen) — so the repos must use exactly those names. This create step is idempotent, so it's safe whether or not the `tf-k8s-eks-fargate-lab` Terraform already made them.

- [ ] Create the three repos (skips any that already exist):

```bash
for repo in falcon-container falcon-kac falcon-imageanalyzer; do
  aws ecr describe-repositories --repository-names $repo --region $AWS_REGION >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name $repo --region $AWS_REGION
done
```

### Step 4: Log Docker in to ECR

> **What & Why:** The pull script logs in to the **CrowdStrike** registry to read the images, but it does **not** log in to your **destination** registry. You must authenticate Docker to ECR yourself before `--copy` can push.

- [ ] Authenticate to your ECR registry:

```bash
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
```

### Step 5: Copy the images into ECR

- [ ] Copy each image from the CrowdStrike registry to ECR (`--copy` pushes to `$ECR_REGISTRY/<image-name>:<tag>`):

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-container --copy $ECR_REGISTRY
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-kac --copy $ECR_REGISTRY
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-imageanalyzer --copy $ECR_REGISTRY
```

- [ ] Validate everything populated and the images landed in ECR:

```bash
echo "CID          : $([ -n "$FALCON_CID" ] && echo SET || echo MISSING)"
echo "Cluster      : $([ -n "$CLUSTER_NAME" ] && echo SET || echo MISSING) ($CLUSTER_NAME)"
echo "ECR registry : $([ -n "$ECR_REGISTRY" ] && echo SET || echo MISSING) ($ECR_REGISTRY)"
echo "Container    : $([ -n "$CONTAINER_TAG" ] && echo SET || echo MISSING) ($ECR_REGISTRY/falcon-container:$CONTAINER_TAG)"
echo "KAC          : $([ -n "$KAC_TAG" ] && echo SET || echo MISSING) ($ECR_REGISTRY/falcon-kac:$KAC_TAG)"
echo "IAR          : $([ -n "$IAR_TAG" ] && echo SET || echo MISSING) ($ECR_REGISTRY/falcon-imageanalyzer:$IAR_TAG)"
aws ecr list-images --repository-name falcon-container --region $AWS_REGION --query 'imageIds[*].imageTag' --output text
```

Every line should read `SET`, and the last command should print the container sensor tag — proof the copy landed.

---

## 3. Add the Helm Repository

> **What & Why:** CrowdStrike publishes a standalone chart per component. On a Fargate-only cluster we deploy three separate charts (`falcon-sensor` in injector mode, `falcon-kac`, `falcon-image-analyzer`) rather than the `falcon-platform` umbrella, because the umbrella's node-sensor subchart assumes DaemonSet mode.

- [ ] Add and update the repo:

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update
```

- [ ] Verify the charts are available:

```bash
helm search repo crowdstrike/falcon-sensor
helm search repo crowdstrike/falcon-kac
helm search repo crowdstrike/falcon-image-analyzer
```

---

## 4. Deploy the Sidecar Injector

> **What & Why:** Fargate pods have no host to run a DaemonSet on, so runtime protection comes from a mutating admission webhook. When a pod is created in an injectable namespace, the webhook patches the pod spec to add the Falcon Container Sensor as a sidecar. The sidecar image is pulled from your ECR repo — and because Fargate authenticates pulls with the **pod execution role** (which carries `AmazonEKSFargatePodExecutionRolePolicy`), no `imagePullSecret` is needed and no namespace ordering matters. Any Fargate-profiled namespace can be injected at any time.

### Step 1: Install the injector

- [ ] Install the `falcon-sensor` chart in injector mode, pointing at your ECR image:

```bash
helm upgrade --install falcon-lumos-injector crowdstrike/falcon-sensor \
  --namespace falcon-lumos-injector \
  --create-namespace \
  --set falcon.tags="eks-fargate" \
  --set falcon.cid=$FALCON_CID \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=$ECR_REGISTRY/falcon-container \
  --set container.image.tag=$CONTAINER_TAG
```

> `node.enabled=false` disables the DaemonSet (no kernel on Fargate). `container.enabled=true` activates injector mode. There is no image pull secret to configure because pulls are authenticated by the pod execution role. To scope injection to specific namespaces instead of all of them, see Challenge 1.

### Step 2: Verify the injector is running on Fargate

- [ ] Confirm the injector pods are running:

```bash
kubectl get pods -n falcon-lumos-injector -o wide
```

- [ ] Confirm the mutating webhook is registered:

```bash
kubectl get mutatingwebhookconfigurations | grep falcon
```

---

## 5. Deploy the Kubernetes Admission Controller (KAC)

> **What & Why:** KAC gives you cluster-wide Kubernetes visibility and admission-time policy enforcement. It's a single non-privileged Deployment (three containers, all `readOnlyRootFilesystem`, `runAsNonRoot`), so it's fully Fargate-compatible — its namespace just needs a Fargate profile (already created in Section 1).

### Step 1: Install KAC

- [ ] Deploy the `falcon-kac` chart from your ECR repo:

```bash
helm upgrade --install falcon-kac crowdstrike/falcon-kac \
  --namespace falcon-kac \
  --create-namespace \
  --set falcon.cid=$FALCON_CID \
  --set clusterName=$CLUSTER_NAME \
  --set image.repository=$ECR_REGISTRY/falcon-kac \
  --set image.tag=$KAC_TAG
```

> No image pull secret is needed — the KAC pod pulls from ECR using the Fargate pod execution role. KAC's pod-validating webhook defaults to `failurePolicy: Ignore`, which is the safer setting on Fargate — an admission hiccup won't block pod scheduling. KAC also auto-excludes `kube-system`, `kube-public`, `falcon-system`, and its own namespace.

### Step 2: Verify KAC

- [ ] Confirm the KAC pod is running (one pod, three containers):

```bash
kubectl get pods -n falcon-kac -o wide
kubectl get pod -n falcon-kac -o jsonpath='{.items[0].spec.containers[*].name}'
# Expected: falcon-client falcon-watcher falcon-ac
```

---

## 6. Deploy Falcon Image Analyzer (IAR)

> **What & Why:** IAR scans images for vulnerabilities. It has two modes: Socket mode (a privileged DaemonSet that mounts the container runtime socket) and Watcher mode (a non-privileged Deployment that watches the K8s API and pulls images itself). **Only Watcher mode works on Fargate** — there's no node socket to mount and no privileged containers allowed.

### Step 1: Install IAR in Watcher mode

- [ ] Deploy the `falcon-image-analyzer` chart with `deployment.enabled=true` from your ECR repo:

```bash
helm upgrade --install falcon-image-analyzer crowdstrike/falcon-image-analyzer \
  --namespace falcon-image-analyzer \
  --create-namespace \
  --set deployment.enabled=true \
  --set image.repository=$ECR_REGISTRY/falcon-imageanalyzer \
  --set image.tag=$IAR_TAG \
  --set crowdstrikeConfig.cid=$FALCON_CID \
  --set crowdstrikeConfig.clusterName=$CLUSTER_NAME \
  --set crowdstrikeConfig.clientID=$FALCON_CLIENT_ID \
  --set crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET \
  --set crowdstrikeConfig.agentRegion=us-1
```

> `deployment.enabled=true` selects Watcher mode. **Never** set `daemonset.enabled=true` on Fargate. No image pull secret is needed — the pod pulls the IAR image from ECR via the pod execution role. `crowdstrikeConfig.*` supplies the **runtime** API credentials IAR uses to upload assessments (unrelated to image pulls); `crowdstrikeConfig.cid` is required — the chart's values schema rejects a null CID. Set `agentRegion` to your cloud (`us-1`, `us-2`, `eu-1`, `gov1`, `gov2`).

> ⚠️ **Sizing caveat:** IAR mounts a `tmp-volume` emptyDir (default 20Gi) sized to ~2× the largest image it scans. On Fargate this consumes the pod's ephemeral storage, so a scan-heavy IAR pod may need a larger Fargate configuration. Watch for `Evicted` pods and raise the volume/ephemeral-storage request if needed.

### Step 2: Verify IAR

- [ ] Confirm the IAR pod is running as a Deployment (not a DaemonSet):

```bash
kubectl get deploy -n falcon-image-analyzer
kubectl get pods -n falcon-image-analyzer -o wide
```

---

## 7. Verify Fargate Coverage and Test a Detection

> **What & Why:** Verification means proving the injection path actually works end to end: a new pod in a Fargate-profiled namespace should come up with the Falcon sidecar attached and generate real detections. The CrowdStrike vulnapp doubles as both the injection target and a safe attack simulator.

### Step 1: Check all Falcon components

- [ ] Get a full picture of every Falcon pod:

```bash
kubectl get pods -A | grep falcon
```

Expected namespaces: `falcon-lumos-injector` (injector), `falcon-kac` (KAC), `falcon-image-analyzer` (IAR).

### Step 2: Deploy the vulnapp into a Fargate-profiled namespace

> The `detection-vulnapp` namespace is covered by the `app-workloads` Fargate profile from Section 1. Because pulls use the pod execution role, this namespace can be created now — there's no pull secret to seed ahead of time.

- [ ] Create the namespace and deploy the vulnapp:

```bash
kubectl create namespace detection-vulnapp
kubectl apply -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

- [ ] Give the pod a moment to schedule — Fargate provisions a micro-VM per pod, so the first start is slower than EC2.

### Step 3: Verify sidecar injection

- [ ] Confirm the Falcon sidecar was injected into the pod:

```bash
kubectl get pod -l run=vulnerable.example.com -n detection-vulnapp -o jsonpath='{.items[0].spec.containers[*].name}'
# Expected: crowdstrike-falcon-container vulnapp
```

> **Look for:** the `crowdstrike-falcon-container` name alongside your app container (`vulnapp`). If it's missing, the webhook didn't reach this namespace — re-check Section 4. If the pod is stuck in `Init:ImagePullBackOff`, confirm the images are in ECR (Section 2) and that the Fargate pod execution role carries `AmazonEKSFargatePodExecutionRolePolicy`.

### Step 4: Verify in the Falcon console

- [ ] Navigate to **Falcon Console** > **Host management** > **Hosts**
- [ ] Filter by your cluster name — the Fargate pod should appear as a host tagged `eks-fargate`

### Step 5: Test a detection (optional)

> **What & Why:** Injection proves coverage; a real detection proves the sidecar is actively monitoring. The vulnapp's web UI fires safe, simulated attacks.

- [ ] Port-forward to the vulnapp service (this blocks — leave it running):

```bash
kubectl port-forward -n detection-vulnapp svc/vulnerable-example-com 8060:80
```

- [ ] Open [http://localhost:8060](http://localhost:8060) and click any attack simulation (e.g. **Access sensitive files**, **Kill process**, **Run a reverse shell**).
- [ ] In the console, go to **Next-Gen SIEM** > **Monitor and investigate** > **Detections**, filter **Source product** = **Cloud** — a detection tied to the Fargate pod should appear within a few minutes. Stop the port-forward (Ctrl+C) when done.

### Step 6: Clean up the vulnapp

- [ ] Remove the vulnapp:

```bash
kubectl delete -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

---

## 8. Cleanup

> **What & Why:** Removes all Falcon components, the ECR repos, and the cluster to avoid ongoing AWS costs.

### Step 1: Uninstall the Helm releases

- [ ] Remove all three releases:

```bash
helm uninstall falcon-lumos-injector -n falcon-lumos-injector
helm uninstall falcon-kac -n falcon-kac
helm uninstall falcon-image-analyzer -n falcon-image-analyzer
```

### Step 2: Delete the namespaces

- [ ] Clean up the Falcon namespaces:

```bash
kubectl delete namespace falcon-lumos-injector falcon-kac falcon-image-analyzer detection-vulnapp
```

### Step 3: Delete the ECR repositories

- [ ] Delete the three repos (`--force` removes them even if they still hold images):

```bash
for repo in falcon-container falcon-kac falcon-imageanalyzer; do
  aws ecr delete-repository --repository-name $repo --force --region $AWS_REGION
done
```

> If you created the repos with the `tf-k8s-eks-fargate-lab` Terraform, run `terraform destroy` there instead of this step — the repos use `force_delete = true` so they're removed with the rest of the stack.

### Step 4: Delete the cluster

- [ ] Remove the EKS cluster (this also removes the Fargate profiles):

```bash
eksctl delete cluster --name $CLUSTER_NAME --region $AWS_REGION
```

---

## Challenges

### Challenge 1: Opt-in injection via namespace label

**Scenario:** Your platform team runs many namespaces on Fargate and only wants Falcon injected into approved workload namespaces — not everything. Reconfigure the injector so injection is **opt-in** rather than all-namespaces.

<details>
<summary>💡 Hint</summary>

Look at `container.disableNSInjection` and the per-namespace label the injector honors. When injection is disabled by default, you enable it per namespace with a label.

</details>

<details>
<summary>✅ Solution</summary>

Redeploy the injector with namespace-scoped injection disabled by default:

```bash
helm upgrade --install falcon-lumos-injector crowdstrike/falcon-sensor \
  --namespace falcon-lumos-injector \
  --create-namespace \
  --set falcon.tags="eks-fargate" \
  --set falcon.cid=$FALCON_CID \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.disableNSInjection=true \
  --set container.image.repository=$ECR_REGISTRY/falcon-container \
  --set container.image.tag=$CONTAINER_TAG
```

Then opt a namespace in with the label:

```bash
kubectl label namespace detection-vulnapp sensor.falcon-system.crowdstrike.com/injection=enabled
```

Only labeled namespaces now get the sidecar. This is the safest pattern on Fargate — it guarantees you never accidentally inject into an infra namespace that happens to have a Fargate profile.

</details>

### Challenge 2: Make Fargate pod sizing deterministic

**Scenario:** Finance flags that some Fargate pods jumped to a larger (more expensive) size after Falcon was added. Set explicit sidecar resource requests so pod sizing is predictable, and explain why it matters on Fargate specifically.

<details>
<summary>💡 Hint</summary>

Fargate rounds each pod up to the next CPU/memory configuration based on the **sum of all container requests**. The injected sidecar's requests come from `container.sensorResources` in the falcon-sensor chart.

</details>

<details>
<summary>✅ Solution</summary>

Set `container.sensorResources` so every injected sidecar carries a known, modest request:

```bash
helm upgrade --install falcon-lumos-injector crowdstrike/falcon-sensor \
  --namespace falcon-lumos-injector \
  --reuse-values \
  --set container.sensorResources.requests.cpu=100m \
  --set container.sensorResources.requests.memory=256Mi
```

Because Fargate bills at discrete sizes (starting at 0.25 vCPU / 0.5 GB) and rounds up the sum of all container requests, an unbounded sidecar request can silently bump a pod into the next tier. Setting explicit requests makes the total predictable — you can right-size the app + sidecar to land just under a Fargate boundary. Tune from real telemetry after observing steady-state usage.

</details>

### Challenge 3: Pull from a cross-account ECR

**Scenario:** Your organization hosts golden images in a central "shared services" AWS account and each workload account runs its own EKS Fargate cluster. Configure the Fargate pods to pull the Falcon images from an ECR repo in a **different** account.

<details>
<summary>💡 Hint</summary>

Same-account pulls work because `AmazonEKSFargatePodExecutionRolePolicy` grants ECR on `Resource: *`, but the **repository's own resource policy** still has to allow the calling account. Cross-account needs a repository policy on the source repo **and** the reader's pod execution role must be allowed to pull.

</details>

<details>
<summary>✅ Solution</summary>

Two pieces are required — one in each account.

**1. In the account that owns the ECR repo**, attach a repository policy that allows the consumer account's pod execution role to pull:

```bash
aws ecr set-repository-policy --repository-name falcon-container --region $AWS_REGION \
  --policy-text '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "AllowCrossAccountPull",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<CONSUMER_ACCOUNT_ID>:role/<POD_EXEC_ROLE_NAME>" },
      "Action": [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:BatchCheckLayerAvailability"
      ]
    }]
  }'
```

**2. In the consumer (cluster) account**, make sure the Fargate pod execution role can call ECR in the other account. `AmazonEKSFargatePodExecutionRolePolicy` already covers this, but if you use a trimmed custom role, attach `AmazonEC2ContainerRegistryReadOnly`:

```bash
POD_EXEC_ROLE=$(aws eks describe-fargate-profile --cluster-name $CLUSTER_NAME --fargate-profile-name app-workloads \
  --query 'fargateProfile.podExecutionRoleArn' --output text | awk -F/ '{print $NF}')
aws iam attach-role-policy --role-name $POD_EXEC_ROLE \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
```

Then point the charts at the cross-account registry (`<OWNER_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/falcon-container`, etc.). `GetAuthorizationToken` is always called against the caller's own account, so no `imagePullSecret` is needed — the repository policy is what authorizes the cross-account read.

</details>

---

## Quick Reference

| Action | Command / Value |
|--------|-----------------|
| Sidecar image type | `--type falcon-container` (NOT `falcon-sensor`) |
| ECR repo names | `falcon-container`, `falcon-kac`, `falcon-imageanalyzer` (must match `--copy` names) |
| Copy image to ECR | `... --type <t> --copy $ECR_REGISTRY` |
| Docker login to ECR | `aws ecr get-login-password --region $AWS_REGION \| docker login --username AWS --password-stdin $ECR_REGISTRY` |
| Fargate image pull auth | Pod execution role (`AmazonEKSFargatePodExecutionRolePolicy`) — no pull secret |
| Disable DaemonSet | `--set node.enabled=false` |
| Enable injector | `--set container.enabled=true` |
| Opt-in injection | `--set container.disableNSInjection=true` + namespace label |
| Sidecar sizing | `--set container.sensorResources.requests.{cpu,memory}` |
| IAR Fargate mode | `--set deployment.enabled=true` (Watcher, never DaemonSet) |
| Injected container name | `crowdstrike-falcon-container` |
| Namespaces needing a profile | Every Falcon ns + `kube-system` + app namespaces |
| List Fargate profiles | `eksctl get fargateprofile --cluster $CLUSTER_NAME` |

</div>

---
*Created: 2026-07-06 | Topics: cloud-security, kubernetes, eks, fargate, sidecar, helm, ecr*

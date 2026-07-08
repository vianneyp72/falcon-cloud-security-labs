# Falcon Platform Helm Deployment — EKS Hybrid (DaemonSet + Sidecar Injector)

Deploy CrowdStrike Falcon on an EKS cluster running both EC2 nodes and Fargate pods using a hybrid approach: DaemonSet sensor for EC2, sidecar injector for Fargate. This lab hosts all Falcon images in your own **same-account ECR** so pulls are authenticated by IAM — no registry pull token or pull secret anywhere.

> **Prerequisites:**
>
> - EKS cluster with both EC2 managed node groups and Fargate enabled
> - `eksctl`, `aws` CLI, and `kubectl` installed and configured (`kubectl get nodes` returns EC2 nodes)
> - Helm 3 installed (`helm version` shows v3.x)
> - Docker, Podman, or Skopeo installed and running (to copy the images to ECR)
> - CrowdStrike Falcon API credentials (Client ID + Secret)
>   - Required API scopes to pull the images (sensor, sidecar, KAC, IAR):
>     - **Falcon Images Download** (Read)
>     - **Sensor Download** (Read)
>   - Additional scopes IAR needs at runtime to upload image assessments:
>     - **Falcon Container Image** (Read/Write)
>     - **Falcon Container CLI** (Read/Write)
> - CrowdStrike CID (with checksum)
>
> **Image hosting:** All four Falcon images live in **same-account ECR**. EC2 pods (DaemonSet, KAC, IAR) pull using the **node instance role**; Fargate pods (the injector and injected sidecars) pull using the **Fargate pod execution role**. Neither uses an image pull secret.

## Reference Docs

| Source                               | Link                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| falcon-platform Helm chart (GitHub)  | https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-platform |
| falcon-sensor Helm chart (Injector)  | https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-sensor   |
| EKS Fargate Pod Execution Role       | https://docs.aws.amazon.com/eks/latest/userguide/fargate-pod-configuration.html  |
| Amazon ECR private registry auth     | https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html        |
| Deploy Falcon Sensor via Helm (Docs) | https://docs.crowdstrike.com/r/en-US/qg0ygdwl/l303c850                           |

---

## Core Concepts

EKS hybrid clusters run workloads on two compute types with different constraints:

- **EC2 nodes** — Full Linux hosts. The Falcon sensor runs as a DaemonSet (one pod per node), providing kernel-level protection via eBPF.
- **Fargate pods** — Serverless, no host access. DaemonSets are ignored. Protection requires injecting the Falcon sensor as a sidecar container into each pod at admission time.

This lab deploys four components:

- **Falcon Sensor** (DaemonSet) — Kernel-level protection on every EC2 node. Namespace: `falcon-system`.
- **Falcon Sidecar Injector** (Deployment) — Mutating webhook that injects the Falcon sensor container into Fargate pods at creation. Namespace: `falcon-container-injector`.
- **Falcon KAC** (Deployment) — Kubernetes Admission Controller for policy enforcement. Namespace: `falcon-kac`.
- **Falcon Image Analyzer** (Deployment) — Scans container images for vulnerabilities. Namespace: `falcon-image-analyzer`.

### How hybrid coverage works

| Compute      | Protection method | Mechanism                                          |
| ------------ | ----------------- | -------------------------------------------------- |
| EC2 nodes    | DaemonSet sensor  | 1 pod per node, eBPF kernel probes                 |
| Fargate pods | Sidecar injection | Mutating webhook adds sensor container             |
| KAC/IAR      | Deploy to EC2     | Stateless, land on EC2 (no Fargate profile needed) |

### Why host the images in ECR

The classic hybrid pain point is the **registry pull token**. On Fargate you cannot attach a node-level pull secret, so teams push the token into every workload namespace (`container.image.pullSecrets.allNamespaces=true`) — which silently fails to back-fill namespaces that already existed, and forces a strict "install the injector before you create app namespaces" ordering.

Hosting the images in **same-account ECR** removes the token entirely. AWS authenticates the pull with the IAM role attached to whatever is running the pod:

- **EC2 nodes** pull with the **node instance role**. `eksctl` (and the `terraform-aws-modules/eks` module) attach `AmazonEC2ContainerRegistryReadOnly` to the managed node group role by default, so DaemonSet/KAC/IAR pull from ECR with no secret.
- **Fargate pods** pull with the **Fargate pod execution role**. The AWS managed policy `AmazonEKSFargatePodExecutionRolePolicy` — auto-attached by both `eksctl` and the terraform module — already grants same-account ECR reads, so the injector and every injected sidecar pull with no secret and no namespace ordering to manage.

> IRSA (`serviceAccount` role annotations) does **not** authenticate image pulls — that happens before the pod's service account token exists. Image-pull auth is always the node instance role (EC2) or pod execution role (Fargate). IAR still needs API credentials at runtime for vulnerability reporting; that is unrelated to image pulls.

```
EKS HYBRID CLUSTER (EC2 + Fargate)
Falcon Injector: mutating webhook injects the sidecar into Fargate pods
DaemonSet: deploys one sensor pod onto each EC2 node
Fargate Node: app container + falcon-sensor sidecar (user space)
EC2 Node 1: app container + falcon-sensor DaemonSet pod (eBPF)
EC2 Node 2: app container + falcon-sensor DaemonSet pod (eBPF)
Falcon Image Analyzer: Deployment spanning all nodes, lands on EC2
Falcon KAC: Deployment (Admission Controller) spanning all nodes, lands on EC2
Amazon ECR: hosts DaemonSet Sensor Image, Container Sensor Image, KAC, IAR (IAM-authenticated pulls)
CrowdStrike Cloud: sidecar + DaemonSet telemetry over TLS 443
```

---

## Deployment Steps

<div data-mode="guide">

### 1. Set credentials and context

Set your API credentials, CID, existing cluster name, and derive the ECR registry for your account:

```bash
export FALCON_CID=<YOUR_FALCON_CID>
export FALCON_CLIENT_ID=<YOUR_CLIENT_ID>
export FALCON_CLIENT_SECRET=<YOUR_CLIENT_SECRET>
export CLUSTER_NAME=<YOUR_CLUSTER_NAME>
export AWS_REGION=<YOUR_AWS_REGION>
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REGISTRY=${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com
```

### 2. Create the Fargate profile for the injector namespace

The DaemonSet sensor, KAC, and IAR land on EC2 nodes (no profile needed), but the sidecar injector runs on Fargate. Create a profile covering its namespace (skip this if your cluster already has matching profiles):

```bash
eksctl create fargateprofile --cluster $CLUSTER_NAME --region $AWS_REGION \
  --name falcon-injector \
  --namespace falcon-container-injector
```

### 3. Create ECR repos and copy the images

Create the four ECR repos (skips any that already exist). The repo names must be exactly `falcon-sensor`, `falcon-container`, `falcon-kac`, and `falcon-imageanalyzer` because that's where `--copy` pushes each image:

```bash
for repo in falcon-sensor falcon-container falcon-kac falcon-imageanalyzer; do
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
for t in falcon-sensor falcon-container falcon-kac falcon-imageanalyzer; do
  curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
    --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type $t --copy $ECR_REGISTRY
done
```

### 4. Read the image tags from ECR

`--copy` preserves each image's tag, so read it straight back from ECR — no need to invoke the pull script again just to learn the tag. These feed the Helm `image.tag` values. Note the two sensor types: `falcon-sensor` is the **DaemonSet Sensor** (node/kernel) for EC2; `falcon-container` is the **Container Sensor** (sidecar) injected into Fargate pods.

```bash
export DAEMONSET_SENSOR_TAG=$(aws ecr describe-images --repository-name falcon-sensor --region $AWS_REGION --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' --output text)
export CONTAINER_TAG=$(aws ecr describe-images --repository-name falcon-container --region $AWS_REGION --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' --output text)
export KAC_TAG=$(aws ecr describe-images --repository-name falcon-kac --region $AWS_REGION --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' --output text)
export IAR_TAG=$(aws ecr describe-images --repository-name falcon-imageanalyzer --region $AWS_REGION --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' --output text)
```

Validate every variable the Helm installs need was populated:

```bash
echo "CID              : $([ -n "$FALCON_CID" ] && echo SET || echo MISSING)"
echo "Cluster          : $([ -n "$CLUSTER_NAME" ] && echo SET || echo MISSING) ($CLUSTER_NAME)"
echo "ECR Registry     : $([ -n "$ECR_REGISTRY" ] && echo SET || echo MISSING) ($ECR_REGISTRY)"
echo "DaemonSet Sensor : $([ -n "$DAEMONSET_SENSOR_TAG" ] && echo SET || echo MISSING) ($ECR_REGISTRY/falcon-sensor:$DAEMONSET_SENSOR_TAG)"
echo "Container Sensor : $([ -n "$CONTAINER_TAG" ] && echo SET || echo MISSING) ($ECR_REGISTRY/falcon-container:$CONTAINER_TAG)"
echo "KAC              : $([ -n "$KAC_TAG" ] && echo SET || echo MISSING) ($ECR_REGISTRY/falcon-kac:$KAC_TAG)"
echo "IAR              : $([ -n "$IAR_TAG" ] && echo SET || echo MISSING) ($ECR_REGISTRY/falcon-imageanalyzer:$IAR_TAG)"
```

### 5. Add Helm repo and deploy

Add the CrowdStrike chart repo:

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update
```

Install the `falcon-platform` umbrella chart (DaemonSet sensor + KAC + IAR) pointing at your ECR repos — no pull secret, the EC2 node instance role authenticates the pulls:

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set falcon-sensor.falcon.tags="eks-ec2-node" \
  --set createComponentNamespaces=true \
  --set global.falcon.cid=$FALCON_CID \
  --set falcon-sensor.node.image.repository=$ECR_REGISTRY/falcon-sensor \
  --set falcon-sensor.node.image.tag=$DAEMONSET_SENSOR_TAG \
  --set falcon-kac.image.repository=$ECR_REGISTRY/falcon-kac \
  --set falcon-kac.image.tag=$KAC_TAG \
  --set falcon-image-analyzer.deployment.enabled=true \
  --set falcon-image-analyzer.image.repository=$ECR_REGISTRY/falcon-imageanalyzer \
  --set falcon-image-analyzer.image.tag=$IAR_TAG \
  --set falcon-image-analyzer.crowdstrikeConfig.clusterName=$CLUSTER_NAME \
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=$FALCON_CLIENT_ID \
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET
```

Install the sidecar injector for Fargate pods, pointing at your ECR Container Sensor image — no pull secret, the Fargate pod execution role authenticates the pull:

```bash
helm upgrade --install falcon-container-injector crowdstrike/falcon-sensor \
  --namespace falcon-container-injector \
  --create-namespace \
  --set falcon.tags="eks-fargate" \
  --set falcon.cid=$FALCON_CID \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=$ECR_REGISTRY/falcon-container \
  --set container.image.tag=$CONTAINER_TAG
```

> **GovCloud (us-gov-1 / us-gov-2):** Add one flag so Image Analyzer targets the right region: `--set falcon-image-analyzer.crowdstrikeConfig.agentRegion=gov1` (use `gov2` for us-gov-2). The `--copy` step already resolves the correct GovCloud source registry when run with GovCloud API credentials.

### 6. Verify and trigger a detection

Confirm all Falcon components are running:

```bash
kubectl get pods -A | grep falcon
```

Create a Fargate profile for the app namespace so its pods schedule on Fargate (where the sidecar gets injected):

```bash
eksctl create fargateprofile --cluster $CLUSTER_NAME --region $AWS_REGION \
  --name app-workloads \
  --namespace detection-vulnapp
```

Create the app namespace:

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
# Should show: vulnerable.example.com crowdstrike-falcon-container
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

## 1. Provision EKS Hybrid Cluster

> **What & Why:** A hybrid EKS cluster uses both EC2 managed node groups (for DaemonSet workloads) and Fargate profiles (for serverless pods). This mirrors production environments where teams run a mix of compute types. The Falcon deployment must cover both — and because we host the images in ECR, both the node instance role and the Fargate pod execution role need ECR read (both get it by default from eksctl).

### Step 1: Create the cluster configuration

- [ ] Create an `eksctl` cluster config with both EC2 nodes and Fargate profiles:

```bash
export CLUSTER_NAME=falcon-hybrid-lab
export AWS_REGION=us-east-1

cat <<'EOF' > eksctl-hybrid.yaml
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig

metadata:
  name: falcon-hybrid-lab
  region: us-east-1

managedNodeGroups:
  - name: ec2-nodes
    instanceType: m5.large
    desiredCapacity: 2
    minSize: 1
    maxSize: 3

fargateProfiles:
  - name: falcon-injector
    selectors:
      - namespace: falcon-container-injector
  - name: app-workloads
    selectors:
      - namespace: detection-vulnapp
EOF
```

### Step 2: Create the cluster

> **What & Why:** eksctl creates the managed node group's instance role with `AmazonEC2ContainerRegistryReadOnly` attached (so EC2 pods can pull from same-account ECR) and a Fargate pod execution role with `AmazonEKSFargatePodExecutionRolePolicy` attached (so Fargate pods can too). That's what lets every Falcon component pull from ECR later with no pull secret.

- [ ] Deploy the cluster (takes a few minutes):

```bash
eksctl create cluster -f eksctl-hybrid.yaml
```

### Step 3: Verify the hybrid setup

- [ ] Confirm EC2 nodes are ready:

```bash
kubectl get nodes
```

- [ ] Confirm Fargate profiles exist:

```bash
eksctl get fargateprofile --cluster $CLUSTER_NAME
```

You should see `falcon-injector` and `app-workloads` profiles.

---

## 2. Stage Images in ECR

> **What & Why:** Hosting all four Falcon images in same-account ECR is what removes the registry pull token from this deployment. EC2 pods pull with the node instance role and Fargate pods pull with the pod execution role — both IAM-authenticated, so there's no token to mint, no secret to propagate, and no namespace-ordering caveat. IAR still needs API credentials at runtime for vulnerability reporting; that's unrelated to image pulls.

### Step 1: Set API credentials and context

- [ ] Export your Falcon API credentials, CID, cluster name, and the ECR registry for your account:

```bash
export FALCON_CID=<YOUR_FALCON_CID>
export FALCON_CLIENT_ID=<YOUR_CLIENT_ID>
export FALCON_CLIENT_SECRET=<YOUR_CLIENT_SECRET>
export CLUSTER_NAME=falcon-hybrid-lab
export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REGISTRY=${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com
```

### Step 2: Create the ECR repositories

> **What & Why:** The pull script's `--copy` flag pushes to `<registry>/<image-name>:<tag>` but does **not** create the destination repo. The image names are fixed — `falcon-sensor`, `falcon-container`, `falcon-kac`, `falcon-imageanalyzer` (no hyphen) — so the repos must use exactly those names. This create step is idempotent.

- [ ] Create the four repos (skips any that already exist):

```bash
for repo in falcon-sensor falcon-container falcon-kac falcon-imageanalyzer; do
  aws ecr describe-repositories --repository-names $repo --region $AWS_REGION >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name $repo --region $AWS_REGION
done
```

### Step 3: Log Docker in to ECR

> **What & Why:** The pull script logs in to the **CrowdStrike** registry to read the images, but it does **not** log in to your **destination** registry. You must authenticate Docker to ECR yourself before `--copy` can push.

- [ ] Authenticate to your ECR registry:

```bash
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
```

### Step 4: Copy the images into ECR

- [ ] Copy each image from the CrowdStrike registry to ECR (`--copy` pushes to `$ECR_REGISTRY/<image-name>:<tag>`):

```bash
for t in falcon-sensor falcon-container falcon-kac falcon-imageanalyzer; do
  curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
    --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type $t --copy $ECR_REGISTRY
done
```

### Step 5: Read the image tags from ECR

> **What & Why:** There are two distinct sensor images: `falcon-sensor` is the **DaemonSet Sensor** (kernel image) for EC2 nodes, and `falcon-container` is the **Container Sensor** (user-space sidecar) injected into Fargate pods. Because `--copy` preserved each image's original tag, read it straight back from ECR rather than invoking the pull script a second time with `--get-image-path`. This also means the tag you deploy is exactly what actually landed in your registry.

- [ ] Capture each tag from ECR and validate everything populated:

```bash
export DAEMONSET_SENSOR_TAG=$(aws ecr describe-images --repository-name falcon-sensor --region $AWS_REGION --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' --output text)
export CONTAINER_TAG=$(aws ecr describe-images --repository-name falcon-container --region $AWS_REGION --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' --output text)
export KAC_TAG=$(aws ecr describe-images --repository-name falcon-kac --region $AWS_REGION --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' --output text)
export IAR_TAG=$(aws ecr describe-images --repository-name falcon-imageanalyzer --region $AWS_REGION --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' --output text)

echo "CID              : $([ -n "$FALCON_CID" ] && echo SET || echo MISSING)"
echo "Cluster          : $([ -n "$CLUSTER_NAME" ] && echo SET || echo MISSING) ($CLUSTER_NAME)"
echo "ECR Registry     : $([ -n "$ECR_REGISTRY" ] && echo SET || echo MISSING) ($ECR_REGISTRY)"
echo "DaemonSet Sensor : $([ -n "$DAEMONSET_SENSOR_TAG" ] && echo SET || echo MISSING) ($ECR_REGISTRY/falcon-sensor:$DAEMONSET_SENSOR_TAG)"
echo "Container Sensor : $([ -n "$CONTAINER_TAG" ] && echo SET || echo MISSING) ($ECR_REGISTRY/falcon-container:$CONTAINER_TAG)"
echo "KAC              : $([ -n "$KAC_TAG" ] && echo SET || echo MISSING) ($ECR_REGISTRY/falcon-kac:$KAC_TAG)"
echo "IAR              : $([ -n "$IAR_TAG" ] && echo SET || echo MISSING) ($ECR_REGISTRY/falcon-imageanalyzer:$IAR_TAG)"
```

---

## 3. Add Helm Repository

> **What & Why:** CrowdStrike publishes two Helm charts needed for hybrid deployments: `falcon-platform` (umbrella chart for DaemonSet + KAC + IAR) and `falcon-sensor` (standalone chart used here for the sidecar injector).

- [ ] Add the CrowdStrike Helm repo:

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update
```

- [ ] Verify both charts are available:

```bash
helm search repo crowdstrike/falcon-platform
helm search repo crowdstrike/falcon-sensor
```

---

## 4. Deploy DaemonSet Sensor with KAC and IAR

> **What & Why:** The `falcon-platform` umbrella chart installs the DaemonSet sensor (EC2 nodes), KAC (admission control), and IAR (image scanning) in one release. On a hybrid cluster, DaemonSet pods only schedule on EC2 nodes — Fargate ignores them automatically. All three images are pulled from your ECR repos using the EC2 node instance role, so there is no `global.containerRegistry.configJSON` pull secret to set.

### Step 1: Install the platform chart

> Change `falcon-sensor.falcon.tags` to any custom value to group the EC2 node sensor in the Falcon console.

- [ ] Deploy with all component images pointed at ECR:

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set falcon-sensor.falcon.tags="eks-ec2-node" \
  --set createComponentNamespaces=true \
  --set global.falcon.cid=$FALCON_CID \
  --set falcon-sensor.node.image.repository=$ECR_REGISTRY/falcon-sensor \
  --set falcon-sensor.node.image.tag=$DAEMONSET_SENSOR_TAG \
  --set falcon-kac.image.repository=$ECR_REGISTRY/falcon-kac \
  --set falcon-kac.image.tag=$KAC_TAG \
  --set falcon-image-analyzer.deployment.enabled=true \
  --set falcon-image-analyzer.image.repository=$ECR_REGISTRY/falcon-imageanalyzer \
  --set falcon-image-analyzer.image.tag=$IAR_TAG \
  --set falcon-image-analyzer.crowdstrikeConfig.clusterName=$CLUSTER_NAME \
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=$FALCON_CLIENT_ID \
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET
```

> No image pull secret is needed — the DaemonSet, KAC, and IAR pods land on EC2 and pull from ECR using the node instance role (`AmazonEC2ContainerRegistryReadOnly`). **GovCloud (us-gov-1 / us-gov-2):** add `--set falcon-image-analyzer.crowdstrikeConfig.agentRegion=gov1` (use `gov2` for us-gov-2).

### Step 2: Verify EC2 sensor pods

- [ ] Confirm the DaemonSet sensor is running on EC2 nodes only:

```bash
kubectl get pods -n falcon-system -o wide
kubectl get ds -n falcon-system
```

`DESIRED` should match your EC2 node count (not total nodes including Fargate).

---

## 5. Deploy Sidecar Injector (Fargate Coverage)

> **What & Why:** Fargate pods have no host to run a DaemonSet on. The sidecar injector is a mutating admission webhook — when a pod is created in a Fargate-profiled namespace, the webhook intercepts the request and injects the Falcon sensor as an additional container in the pod spec. The sidecar image is pulled from your ECR repo, and because Fargate authenticates pulls with the **pod execution role**, no `imagePullSecret` is needed and no namespace ordering matters. Any Fargate-profiled namespace can be injected at any time.

### Step 1: Deploy the injector

> Change `falcon.tags` to any custom value to group the Fargate sidecars in the Falcon console.

- [ ] Install the `falcon-sensor` chart in injector mode, pointing at your ECR image:

```bash
helm upgrade --install falcon-container-injector crowdstrike/falcon-sensor \
  --namespace falcon-container-injector \
  --create-namespace \
  --set falcon.tags="eks-fargate" \
  --set falcon.cid=$FALCON_CID \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=$ECR_REGISTRY/falcon-container \
  --set container.image.tag=$CONTAINER_TAG
```

> `node.enabled=false` disables the DaemonSet (already covered by falcon-platform). `container.enabled=true` activates injector mode. There is no image pull secret to configure because both the injector pod and every injected sidecar pull from ECR via the Fargate pod execution role. To scope injection to specific namespaces instead of all of them, see Challenge 1.

### Step 2: Verify the injector is running on Fargate

- [ ] Confirm the injector pods are running (they should be on Fargate nodes):

```bash
kubectl get pods -n falcon-container-injector -o wide
```

- [ ] Confirm the mutating webhook is registered:

```bash
kubectl get mutatingwebhookconfigurations | grep falcon
```

---

## 6. Verify Full Hybrid Coverage

> **What & Why:** True verification means proving both protection paths work: DaemonSet on EC2 and sidecar injection on Fargate. Deploy a test pod into a Fargate-profiled namespace and confirm the sensor container appears.

### Step 1: Check all Falcon pods across namespaces

- [ ] Get a full picture of all Falcon components:

```bash
kubectl get pods -A | grep falcon
```

Expected:

- `falcon-system` — DaemonSet sensor pods (one per EC2 node)
- `falcon-kac` — KAC deployment pod
- `falcon-image-analyzer` — IAR deployment pod
- `falcon-container-injector` — Sidecar injector pods (on Fargate)

### Step 2: Deploy the CrowdStrike vulnapp

> The `detection-vulnapp` namespace is already covered by the `app-workloads` Fargate profile created in Section 1 — no new profile is needed. Because pulls use the pod execution role, this namespace can be created now — there's no pull secret to seed ahead of time.

- [ ] Create the app namespace and deploy the vulnapp:

```bash
kubectl create namespace detection-vulnapp
kubectl apply -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

- [ ] Give the pod a moment to schedule on Fargate (Fargate provisions a micro-VM per pod, so first start takes a bit longer than EC2).

### Step 3: Verify sidecar injection

- [ ] Confirm the Falcon sidecar was injected into the pod:

```bash
kubectl get pod -l run=vulnerable.example.com -n detection-vulnapp -o jsonpath='{.items[0].spec.containers[*].name}'
# Expected: vulnerable.example.com crowdstrike-falcon-container
```

> **Look for:** the `crowdstrike-falcon-container` name alongside your app container. If the pod is stuck in `Init:ImagePullBackOff`, confirm the images are in ECR (Section 2) and that the Fargate pod execution role carries `AmazonEKSFargatePodExecutionRolePolicy`.

- [ ] Check the DaemonSet sensor logs on EC2:

```bash
kubectl logs -n falcon-system -l app.kubernetes.io/name=falcon-sensor --tail=20
```

### Step 4: Verify in Falcon console

- [ ] Navigate to **Falcon Console** > **Host management** > **Hosts**
- [ ] Filter by cluster name — you should see both EC2 node hosts and Fargate pod hosts

### Step 5: Test a detection (optional)

> **What & Why:** Injecting the sidecar proves coverage; triggering a real detection proves the sidecar is actively monitoring. The vulnapp deployed above doubles as a detection generator — its web UI fires safe, simulated attacks.

- [ ] Port-forward to the vulnapp service (this blocks — leave it running):

```bash
kubectl port-forward -n detection-vulnapp svc/vulnerable-example-com 8060:80
```

- [ ] Open [http://localhost:8060](http://localhost:8060) and click any attack simulation (e.g. **Access sensitive files**, **Kill process**, or **Run a reverse shell**). The injected sidecar sensor observes the activity on the Fargate pod.
- [ ] In the Falcon console, go to **Next-Gen SIEM** > **Monitor and investigate** > **Detections**, then filter **Source product** = **Cloud** — a new detection tied to the Fargate pod host should appear within a few minutes. Stop the port-forward (Ctrl+C) when done.

### Step 6: Clean up the vulnapp

- [ ] Remove the vulnapp:

```bash
kubectl delete -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

---

## 7. Cleanup

> **What & Why:** Removes all Falcon components, the ECR repos, and the test cluster to avoid ongoing AWS costs.

### Step 1: Uninstall Helm releases

- [ ] Remove both Falcon Helm releases:

```bash
helm uninstall falcon-container-injector -n falcon-container-injector
helm uninstall falcon-platform -n falcon-platform
```

### Step 2: Delete namespaces

- [ ] Clean up all Falcon namespaces:

```bash
kubectl delete namespace falcon-platform falcon-system falcon-kac falcon-image-analyzer falcon-container-injector
```

### Step 3: Delete the ECR repositories

- [ ] Delete the four repos (`--force` removes them even if they still hold images):

```bash
for repo in falcon-sensor falcon-container falcon-kac falcon-imageanalyzer; do
  aws ecr delete-repository --repository-name $repo --force --region $AWS_REGION
done
```

### Step 4: Delete the EKS cluster

- [ ] Remove the cluster:

```bash
eksctl delete cluster --name $CLUSTER_NAME --region $AWS_REGION
```

---

## Challenges

### Challenge 1: Opt-in injection via namespace label

Reconfigure the injector so injection is **opt-in** rather than all-namespaces — your platform team only wants Falcon injected into approved workload namespaces. Redeploy with `--set container.disableNSInjection=true`, then label a namespace with `sensor.falcon-system.crowdstrike.com/injection=enabled` to opt it in. Confirm a pod in an unlabeled Fargate namespace comes up with no sidecar.

### Challenge 2: Verify coverage gaps

Deploy a pod into a namespace that has a Fargate profile but is NOT covered by the injector webhook. Confirm it runs without Falcon protection and identify how you'd detect this gap in the Falcon console (hint: Kubernetes & Containers inventory shows unprotected pods).

### Challenge 3: Pull from a cross-account ECR

Your organization hosts golden images in a central "shared services" AWS account while each workload account runs its own EKS hybrid cluster. Attach a repository policy on the source repos allowing the consumer account's node instance role **and** Fargate pod execution role to pull, ensure both roles carry `AmazonEC2ContainerRegistryReadOnly`, then point the charts at `<OWNER_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/<repo>`. No `imagePullSecret` is needed — the repository policy authorizes the cross-account read.

---

## Quick Reference

| Variable / Value             | Where Used                                                                 |
| ---------------------------- | -------------------------------------------------------------------------- |
| `ECR_REGISTRY`               | `<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com` — image repository base      |
| ECR repo names               | `falcon-sensor`, `falcon-container`, `falcon-kac`, `falcon-imageanalyzer`  |
| `DAEMONSET_SENSOR_TAG`       | DaemonSet Sensor tag → `falcon-sensor.node.image.tag`                      |
| `CONTAINER_TAG`              | Container Sensor tag → injector `container.image.tag`                      |
| `KAC_TAG` / `IAR_TAG`        | KAC / IAR image tags → falcon-platform subchart `image.tag`                |
| EC2 image pull auth          | Node instance role (`AmazonEC2ContainerRegistryReadOnly`) — no pull secret |
| Fargate image pull auth      | Pod execution role (`AmazonEKSFargatePodExecutionRolePolicy`) — no secret  |
| Disable DaemonSet (injector) | `--set node.enabled=false`                                                 |
| Enable injector              | `--set container.enabled=true`                                             |
| Opt-in injection             | `--set container.disableNSInjection=true` + namespace label                |
| Injected container name      | `crowdstrike-falcon-container`                                             |
| Copy image to ECR            | `... --type <t> --copy $ECR_REGISTRY`                                      |

</div>

# Falcon Sidecar Injection on EKS Fargate — Serverless Kubernetes Protection

Deploy CrowdStrike Falcon on an EKS **Fargate-only** cluster (no EC2 nodes) using the sidecar injector for runtime protection, plus KAC for admission control and Image Analyzer for image scanning.

> **Performance note (measured on this lab's cluster):**
>
> - **Startup:** Bare pod ~53s to Ready; injected ~62s — the sidecar adds **~10s** (init container + sensor launch).
> - **Runtime footprint (idle):** ~**33 MiB** memory (~23 MiB RSS) and **<1 millicore** CPU per protected pod. CPU scales with syscall/process-event volume.

> **Prerequisites:**
>
> - Helm 3 installed (`helm version` shows v3.x)
> - `aws` CLI, `eksctl`, and `kubectl` installed and configured
> - Docker, Podman, or Skopeo installed and running (to copy the images to ECR)
> - CrowdStrike Falcon API credentials (Client ID + Secret)
>   - Required API scopes to pull the images (injector, KAC, IAR):
>     - **Falcon Images Download** (Read)
>     - **Sensor Download** (Read)
>   - Additional scopes IAR needs at runtime to upload image assessments:
>     - **Falcon Container Image** (Read/Write)
>     - **Falcon Container CLI** (Read/Write)
> - CrowdStrike CID (with checksum)
> - **Quick Deploy path:** an existing EKS cluster with Fargate enabled and `kubectl` pointed at it (`kubectl get pods -A` works)
> - **Full Lab path:** an AWS account and credentials; Section 1 provisions the Fargate-only cluster for you
>
> **Image hosting:** This lab hosts all three Falcon images in **same-account ECR**. On Fargate, image pulls are authenticated by the **Fargate pod execution role**, so no image pull secret is used.

## Reference Docs

| Source                                                  | Link                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Get Started with Falcon Container Sensor for Linux      | https://docs.crowdstrike.com/r/en-US/iopiipqy/e58b97e0                          |
| Falcon Container Sensor for Linux Architecture          | https://docs.crowdstrike.com/r/en-US/iopiipqy/ff6d35ef                          |
| Deploy Falcon Container Sensor with a Helm chart        | https://docs.crowdstrike.com/r/en-US/qg0ygdwl/ebc28f99                          |
| Deploy Falcon Kubernetes Admission Controller with Helm | https://docs.crowdstrike.com/r/en-US/qg0ygdwl/d0a3095c                          |
| Deploy Image Assessment at Runtime with Helm            | https://docs.crowdstrike.com/r/en-US/qg0ygdwl/a0cf9976                          |
| EKS Fargate Pod Execution Role                          | https://docs.aws.amazon.com/eks/latest/userguide/fargate-pod-configuration.html |
| falcon-sensor Helm chart (Injector)                     | https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-sensor  |

---

## Core Concepts

Fargate runs each pod in its own micro-VM with **no host access**, so the kernel-mode DaemonSet Sensor cannot run. Instead, the user-space **Falcon Container Sensor** is injected into each application pod as a sidecar.

- **Sidecar Injector** (`falcon-sensor` chart, injector mode): a mutating webhook that adds the sensor to every new pod. Namespace: `falcon-container-injector`.
- **Falcon KAC** (`falcon-kac` chart): Kubernetes Admission Controller for visibility and policy. Namespace: `falcon-kac`.
- **Falcon Image Analyzer** (`falcon-image-analyzer` chart): image vulnerability scanning, in Watcher mode only. Namespace: `falcon-image-analyzer`.

| Concern | EC2 nodes | EKS Fargate |
| ------- | --------- | ----------- |
| Runtime protection | DaemonSet sensor (eBPF, kernel) | Sidecar injection (user space) |
| DaemonSets and privileged containers | Allowed | **Not supported** |
| Image pull auth | Node instance profile or secret | **Pod execution role** (same-account ECR) |
| Scheduling a namespace | Any node | Needs a **Fargate profile**, or pods stay `Pending` |

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

Fill in your values once. Every command below picks them up, so you can copy each block as-is.

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,CLUSTER_NAME:EKS cluster name,AWS_ACCOUNT_ID:AWS account ID,AWS_REGION:AWS region"></div>

Export the API client secret. It is the only value kept as a shell variable, and the page never saves it:

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

### 2. Create Fargate profiles for the Falcon namespaces

On a Fargate-only cluster a pod only schedules if its namespace matches a Fargate profile. Create a profile covering the Falcon namespaces (skip this if your cluster already has matching profiles):

```bash
eksctl create fargateprofile --cluster <CLUSTER_NAME> --region <AWS_REGION> \
  --namespace falcon-container-injector \
  --namespace falcon-kac \ #@opt=kac
  --namespace falcon-image-analyzer \ #@opt=iar
  --name falcon
```

### 3. Create ECR repos and copy the images

Fargate has no nodes, so it pulls images with the pod execution role, which can read your account's ECR with no pull secret. That is why this guide copies the images into ECR instead of pulling from CrowdStrike's registry. Create the repos (skips any that already exist). Repo names must match the image names because `--copy` does not rename:

```bash
for repo in falcon-container falcon-kac falcon-imageanalyzer; do #@opt=kac #@opt=iar
for repo in falcon-container falcon-kac; do #@opt=kac #@opt=noiar
for repo in falcon-container falcon-imageanalyzer; do #@opt=nokac #@opt=iar
for repo in falcon-container; do #@opt=nokac #@opt=noiar
  aws ecr describe-repositories --repository-names $repo --region <AWS_REGION> >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name $repo --region <AWS_REGION>
done
```

Log Docker in to your ECR registry (the pull script does not log in to the destination):

```bash
aws ecr get-login-password --region <AWS_REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

Copy each image from the CrowdStrike registry into ECR (`--copy` pushes to `<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/<image-name>:<tag>`):

```bash
for t in falcon-container falcon-kac falcon-imageanalyzer; do #@opt=kac #@opt=iar
for t in falcon-container falcon-kac; do #@opt=kac #@opt=noiar
for t in falcon-container falcon-imageanalyzer; do #@opt=nokac #@opt=iar
for t in falcon-container; do #@opt=nokac #@opt=noiar
  curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
    --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type $t --copy <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
done
```

### 4. Read the image tags from ECR

`--copy` keeps each image's tag, so read it back from ECR. `falcon-container` is the **Container Sensor** (the user-space sidecar), not `falcon-sensor`, the DaemonSet Sensor that cannot run on Fargate.

```bash
export CONTAINER_TAG=$(aws ecr describe-images --repository-name falcon-container --region <AWS_REGION> --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' --output text)
export KAC_TAG=$(aws ecr describe-images --repository-name falcon-kac --region <AWS_REGION> --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' --output text) #@opt=kac
export IAR_TAG=$(aws ecr describe-images --repository-name falcon-imageanalyzer --region <AWS_REGION> --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' --output text) #@opt=iar
```

Validate the client secret and every image tag the Helm installs need was populated (a ✅ means set, a ❌ means missing):

```bash
echo "Client Secret    : $([ -n "$FALCON_CLIENT_SECRET" ] && echo ✅ || echo ❌)"
echo "Container Sensor : $([ -n "$CONTAINER_TAG" ] && echo ✅ || echo ❌) ($CONTAINER_TAG)"
echo "KAC              : $([ -n "$KAC_TAG" ] && echo ✅ || echo ❌) ($KAC_TAG)" #@opt=kac
echo "IAR              : $([ -n "$IAR_TAG" ] && echo ✅ || echo ❌) ($IAR_TAG)" #@opt=iar
```

### 5. Add Helm repo and deploy

Add the CrowdStrike chart repo:

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update
```

> **Note:** Open **Additional settings** below for GovCloud, proxy, and which components (KAC, Image Analyzer) to deploy. The commands update to match.

<div data-deploy-options></div>

Install the `falcon-sensor` chart in injector mode, pointing at the ECR image. No pull secret is needed because the pod execution role authenticates the pull.

> **Note:** Edit the highlighted `SENSOR_TAGS` field (the page replaces it when you click Copy) to group the injected sidecars in the Falcon console. Use comma-separated values; letters, numbers, `-`, `_`, `/` only.

```bash
helm upgrade --install falcon-container-injector crowdstrike/falcon-sensor \
  --namespace falcon-container-injector \
  --create-namespace \
  --set falcon.tags="<SENSOR_TAGS:eks-fargate>" \
  --set falcon.cid=<FALCON_CID> \
  --set falcon.aph=<PROXY_HOST> \ #@opt=proxy
  --set falcon.app=<PROXY_PORT> \ #@opt=proxy
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-container \
  --set container.image.tag=$CONTAINER_TAG
```

<div data-opt="kac">

Install KAC (cluster visibility and admission control):

```bash
helm upgrade --install falcon-kac crowdstrike/falcon-kac \
  --namespace falcon-kac --create-namespace \
  --set falcon.cid=<FALCON_CID> \
  --set falcon.aph=<PROXY_HOST> \ #@opt=proxy
  --set falcon.app=<PROXY_PORT> \ #@opt=proxy
  --set clusterName=<CLUSTER_NAME> \
  --set image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-kac \
  --set image.tag=$KAC_TAG
```

</div>

<div data-opt="iar">

Install Image Analyzer in Watcher mode (image vulnerability scanning):

```bash
helm upgrade --install falcon-image-analyzer crowdstrike/falcon-image-analyzer \
  --namespace falcon-image-analyzer --create-namespace \
  --set deployment.enabled=true \
  --set image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-imageanalyzer \
  --set image.tag=$IAR_TAG \
  --set crowdstrikeConfig.cid=<FALCON_CID> \
  --set crowdstrikeConfig.clusterName=<CLUSTER_NAME> \
  --set crowdstrikeConfig.clientID=<FALCON_CLIENT_ID> \
  --set crowdstrikeConfig.agentRegion=gov1 \ #@region=gov1
  --set crowdstrikeConfig.agentRegion=gov2 \ #@region=gov2
  --set crowdstrikeConfig.agentRegion=<YOUR_AGENT_REGION:us-1> \ #@region=commercial
  --set proxyConfig.HTTP_PROXY=http://<PROXY_HOST>:<PROXY_PORT> \ #@opt=proxy
  --set proxyConfig.HTTPS_PROXY=http://<PROXY_HOST>:<PROXY_PORT> \ #@opt=proxy
  --set crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET
```

</div>

> **Why this matters:** `node.enabled=false` turns off the DaemonSet sensor (Fargate has no kernel access) and `container.enabled=true` turns on injector mode. `deployment.enabled=true` selects IAR **Watcher mode**, the only mode that works on Fargate. Set the commercial `agentRegion` to your cloud (`us-1`, `us-2`, or `eu-1`); the sensor and KAC derive their region from the CID.

### 6. Verify deployment

Wait for every Falcon pod to reach `Ready`. Each namespace is checked in parallel and prints ✅ when ready or ❌ if not within 5 minutes:

```bash
(
for ns in falcon-container-injector falcon-kac falcon-image-analyzer; do #@opt=kac #@opt=iar
for ns in falcon-container-injector falcon-kac; do #@opt=kac #@opt=noiar
for ns in falcon-container-injector falcon-image-analyzer; do #@opt=nokac #@opt=iar
for ns in falcon-container-injector; do #@opt=nokac #@opt=noiar
  (kubectl wait --for=condition=Ready pods --all -n $ns --timeout=300s >/dev/null 2>&1 \
    && echo "✅ $ns: Ready" \
    || echo "❌ $ns: not Ready (run: kubectl get pods -n $ns)") &
done
wait
)
```

> **Heads-up:** Fargate starts a separate micro-VM for every pod, so the first pods take about a minute to come up. A pod stuck in `Pending` almost always means its namespace has no matching Fargate profile (step 2).

Then list the Falcon pods:

```bash
kubectl get pods -A -o wide | grep falcon
```

Every pod should show `STATUS` `Running`, and the `NODE` column should start with `fargate-ip-` (proof the pod landed on Fargate). The injector shows `1/1` or `2/2` replicas, KAC `3/3`, and Image Analyzer `1/1`.

### 7. Test a detection (optional)

Create a Fargate profile for the app namespace so its pods can schedule (this is what puts the app on Fargate, where the sidecar gets injected):

```bash
eksctl create fargateprofile --cluster <CLUSTER_NAME> --region <AWS_REGION> \
  --name app-workloads \
  --namespace detection-vulnapp
```

Create the app namespace:

```bash
kubectl create namespace detection-vulnapp
```

Deploy the CrowdStrike vulnapp, a web app that fires safe, simulated attacks:

```bash
kubectl apply -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

Confirm the Falcon sidecar was injected:

```bash
kubectl get pod -l run=vulnerable.example.com -n detection-vulnapp -o jsonpath='{.items[0].spec.containers[*].name}'
```

> **Verify:** The output should include `crowdstrike-falcon-container` next to your app container (`vulnapp`). If it only shows the app container, the webhook did not reach this namespace; check the injector pods from step 6.

Port-forward the app to your machine (this blocks, so leave it running):

```bash
kubectl port-forward -n detection-vulnapp svc/vulnerable-example-com 8060:80
```

Open [http://localhost:8060](http://localhost:8060) and click any attack simulation. Then check **Falcon Console** > **Next-Gen SIEM** > **Monitor and investigate** > **Detections** (filter **Source product** = **Cloud**). Stop the port-forward (Ctrl+C) when done.

### 8. Clean up (optional)

Removes everything this guide deployed. Your EKS cluster itself is not touched.

```bash
kubectl delete -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
helm uninstall falcon-container-injector -n falcon-container-injector
```

Remove KAC and Image Analyzer if you installed them:

```bash
helm uninstall falcon-kac -n falcon-kac #@opt=kac
helm uninstall falcon-image-analyzer -n falcon-image-analyzer #@opt=iar
```

Delete the namespaces and the ECR repos (`--force` removes repos that still hold images):

```bash
kubectl delete namespace detection-vulnapp falcon-container-injector falcon-kac falcon-image-analyzer --ignore-not-found
for repo in falcon-container falcon-kac falcon-imageanalyzer; do
  aws ecr delete-repository --repository-name $repo --force --region <AWS_REGION>
done
```

> **Note:** Host entries stay in the Falcon console for a while after the sidecars are gone. The `falcon` and `app-workloads` Fargate profiles remain on the cluster; delete them with `eksctl delete fargateprofile --cluster <CLUSTER_NAME> --name <profile>` if you no longer need them.

</div>

<div data-mode="lab">

## 1. Provision an EKS Fargate-Only Cluster

> **What & Why:** A Fargate-only cluster has zero EC2 nodes. Every pod, including CoreDNS, runs in its own micro-VM. This forces the serverless protection model (sidecar injection) and makes the "every namespace needs a Fargate profile" rule impossible to skip. It mirrors production teams who run fully serverless Kubernetes.

### Step 1: Install and authenticate the AWS tools

> **What & Why:** Fresh machines often hit "command not found" or "Unable to locate credentials" on the first provision command. Install the tools and log in first. The panel below sets the cluster name and region used in every command that follows.

<div data-lab-variables></div>

- [ ] Install the [`aws` CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), [`eksctl`](https://eksctl.io/installation/), and `kubectl`, then log in:

```bash
aws configure   # or: aws sso login
```

- [ ] Confirm you are the expected AWS principal:

```bash
aws sts get-caller-identity
```

The `Account` value is where the cluster and ECR repos will be created. Your IAM principal needs the [eksctl minimum policies](https://eksctl.io/usage/minimum-iam-policies/) (EC2, EKS, IAM, CloudFormation, VPC).

### Step 2: Create the cluster

> **What & Why:** The Fargate profiles are the whole game on a nodeless cluster. A namespace with no matching profile can never schedule a pod. We pre-declare profiles for `default`/`kube-system` (CoreDNS), the three Falcon namespaces, and a `detection-vulnapp` namespace for testing. Cluster creation takes several minutes; do not Ctrl+C.

> **Why this matters:** A **Fargate profile** tells EKS which pods run on Fargate, matched by namespace (and optional labels). EKS also creates a **pod execution role** for the profile. That IAM role is what lets Fargate pull images from ECR and write logs; you never attach it to pods yourself. `AmazonEKSFargatePodExecutionRolePolicy` on that role is why same-account ECR pulls need no pull secret later.

- [ ] **Console:** Navigate to **EKS** → **Clusters** → **Create cluster** → set name `{{CLUSTER_NAME}}` and a cluster service role (create one if you do not have `AmazonEKSClusterRole`) → accept the default VPC and subnets → **Create**
- [ ] When the cluster shows **Active**, open it → **Compute** tab → **Add Fargate profile** and create three profiles, each with its own pod execution role (create `AmazonEKSFargatePodExecutionRole` once, then reuse it):
  - `falcon`: namespaces `falcon-container-injector`, `falcon-kac`, `falcon-image-analyzer`
  - `app-workloads`: namespace `detection-vulnapp`
  - `default`: namespaces `default`, `kube-system`
- [ ] Open **Add-ons** → **CoreDNS** → **Edit** → set **Compute type** to **Fargate** (a nodeless cluster has nowhere else to run it)

<details>
<summary>CLI equivalent</summary>

`eksctl` collapses all of the above into one config file and fixes CoreDNS for you, since no managed node group is defined:

```bash
cat <<'EOF' > eksctl-fargate.yaml
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig

metadata:
  name: {{CLUSTER_NAME}}
  region: {{REGION}}

iam:
  withOIDC: true

fargateProfiles:
  - name: default
    selectors:
      - namespace: default
      - namespace: kube-system
  - name: falcon
    selectors:
      - namespace: falcon-container-injector
      - namespace: falcon-kac
      - namespace: falcon-image-analyzer
  - name: app-workloads
    selectors:
      - namespace: detection-vulnapp
EOF
```

```bash
eksctl create cluster -f eksctl-fargate.yaml
```

</details>

> **Note:** The `tf-k8s-eks-fargate-lab` Terraform project provisions the same nodeless cluster **and** the three ECR repos this lab uses. If you applied it, skip this step and run `aws eks update-kubeconfig --region {{REGION}} --name {{CLUSTER_NAME}}`. The repo-creation step in Section 2 then becomes a no-op.

### Step 3: Verify the serverless setup

- [ ] Confirm kubectl points at the new cluster (the output should contain `{{CLUSTER_NAME}}`):

```bash
kubectl config current-context
```

- [ ] Confirm there are no EC2 nodes yet (Fargate nodes only appear once pods schedule onto them):

```bash
kubectl get nodes
```

- [ ] Confirm the Fargate profiles exist:

```bash
eksctl get fargateprofile --cluster {{CLUSTER_NAME}} --region {{REGION}}
```

You should see `default`, `falcon`, and `app-workloads`.

- [ ] Confirm CoreDNS is running on Fargate:

```bash
kubectl get pods -n kube-system -o wide -l k8s-app=kube-dns
```

> **Look for:** `STATUS` `Running` and a `NODE` value that starts with `fargate-ip-`. That proves CoreDNS itself moved to Fargate. If the pods are `Pending`, the `kube-system` namespace is missing from a Fargate profile.

---

## 2. Stage Images in ECR

> **What & Why:** On Fargate, image pulls are authenticated by the pod execution role, not by an `imagePullSecret`. Hosting the three Falcon images in same-account ECR means that role authenticates every pull, so there is no pull token to mint, no secret to propagate, and no namespace-ordering caveat. Image Analyzer still needs API credentials at runtime for vulnerability reporting; that is unrelated to image pulls.

### Step 1: Create an API client

- [ ] Navigate to **Falcon Console** > **Support and resources** > **API clients and keys** > **Create API client**
- [ ] Set the following OAuth 2.0 scopes:
  - Sensor Download: **Read**
  - Falcon Images Download: **Read**
  - Falcon Container Image: **Read/Write**
  - Falcon Container CLI: **Read/Write**

<details>
<summary>CLI equivalent</summary>

There is no CLI for creating API clients; this must be done in the console.

</details>

### Step 2: Fill in your values and export the secret

- [ ] Fill in your values once. Every command below picks them up, so you can copy each block as-is. Use the `Account` value from `aws sts get-caller-identity` in Section 1 for the account ID:

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,AWS_ACCOUNT_ID:AWS account ID"></div>

- [ ] Export the API client secret. It is the only value kept as a shell variable, and the page never saves it:

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

### Step 3: Create the ECR repositories

> **What & Why:** The pull script's `--copy` flag pushes to `<registry>/<image-name>:<tag>` but does **not** create the destination repo. The image names are fixed (`falcon-container`, `falcon-kac`, `falcon-imageanalyzer`, with no hyphen in the last one), so the repos must use exactly those names. ECR (Elastic Container Registry) is AWS's private image registry; each image name gets its own repository.

- [ ] **Console:** Navigate to **ECR** → **Private registry** → **Repositories** → **Create repository** → set the repository name to `falcon-container` → **Create**. Repeat for `falcon-kac` and `falcon-imageanalyzer`.

<details>
<summary>CLI equivalent</summary>

Idempotent, so it is safe to re-run or to use after the Terraform project already created them:

```bash
for repo in falcon-container falcon-kac falcon-imageanalyzer; do
  aws ecr describe-repositories --repository-names $repo --region {{REGION}} >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name $repo --region {{REGION}}
done
```

</details>

### Step 4: Log Docker in to ECR

> **What & Why:** The pull script logs in to the **CrowdStrike** registry to read the images, but it does **not** log in to your **destination** registry. You must authenticate Docker to ECR yourself before `--copy` can push.

- [ ] Authenticate to your ECR registry (the output should end with `Login Succeeded`):

```bash
aws ecr get-login-password --region {{REGION}} | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com
```

### Step 5: Copy the images into ECR

- [ ] Copy each image from the CrowdStrike registry to ECR (`--copy` pushes to `<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/<image-name>:<tag>`):

```bash
for t in falcon-container falcon-kac falcon-imageanalyzer; do
  curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
    --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type $t --copy <AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com
done
```

- [ ] **Console:** Open **ECR** → **Repositories** → each `falcon-*` repo and confirm it holds one image with a version tag.

### Step 6: Read the image tags from ECR

> **What & Why:** The sidecar sensor is the `falcon-container` image type, the user-space **Container Sensor**. It is distinct from `falcon-sensor`, the **DaemonSet Sensor**, a kernel-mode image that cannot run on Fargate. Because `--copy` preserved each image's original tag, read it back from ECR rather than calling the pull script again. The tag you deploy is then exactly what landed in your registry.

- [ ] Capture each tag from ECR:

```bash
export CONTAINER_TAG=$(aws ecr describe-images --repository-name falcon-container --region {{REGION}} --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' --output text)
export KAC_TAG=$(aws ecr describe-images --repository-name falcon-kac --region {{REGION}} --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' --output text)
export IAR_TAG=$(aws ecr describe-images --repository-name falcon-imageanalyzer --region {{REGION}} --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' --output text)
```

- [ ] Validate the client secret and every tag populated (a ✅ means set, a ❌ means missing):

```bash
echo "Client Secret    : $([ -n "$FALCON_CLIENT_SECRET" ] && echo ✅ || echo ❌)"
echo "Container Sensor : $([ -n "$CONTAINER_TAG" ] && echo ✅ || echo ❌) ($CONTAINER_TAG)"
echo "KAC              : $([ -n "$KAC_TAG" ] && echo ✅ || echo ❌) ($KAC_TAG)"
echo "IAR              : $([ -n "$IAR_TAG" ] && echo ✅ || echo ❌) ($IAR_TAG)"
```

> **Look for:** a ✅ on every line. A ❌ on a tag means that repo is empty, so re-run the matching `--copy` in Step 5. `None` as a tag value means the image was pushed untagged.

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

> **What & Why:** Fargate pods have no host to run a DaemonSet on, so runtime protection comes from a mutating admission webhook. When a pod is created in an injectable namespace, the webhook patches the pod spec to add the Falcon Container Sensor as a sidecar. Any Fargate-profiled namespace can be injected at any time — the ordering that a pull secret would impose doesn't apply here.

### Step 1: Install the injector

- [ ] Install the `falcon-sensor` chart in injector mode, pointing at your ECR image:

```bash
helm upgrade --install falcon-container-injector crowdstrike/falcon-sensor \
  --namespace falcon-container-injector \
  --create-namespace \
  --set falcon.tags="<SENSOR_TAGS:eks-fargate>" \
  --set falcon.cid=<FALCON_CID> \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-container \
  --set container.image.tag=$CONTAINER_TAG
```

> `node.enabled=false` disables the DaemonSet (no kernel on Fargate). `container.enabled=true` activates injector mode. To scope injection to specific namespaces instead of all of them, see Challenge 1.

### Step 2: Verify the injector is running on Fargate

- [ ] Confirm the injector pods are running:

```bash
kubectl get pods -n falcon-container-injector -o wide
```

> **Look for:** `STATUS` `Running`, `READY` `1/1` (or `2/2`), and a `NODE` value starting with `fargate-ip-`. The injector pods themselves run on Fargate, so the `falcon` profile from Section 1 must cover this namespace or they stay `Pending`.

- [ ] Confirm the mutating webhook is registered:

```bash
kubectl get mutatingwebhookconfigurations | grep falcon
```

You should see one `falcon` webhook configuration. This is the object that intercepts every new pod and adds the sidecar.

---

## 5. Deploy the Kubernetes Admission Controller (KAC)

> **What & Why:** KAC gives you cluster-wide Kubernetes visibility and admission-time policy enforcement. It's a single non-privileged Deployment (three containers, all `readOnlyRootFilesystem`, `runAsNonRoot`), so it's fully Fargate-compatible — its namespace just needs a Fargate profile (already created in Section 1).

### Step 1: Install KAC

- [ ] Deploy the `falcon-kac` chart from your ECR repo:

```bash
helm upgrade --install falcon-kac crowdstrike/falcon-kac \
  --namespace falcon-kac \
  --create-namespace \
  --set falcon.cid=<FALCON_CID> \
  --set clusterName={{CLUSTER_NAME}} \
  --set image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-kac \
  --set image.tag=$KAC_TAG
```

> KAC's pod-validating webhook defaults to `failurePolicy: Ignore`, which is the safer setting on Fargate — an admission hiccup won't block pod scheduling. KAC also auto-excludes `kube-system`, `kube-public`, `falcon-system`, and its own namespace.

### Step 2: Verify KAC

- [ ] Confirm the KAC pod is running (one pod, three containers):

```bash
kubectl get pods -n falcon-kac -o wide
```

> **Look for:** `READY` `3/3` and `STATUS` `Running`. Then list the container names:

```bash
kubectl get pod -n falcon-kac -o jsonpath='{.items[0].spec.containers[*].name}'
```

The output should be `falcon-client falcon-watcher falcon-ac`.

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
  --set image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-imageanalyzer \
  --set image.tag=$IAR_TAG \
  --set crowdstrikeConfig.cid=<FALCON_CID> \
  --set crowdstrikeConfig.clusterName={{CLUSTER_NAME}} \
  --set crowdstrikeConfig.clientID=<FALCON_CLIENT_ID> \
  --set crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET \
  --set crowdstrikeConfig.agentRegion=<YOUR_AGENT_REGION:us-1>
```

> **Why this matters:** `deployment.enabled=true` selects Watcher mode. **Never** set `daemonset.enabled=true` on Fargate. `crowdstrikeConfig.*` supplies the **runtime** API credentials IAR uses to upload assessments (unrelated to image pulls), and `crowdstrikeConfig.cid` is required because the chart's values schema rejects a null CID.

> **Note:** Set `agentRegion` to your Falcon cloud: `us-1`, `us-2`, or `eu-1` for commercial. For GovCloud this flag is **required**, so use `gov1` (US-GOV-1) or `gov2` (US-GOV-2). Unlike Image Analyzer, the injector and KAC derive their region from the CID.

> **Sizing caveat:** IAR mounts a `tmp-volume` emptyDir (default 20Gi) sized to ~2× the largest image it scans. On Fargate this consumes the pod's ephemeral storage, so a scan-heavy IAR pod may need a larger Fargate configuration. Watch for `Evicted` pods and raise the volume/ephemeral-storage request if needed.

### Step 2: Verify IAR

- [ ] Confirm the IAR pod is running as a Deployment (not a DaemonSet):

```bash
kubectl get deploy -n falcon-image-analyzer
kubectl get pods -n falcon-image-analyzer -o wide
```

---

## 7. Verify Fargate Coverage

> **What & Why:** Verification means proving the injection path works end to end: a new pod in a Fargate-profiled namespace should come up with the Falcon sidecar attached and register as a host in the Falcon console.

### Step 1: Confirm all Falcon pods are Running

- [ ] List every Falcon pod across all namespaces:

```bash
kubectl get pods -A -o wide | grep falcon
```

> **Look for:** pods in three namespaces, all `Running`, each with a `NODE` value starting with `fargate-ip-`: `falcon-container-injector` (the injector), `falcon-kac` (KAC, `3/3`), and `falcon-image-analyzer` (Image Analyzer, `1/1`).

### Step 2: Deploy the vulnapp into a Fargate-profiled namespace

> **Why this matters:** The `detection-vulnapp` namespace is covered by the `app-workloads` Fargate profile from Section 1. Because Fargate pulls with the pod execution role, you can create this namespace at any time; there is no pull secret to seed ahead of the injector.

- [ ] Create the namespace:

```bash
kubectl create namespace detection-vulnapp
```

- [ ] Deploy the CrowdStrike vulnapp, a web app that fires safe, simulated attacks:

```bash
kubectl apply -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

- [ ] Wait for the pod to become Ready (Fargate starts a separate micro-VM per pod, so expect about a minute):

```bash
kubectl wait --for=condition=Ready pods --all -n detection-vulnapp --timeout=300s
```

### Step 3: Verify sidecar injection

- [ ] Confirm the Falcon sidecar was injected into the pod:

```bash
kubectl get pod -l run=vulnerable.example.com -n detection-vulnapp -o jsonpath='{.items[0].spec.containers[*].name}'
```

> **Verify:** The output should include `crowdstrike-falcon-container` next to your app container (`vulnapp`). If it is missing, the webhook did not reach this namespace, so re-check Section 4. If the pod is stuck in `Init:ImagePullBackOff`, confirm the images are in ECR (Section 2) and that the Fargate pod execution role carries `AmazonEKSFargatePodExecutionRolePolicy`.

### Step 4: Verify in the Falcon console

- [ ] Navigate to **Falcon Console** > **Host setup and management** > **Host management**
- [ ] Filter by **Grouping Tags** with the tag you set at deploy time (`eks-fargate` by default)
- [ ] The Fargate pod should appear as a host within a few minutes

### Step 5: Troubleshooting

If a pod is not Running or a sidecar never registers, work through this table:

| Symptom | Likely cause | Check |
|---------|--------------|-------|
| Pod stuck in `Pending` | The namespace has no matching Fargate profile | `eksctl get fargateprofile --cluster {{CLUSTER_NAME}} --region {{REGION}}`, then add the namespace to a profile |
| `ImagePullBackOff` or `Init:ImagePullBackOff` | Image missing from ECR, or wrong repo name or tag | `kubectl describe pod <name> -n <ns>` and read `Events`; re-run the Section 2 validate block |
| Pod Running but no `crowdstrike-falcon-container` | Webhook did not reach the namespace, or pod predates the injector | `kubectl get mutatingwebhookconfigurations \| grep falcon`; delete and recreate the pod |
| Sidecar Running but no host in console | Egress to the Falcon cloud blocked, or still registering | `kubectl logs <pod> -n <ns> -c crowdstrike-falcon-container`; wait 5 more minutes |
| `helm status` shows `failed` | Empty variable in a `--set` value | Re-run the Section 2 Step 6 validate block; any ❌ means an earlier step failed silently |

---

## 8. Test a Detection (Optional)

> **What & Why:** Hosts registering proves connectivity; a detection proves the sidecar is actively monitoring. The vulnapp's web UI fires safe, simulated attacks.

### Step 1: Trigger a simulated attack

- [ ] Port-forward to the vulnapp service (this blocks, so leave it running):

```bash
kubectl port-forward -n detection-vulnapp svc/vulnerable-example-com 8060:80
```

- [ ] Open [http://localhost:8060](http://localhost:8060) and click any attack simulation (for example **Access sensitive files**, **Kill process**, or **Run a reverse shell**)

### Step 2: Confirm the detection

- [ ] In the Falcon console, go to **Next-Gen SIEM** > **Monitor and investigate** > **Detections**, then filter **Source product** = **Cloud**
- [ ] A detection tied to the Fargate pod should appear within a few minutes. Stop the port-forward (Ctrl+C) when done.

### Step 3: Remove the vulnapp

- [ ] Delete the test app:

```bash
kubectl delete -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

---

## 9. Cleanup

> **Destructive:** This removes the Falcon components, the ECR repos and their images, and the EKS cluster. Run it only when you are finished with the lab.

### Step 1: Uninstall the Helm releases

- [ ] Remove all three releases:

```bash
helm uninstall falcon-container-injector -n falcon-container-injector
helm uninstall falcon-kac -n falcon-kac
helm uninstall falcon-image-analyzer -n falcon-image-analyzer
```

- [ ] Delete the namespaces:

```bash
kubectl delete namespace falcon-container-injector falcon-kac falcon-image-analyzer detection-vulnapp
```

> **Verify:** `kubectl get pods -A | grep falcon` should print nothing.

### Step 2: Delete the ECR repositories

- [ ] **Console:** Navigate to **ECR** → **Private registry** → **Repositories** → select the three `falcon-*` repos → **Delete** → type `delete` to confirm

<details>
<summary>CLI equivalent</summary>

`--force` removes a repo even if it still holds images:

```bash
for repo in falcon-container falcon-kac falcon-imageanalyzer; do
  aws ecr delete-repository --repository-name $repo --force --region {{REGION}}
done
```

</details>

> **Note:** If you created the repos with the `tf-k8s-eks-fargate-lab` Terraform, run `terraform destroy` there instead of this step. The repos use `force_delete = true`, so they are removed with the rest of the stack.

### Step 3: Delete the cluster

- [ ] **Console:** Navigate to **EKS** → **Clusters** → select `{{CLUSTER_NAME}}` → **Delete cluster**. If prompted, delete the Fargate profiles first (**Compute** tab), one at a time.

<details>
<summary>CLI equivalent</summary>

`eksctl` deletes the Fargate profiles, IAM roles, and VPC it created, in the right order:

```bash
eksctl delete cluster --name {{CLUSTER_NAME}} --region {{REGION}}
```

</details>

---

## 10. Challenges

### Challenge 1: Opt-in injection via namespace label

**Scenario:** Your platform team runs many namespaces on Fargate and only wants Falcon injected into approved workload namespaces — not everything. Reconfigure the injector so injection is **opt-in** rather than all-namespaces.

<details>
<summary>Hint</summary>

Look at `container.disableNSInjection` and the per-namespace label the injector honors. When injection is disabled by default, you enable it per namespace with a label.

</details>

<details>
<summary>Solution</summary>

Redeploy the injector with namespace-scoped injection disabled by default:

```bash
helm upgrade --install falcon-container-injector crowdstrike/falcon-sensor \
  --namespace falcon-container-injector \
  --create-namespace \
  --set falcon.tags="<SENSOR_TAGS:eks-fargate>" \
  --set falcon.cid=<FALCON_CID> \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.disableNSInjection=true \
  --set container.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-container \
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
<summary>Hint</summary>

Fargate rounds each pod up to the next CPU/memory configuration based on the **sum of all container requests**. The injected sidecar's requests come from `container.sensorResources` in the falcon-sensor chart.

</details>

<details>
<summary>Solution</summary>

Set `container.sensorResources` so every injected sidecar carries a known, modest request:

```bash
helm upgrade --install falcon-container-injector crowdstrike/falcon-sensor \
  --namespace falcon-container-injector \
  --reuse-values \
  --set container.sensorResources.requests.cpu=100m \
  --set container.sensorResources.requests.memory=256Mi
```

Because Fargate bills at discrete sizes (starting at 0.25 vCPU / 0.5 GB) and rounds up the sum of all container requests, an unbounded sidecar request can silently bump a pod into the next tier. Setting explicit requests makes the total predictable — you can right-size the app + sidecar to land just under a Fargate boundary. Tune from real telemetry after observing steady-state usage.

</details>

### Challenge 3: Pull from a cross-account ECR

**Scenario:** Your organization hosts golden images in a central "shared services" AWS account and each workload account runs its own EKS Fargate cluster. Configure the Fargate pods to pull the Falcon images from an ECR repo in a **different** account.

<details>
<summary>Hint</summary>

Same-account pulls work because `AmazonEKSFargatePodExecutionRolePolicy` grants ECR on `Resource: *`, but the **repository's own resource policy** still has to allow the calling account. Cross-account needs a repository policy on the source repo **and** the reader's pod execution role must be allowed to pull.

</details>

<details>
<summary>Solution</summary>

Two pieces are required — one in each account.

**1. In the account that owns the ECR repo**, attach a repository policy that allows the consumer account's pod execution role to pull:

```bash
aws ecr set-repository-policy --repository-name falcon-container --region {{REGION}} \
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
POD_EXEC_ROLE=$(aws eks describe-fargate-profile --cluster-name {{CLUSTER_NAME}} --fargate-profile-name app-workloads \
  --query 'fargateProfile.podExecutionRoleArn' --output text | awk -F/ '{print $NF}')
aws iam attach-role-policy --role-name $POD_EXEC_ROLE \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
```

Then point the charts at the cross-account registry (`<OWNER_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/falcon-container`, etc.). `GetAuthorizationToken` is always called against the caller's own account, so no `imagePullSecret` is needed — the repository policy is what authorizes the cross-account read.

</details>

---

## Quick Reference

| Action | Console Path | CLI Command |
|--------|-------------|-------------|
| Create the cluster | **EKS** → **Clusters** → **Create cluster** | `eksctl create cluster -f eksctl-fargate.yaml` |
| List Fargate profiles | **EKS** → cluster → **Compute** tab | `eksctl get fargateprofile --cluster {{CLUSTER_NAME}} --region {{REGION}}` |
| Create ECR repos | **ECR** → **Private registry** → **Repositories** → **Create repository** | `aws ecr create-repository --repository-name <repo> --region {{REGION}}` |
| Docker login to ECR | n/a | `aws ecr get-login-password --region {{REGION}} \| docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com` |
| Copy an image to ECR | n/a | `... falcon-container-sensor-pull.sh --type <t> --copy <AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com` |
| Sidecar image type | n/a | `--type falcon-container` (NOT `falcon-sensor`) |
| ECR repo names | **ECR** → **Repositories** | `falcon-container`, `falcon-kac`, `falcon-imageanalyzer` (must match `--copy` names) |
| Fargate image pull auth | **IAM** → **Roles** → pod execution role | `AmazonEKSFargatePodExecutionRolePolicy`; no pull secret |
| Enable injector mode | n/a | `--set node.enabled=false --set container.enabled=true` |
| Opt-in injection | n/a | `--set container.disableNSInjection=true` + namespace label |
| Sidecar sizing | n/a | `--set container.sensorResources.requests.{cpu,memory}` |
| Image Analyzer mode | n/a | `--set deployment.enabled=true` (Watcher, never DaemonSet) |
| Injected container name | n/a | `crowdstrike-falcon-container` |
| Namespaces needing a profile | **EKS** → cluster → **Compute** → **Add Fargate profile** | Every Falcon namespace, `kube-system`, and app namespaces |

</div>

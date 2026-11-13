# Falcon Sidecar Injection on EKS Fargate — Serverless Kubernetes Protection

Deploy CrowdStrike Falcon on an EKS **Fargate-only** cluster (no EC2 nodes) using the sidecar injector for runtime protection, plus KAC for admission control and Image Analyzer for image scanning.

> **Performance note (measured on this lab's cluster):**
>
> - **Startup:** Bare pod ~53s to Ready; injected ~62s — the sidecar adds **~10s** (init container + sensor launch).
> - **Runtime footprint (idle):** ~**33 MiB** memory (~23 MiB RSS) and **<1 millicore** CPU per protected pod. CPU scales with syscall/process-event volume.

> **Prerequisites:**
>
> - Helm 3 or later installed (`helm version` prints a version)
> - `aws` CLI and `kubectl` installed and configured (`eksctl` is optional: Quick Deploy creates the Fargate profiles with the AWS CLI by default, or the AWS Console, and only the Full Lab needs `eksctl` to provision the cluster)
> - Docker, Podman, or Skopeo installed **and running** (to copy the images to ECR; `docker info` should print server details, not an error. Start Docker Desktop if it fails)
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
> **Note:** This lab hosts all three Falcon images in **same-account ECR**. On Fargate, image pulls are authenticated by the **Fargate pod execution role**, so no image pull secret is used.

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

The `falcon-platform` chart deploys three components in one Helm release:

- **Sidecar Injector** (`falcon-sensor` subchart, injector mode): a mutating webhook that adds the sensor to every new pod. Namespace: `falcon-system`.
- **Falcon KAC** (`falcon-kac` subchart): Kubernetes Admission Controller for visibility and policy. Namespace: `falcon-kac`.
- **Falcon Image Analyzer** (`falcon-image-analyzer` subchart): image vulnerability scanning, in Watcher mode only. Namespace: `falcon-image-analyzer`.

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

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,CLUSTER_NAME:EKS cluster name,AWS_ACCOUNT_ID:AWS account ID,AWS_REGION:AWS region"></div>

Then copy this to export the API client secret. It is the only value kept as a shell variable, and the page never saves it:

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

### 2. Create the Fargate profile for the Falcon namespaces

On a Fargate-only cluster a pod only schedules if its namespace matches a Fargate profile. Create one that covers the Falcon namespaces (skip this if your cluster already has matching profiles).

<div data-profile-picker></div>

<div data-profile="console">

1. In the AWS Console, open **EKS** > **Clusters** > your cluster > **Compute** tab, and under **Fargate profiles** choose **Add Fargate profile**.
2. **Name:** `falcon`. **Pod execution role:** pick the role your existing Fargate profile uses (for example the one on the `system` profile). Choose **Next**.
3. **Subnets:** keep the cluster's private subnets. Choose **Next**.
4. Under **Pod selectors**, choose **Add selector** once per namespace below, leaving **Match labels** empty:

```text
falcon-system
falcon-kac #@opt=kac
falcon-image-analyzer #@opt=iar
```

5. Choose **Next**, then **Create**. The profile shows **Creating** for a minute or two; wait until it is **Active**.

> **Why this matters:** The pod execution role is what lets Fargate pull your ECR images and write logs on behalf of the pods. EKS attaches it to every pod that matches a profile, so you never set it on pods yourself. Reusing the role from your existing profile is fine.

> **Verify:** Open the new profile. **Pod selectors** should list every namespace above. A missing namespace means its pods stay `Pending` later.

</div>

<div data-profile="awscli">

A Fargate profile needs a pod execution role and private subnets. Reuse the ones from a profile your cluster already has. List the existing profile names:

```bash
aws eks list-fargate-profiles --cluster-name <CLUSTER_NAME> --region <AWS_REGION> --query fargateProfileNames --output text
```

Create the `falcon` profile with one selector per Falcon namespace. It copies the pod execution role and subnets from an existing profile (replace `<EXISTING_PROFILE>` with a name from the list above):

```bash
aws eks create-fargate-profile --cluster-name <CLUSTER_NAME> \
  --fargate-profile-name falcon \
  --pod-execution-role-arn $(aws eks describe-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name <EXISTING_PROFILE> --region <AWS_REGION> --query fargateProfile.podExecutionRoleArn --output text) \
  --subnets $(aws eks describe-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name <EXISTING_PROFILE> --region <AWS_REGION> --query fargateProfile.subnets --output text) \
  --selectors namespace=falcon-system \
  namespace=falcon-kac \ #@opt=kac
  namespace=falcon-image-analyzer \ #@opt=iar
  --region <AWS_REGION>
```

> **Why this matters:** The pod execution role is what lets Fargate pull your ECR images and write logs on behalf of the pods. EKS attaches it to every pod that matches a profile, so you never set it on pods yourself. Reusing the role from your existing profile is fine.

The profile takes a minute or two to create. Wait for it to become active:

```bash
aws eks wait fargate-profile-active --cluster-name <CLUSTER_NAME> --fargate-profile-name falcon --region <AWS_REGION>
```

Confirm all the namespaces were registered:

```bash
aws eks describe-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name falcon --region <AWS_REGION> --query 'fargateProfile.selectors[].namespace' --output text
```

> **Verify:** The output should list every Falcon namespace. A missing namespace means its pods stay `Pending` later. If `create-fargate-profile` returns `ResourceInUseException`, a profile named `falcon` already exists; use `describe-fargate-profile` above to check its namespaces.

</div>

<div data-profile="eksctl">

Write a profile that covers the Falcon namespaces:

```bash
cat <<'EOF' > falcon-fargate-profile.yaml
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig
metadata:
  name: <CLUSTER_NAME>
  region: <AWS_REGION>
fargateProfiles:
  - name: falcon
    selectors:
      - namespace: falcon-system
      - namespace: falcon-kac #@opt=kac
      - namespace: falcon-image-analyzer #@opt=iar
EOF
```

Create it:

```bash
eksctl create fargateprofile -f falcon-fargate-profile.yaml
```

> **Heads-up:** Use a config file because `eksctl create fargateprofile --namespace` accepts only one namespace. Repeating the flag does not error, it silently keeps just the last one.

Confirm all the namespaces were registered:

```bash
eksctl get fargateprofile --cluster <CLUSTER_NAME> --region <AWS_REGION> --name falcon -o yaml
```

> **Verify:** The output should list every Falcon namespace under `selectors`. If a namespace is missing, its pods will stay `Pending` later.

</div>

### 3. Create ECR repos and copy the images

Fargate has no nodes, so it pulls images with the pod execution role, which can read your account's ECR with no pull secret. That is why this guide copies the images into ECR instead of pulling from CrowdStrike's registry. Create the repos (skips any that already exist). Repo names must match the image names because `--copy` does not rename:

```bash
for repo in falcon-container falcon-kac falcon-imageanalyzer; do #@opt=kac #@opt=iar
for repo in falcon-container falcon-kac; do #@opt=kac #@opt=noiar
for repo in falcon-container falcon-imageanalyzer; do #@opt=nokac #@opt=iar
for repo in falcon-container; do #@opt=nokac #@opt=noiar
  aws ecr describe-repositories --repository-names $repo --region <AWS_REGION> >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name $repo --region <AWS_REGION> --query repository.repositoryUri --output text
done
```

> **Verify:** Each new repo prints its address (for example `<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-kac`). Nothing prints for a repo that already exists.

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
export CONTAINER_TAG=$(aws ecr describe-images --repository-name falcon-container --region <AWS_REGION> --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
export KAC_TAG=$(aws ecr describe-images --repository-name falcon-kac --region <AWS_REGION> --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text) #@opt=kac
export IAR_TAG=$(aws ecr describe-images --repository-name falcon-imageanalyzer --region <AWS_REGION> --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text) #@opt=iar
```

Validate the client secret and every image tag the Helm installs need was populated (a ✅ means set, a ❌ means missing):

```bash
echo "Client Secret    : $([ -n "$FALCON_CLIENT_SECRET" ] && echo ✅ || echo ❌)"
echo "Container Sensor : $([ -n "$CONTAINER_TAG" ] && [ "$CONTAINER_TAG" != None ] && echo ✅ || echo ❌) ($CONTAINER_TAG)"
echo "KAC              : $([ -n "$KAC_TAG" ] && [ "$KAC_TAG" != None ] && echo ✅ || echo ❌) ($KAC_TAG)" #@opt=kac
echo "IAR              : $([ -n "$IAR_TAG" ] && [ "$IAR_TAG" != None ] && echo ✅ || echo ❌) ($IAR_TAG)" #@opt=iar
```

### 5. Add Helm repo and deploy

Add the CrowdStrike chart repo:

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update
```

> **Note:** Open **Additional settings** below for GovCloud, proxy, and which components (KAC, Image Analyzer) to deploy. The commands update to match.

<div data-deploy-options></div>

Install the `falcon-platform` chart, which deploys the injector, KAC, and Image Analyzer in one release. No pull secret is needed because the pod execution role authenticates the pull.

> **Note:** Edit the highlighted `SENSOR_TAGS` field (the page replaces it when you click Copy) to group the injected sidecars in the Falcon console. Use comma-separated values; letters, numbers, `-`, `_`, `/` only.

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set global.falcon.cid=<FALCON_CID> \
  --set falcon-sensor.falcon.tags="<SENSOR_TAGS:eks-fargate>" \
  --set falcon-sensor.falcon.aph=<PROXY_HOST> \ #@opt=proxy
  --set falcon-sensor.falcon.app=<PROXY_PORT> \ #@opt=proxy
  --set falcon-sensor.node.enabled=false \
  --set falcon-sensor.container.enabled=true \
  --set falcon-sensor.container.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-container \
  --set falcon-sensor.container.image.tag=$CONTAINER_TAG \
  --set falcon-kac.enabled=false \ #@opt=nokac
  --set falcon-kac.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-kac \ #@opt=kac
  --set falcon-kac.image.tag=$KAC_TAG \ #@opt=kac
  --set falcon-kac.falcon.aph=<PROXY_HOST> \ #@opt=kac #@opt=proxy
  --set falcon-kac.falcon.app=<PROXY_PORT> \ #@opt=kac #@opt=proxy
  --set falcon-image-analyzer.enabled=false \ #@opt=noiar
  --set falcon-image-analyzer.deployment.enabled=true \ #@opt=iar
  --set falcon-image-analyzer.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-imageanalyzer \ #@opt=iar
  --set falcon-image-analyzer.image.tag=$IAR_TAG \ #@opt=iar
  --set falcon-image-analyzer.crowdstrikeConfig.clusterName=<CLUSTER_NAME> \ #@opt=iar
  --set falcon-image-analyzer.crowdstrikeConfig.agentRegion=gov1 \ #@opt=iar #@region=gov1
  --set falcon-image-analyzer.crowdstrikeConfig.agentRegion=gov2 \ #@opt=iar #@region=gov2
  --set falcon-image-analyzer.crowdstrikeConfig.agentRegion=<YOUR_AGENT_REGION:us-1> \ #@opt=iar #@region=commercial
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=<FALCON_CLIENT_ID> \ #@opt=iar
  --set falcon-image-analyzer.proxyConfig.HTTP_PROXY=http://<PROXY_HOST>:<PROXY_PORT> \ #@opt=iar #@opt=proxy
  --set falcon-image-analyzer.proxyConfig.HTTPS_PROXY=http://<PROXY_HOST>:<PROXY_PORT> \ #@opt=iar #@opt=proxy
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET \ #@opt=iar
  --set createComponentNamespaces=true
```

> **Why this matters:** `falcon-sensor.node.enabled=false` turns off the DaemonSet sensor (Fargate has no kernel access) and `falcon-sensor.container.enabled=true` turns on injector mode. The injector lands in `falcon-system`, which its webhook never injects into, so it can't try to inject itself. `deployment.enabled=true` selects Image Analyzer **Watcher mode**, the only mode that works on Fargate. Set the commercial `agentRegion` to your cloud (`us-1`, `us-2`, or `eu-1`); the sensor and KAC derive their region from the CID.

### 6. Verify deployment

Wait for every Falcon deployment to become available. Each namespace is checked in parallel and prints ✅ when ready or ❌ if not within 5 minutes:

```bash
(
for ns in falcon-system falcon-kac falcon-image-analyzer; do #@opt=kac #@opt=iar
for ns in falcon-system falcon-kac; do #@opt=kac #@opt=noiar
for ns in falcon-system falcon-image-analyzer; do #@opt=nokac #@opt=iar
for ns in falcon-system; do #@opt=nokac #@opt=noiar
  (kubectl wait --for=condition=Available deployment --all -n $ns --timeout=300s >/dev/null 2>&1 \
    && echo "✅ $ns: Ready" \
    || echo "❌ $ns: not Ready (run: kubectl get pods -n $ns)") &
done
wait
)
```

> **Heads-up:** Fargate starts a separate micro-VM for every pod, so the first pods take about a minute to come up. A pod stuck in `Pending` almost always means its namespace has no matching Fargate profile (step 2), and `ImagePullBackOff` means the image pull is failing (repo, tag, or pod execution role), so don't wait out the timeout.

Then list the Falcon pods:

```bash
kubectl get pods -A -o wide | grep falcon
```

Every pod should show `STATUS` `Running`, and the `NODE` column should start with `fargate-ip-` (proof the pod landed on Fargate). The injector shows `1/1` or `2/2` replicas, KAC `3/3`, and Image Analyzer `1/1`.

### 7. Test a detection (optional)

Create a Fargate profile for the app namespace so its pods can schedule (this is what puts the app on Fargate, where the sidecar gets injected). This can take a couple of minutes. Use the same method you picked in step 2:

<div data-profile="console">

In **EKS** > **Clusters** > your cluster > **Compute** > **Add Fargate profile**: **Name** `app-workloads`, the same **Pod execution role** and subnets as before, and one **Pod selector** with namespace `detection-vulnapp`. Choose **Create** and wait for **Active**.

</div>

<div data-profile="awscli">

Same role and subnets as step 2 (replace `<EXISTING_PROFILE>` with the same existing profile name):

```bash
aws eks create-fargate-profile --cluster-name <CLUSTER_NAME> \
  --fargate-profile-name app-workloads \
  --pod-execution-role-arn $(aws eks describe-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name <EXISTING_PROFILE> --region <AWS_REGION> --query fargateProfile.podExecutionRoleArn --output text) \
  --subnets $(aws eks describe-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name <EXISTING_PROFILE> --region <AWS_REGION> --query fargateProfile.subnets --output text) \
  --selectors namespace=detection-vulnapp \
  --region <AWS_REGION>
```

Wait for it to become active:

```bash
aws eks wait fargate-profile-active --cluster-name <CLUSTER_NAME> --fargate-profile-name app-workloads --region <AWS_REGION>
```

</div>

<div data-profile="eksctl">

```bash
eksctl create fargateprofile --cluster <CLUSTER_NAME> --region <AWS_REGION> \
  --name app-workloads \
  --namespace detection-vulnapp
```

</div>

Create the app namespace:

```bash
kubectl create namespace detection-vulnapp
```

Deploy the CrowdStrike vulnapp, a web app that fires safe, simulated attacks:

```bash
kubectl apply -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

Wait for the pod to be Ready (Fargate starts a micro-VM for it, so expect about a minute):

```bash
kubectl wait --for=condition=Ready pods --all -n detection-vulnapp --timeout=300s
```

Confirm the Falcon sidecar was injected:

```bash
kubectl get pod -l run=vulnerable.example.com -n detection-vulnapp -o jsonpath='{.items[0].spec.containers[*].name}'
```

> **Verify:** The output should include `crowdstrike-falcon-container` next to your app container (`vulnapp`). If it only shows the app container, the webhook did not reach this namespace; check the injector pods from step 6.

Port-forward to the app (this blocks, so leave it running):

```bash
kubectl port-forward -n detection-vulnapp svc/vulnerable-example-com 8060:80
```

Open [http://localhost:8060](http://localhost:8060) in your browser and click any attack simulation (e.g. **Access sensitive files**, **Kill process**) to generate activity the injected sensor will detect.

First confirm the pod registered: in **Falcon Console** > **Host setup and management** > **Host management**, filter **Grouping Tags** for `eks-fargate`. The vulnapp pod should be listed as a host.

Then check **Falcon Console** > **Next-Gen SIEM** > **Monitor and investigate** > **Detections**, and filter **Source product** = **Cloud**. A detection can take several minutes to appear, and some simulations are blocked by prevention policy and show as a prevention alert instead. Stop the port-forward (Ctrl+C) and remove the app:

```bash
kubectl delete -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

### 8. Clean up (optional)

Removes everything this guide deployed. Your EKS cluster itself is not touched.

Remove the vulnapp if it's still running (safe to run if you already deleted it):

```bash
kubectl delete -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml --ignore-not-found
```

Uninstall the Falcon platform release. This removes the injector, KAC, and Image Analyzer:

```bash
helm uninstall falcon-platform -n falcon-platform
```

Delete the namespaces:

```bash
kubectl delete ns falcon-platform falcon-system falcon-kac falcon-image-analyzer detection-vulnapp --ignore-not-found
```

Delete the ECR repos (`--force` removes repos that still hold images):

```bash
for repo in falcon-container falcon-kac falcon-imageanalyzer; do
  aws ecr delete-repository --repository-name $repo --force --region <AWS_REGION>
done
```

Confirm nothing is left:

```bash
kubectl get pods -A | grep falcon
helm list -A | grep falcon
```

> **Verify:** Both commands should print nothing. A pod still listed as `Terminating` is fine; it disappears within a minute.

> **Note:** The host entries stay in the Falcon console for a while after the sidecars are gone. The `falcon` and `app-workloads` Fargate profiles remain on the cluster; delete them in the console (**EKS** > your cluster > **Compute** > select the profile > **Delete**) or with `aws eks delete-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name <profile> --region <AWS_REGION>` if you no longer need them.

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
  - `falcon`: namespaces `falcon-system`, `falcon-kac`, `falcon-image-analyzer`
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
      - namespace: falcon-system
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

- [ ] Enter your values. Use the `Account` value from `aws sts get-caller-identity` in Section 1 for the account ID:

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,AWS_ACCOUNT_ID:AWS account ID"></div>

- [ ] Copy this to export the API client secret. It is the only value kept as a shell variable, and the page never saves it:

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
    || aws ecr create-repository --repository-name $repo --region {{REGION}} --query repository.repositoryUri --output text
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
export CONTAINER_TAG=$(aws ecr describe-images --repository-name falcon-container --region {{REGION}} --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
export KAC_TAG=$(aws ecr describe-images --repository-name falcon-kac --region {{REGION}} --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
export IAR_TAG=$(aws ecr describe-images --repository-name falcon-imageanalyzer --region {{REGION}} --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
```

- [ ] Validate the client secret and every tag populated (a ✅ means set, a ❌ means missing):

```bash
echo "Client Secret    : $([ -n "$FALCON_CLIENT_SECRET" ] && echo ✅ || echo ❌)"
echo "Container Sensor : $([ -n "$CONTAINER_TAG" ] && [ "$CONTAINER_TAG" != None ] && echo ✅ || echo ❌) ($CONTAINER_TAG)"
echo "KAC              : $([ -n "$KAC_TAG" ] && [ "$KAC_TAG" != None ] && echo ✅ || echo ❌) ($KAC_TAG)"
echo "IAR              : $([ -n "$IAR_TAG" ] && [ "$IAR_TAG" != None ] && echo ✅ || echo ❌) ($IAR_TAG)"
```

> **Look for:** a ✅ on every line. A ❌ on a tag means that repo is empty, so re-run the matching `--copy` in Step 5. `None` as a tag value means the image was pushed untagged.

---

## 3. Add the Helm Repository

> **What & Why:** CrowdStrike publishes its charts to a public Helm repository. The `falcon-platform` umbrella chart bundles the sidecar injector, KAC, and Image Analyzer, so one release deploys all three.

- [ ] Add and update the repo:

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update
```

- [ ] Verify the chart is available:

```bash
helm search repo crowdstrike/falcon-platform
```

---

## 4. Deploy the Falcon Platform

> **What & Why:** Fargate pods have no host to run a DaemonSet on, so runtime protection comes from a mutating admission webhook. The `falcon-platform` chart installs that injector, plus KAC and Image Analyzer, in a single Helm release. When a pod is created in an injectable namespace, the webhook adds the Falcon Container Sensor as a sidecar. Any Fargate-profiled namespace can be injected at any time, because there is no pull secret to order around.

### Step 1: Install the chart

> **Note:** Edit the highlighted `SENSOR_TAGS` field (the page replaces it when you click Copy) to group the injected sidecars in the Falcon console. Use comma-separated values; letters, numbers, `-`, `_`, `/` only.

- [ ] Install the chart with all three components pointed at your ECR images:

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set global.falcon.cid=<FALCON_CID> \
  --set falcon-sensor.falcon.tags="<SENSOR_TAGS:eks-fargate>" \
  --set falcon-sensor.node.enabled=false \
  --set falcon-sensor.container.enabled=true \
  --set falcon-sensor.container.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-container \
  --set falcon-sensor.container.image.tag=$CONTAINER_TAG \
  --set falcon-kac.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-kac \
  --set falcon-kac.image.tag=$KAC_TAG \
  --set falcon-image-analyzer.deployment.enabled=true \
  --set falcon-image-analyzer.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-imageanalyzer \
  --set falcon-image-analyzer.image.tag=$IAR_TAG \
  --set falcon-image-analyzer.crowdstrikeConfig.clusterName={{CLUSTER_NAME}} \
  --set falcon-image-analyzer.crowdstrikeConfig.agentRegion=<YOUR_AGENT_REGION:us-1> \
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=<FALCON_CLIENT_ID> \
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET \
  --set createComponentNamespaces=true
```

> **Why this matters:** `falcon-sensor.node.enabled=false` turns off the DaemonSet sensor (no kernel on Fargate) and `falcon-sensor.container.enabled=true` turns on injector mode. The injector lands in `falcon-system`, which its webhook never injects into, so it can't try to inject itself. `deployment.enabled=true` selects Image Analyzer **Watcher mode** (a non-privileged Deployment), the only mode that works on Fargate. **Never** enable the Socket (DaemonSet) mode here.

> **Note:** Set `agentRegion` to your Falcon cloud: `us-1`, `us-2`, or `eu-1` for commercial. For GovCloud this flag is **required**, so use `gov1` (US-GOV-1) or `gov2` (US-GOV-2). The injector and KAC derive their region from the CID.

> **Sizing caveat:** Image Analyzer mounts a `tmp-volume` emptyDir (default 20Gi) sized to about 2x the largest image it scans. On Fargate this consumes the pod's ephemeral storage, so a scan-heavy pod may need a larger Fargate configuration. Watch for `Evicted` pods and raise the volume or ephemeral-storage request if needed.

### Step 2: Verify the injector is running on Fargate

- [ ] Confirm the injector pods are running:

```bash
kubectl get pods -n falcon-system -o wide
```

> **Look for:** `STATUS` `Running`, `READY` `1/1` (or `2/2`), and a `NODE` value starting with `fargate-ip-`. The injector pods themselves run on Fargate, so the `falcon` profile from Section 1 must cover this namespace or they stay `Pending`.

- [ ] Confirm the mutating webhook is registered:

```bash
kubectl get mutatingwebhookconfigurations | grep falcon
```

You should see one `falcon` webhook configuration. This is the object that intercepts every new pod and adds the sidecar.

### Step 3: Verify KAC

- [ ] Confirm the KAC pod is running (one pod, three containers):

```bash
kubectl get pods -n falcon-kac -o wide
```

> **Look for:** `READY` `3/3` and `STATUS` `Running`. KAC's pod-validating webhook defaults to `failurePolicy: Ignore`, the safer setting on Fargate, so an admission hiccup will not block pod scheduling.

### Step 4: Verify Image Analyzer

- [ ] Confirm Image Analyzer is running as a Deployment (not a DaemonSet):

```bash
kubectl get deploy -n falcon-image-analyzer
kubectl get pods -n falcon-image-analyzer -o wide
```

> **Look for:** one `falcon-image-analyzer` Deployment with `READY` `1/1`, and no DaemonSet in that namespace.

---

## 5. Verify Deployment

> **What & Why:** Confirm every Falcon pod is running in-cluster, then prove the injection path works end to end: a new pod in a Fargate-profiled namespace should come up with the Falcon sidecar attached and register as a host in the Falcon console.

### Step 1: Confirm all Falcon pods are Running

- [ ] List every Falcon pod across all namespaces:

```bash
kubectl get pods -A -o wide | grep falcon
```

> **Look for:** pods in three namespaces, all `Running`, each with a `NODE` value starting with `fargate-ip-`: `falcon-system` (the injector), `falcon-kac` (KAC, `3/3`), and `falcon-image-analyzer` (Image Analyzer, `1/1`).

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

> **Verify:** The output should include `crowdstrike-falcon-container` next to your app container (`vulnapp`). If it is missing, the webhook did not reach this namespace, so re-check Section 4 Step 2. If the pod is stuck in `Init:ImagePullBackOff`, confirm the images are in ECR (Section 2) and that the Fargate pod execution role carries `AmazonEKSFargatePodExecutionRolePolicy`.

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

## 6. Test a Detection (Optional)

> **What & Why:** Confirming the sidecar reports a host proves connectivity, but triggering a real detection proves it is actively monitoring workloads. The vulnapp you deployed in Section 5 is a purpose-built web app that generates safe, simulated attacks you can fire from a browser and watch land in the Falcon console.

### Step 1: Port-forward and open the web UI

- [ ] Forward the service to your local machine (this blocks, so leave it running):

```bash
kubectl port-forward -n detection-vulnapp svc/vulnerable-example-com 8060:80
```

- [ ] Open [http://localhost:8060](http://localhost:8060) in your browser.

### Step 2: Trigger a simulated attack

- [ ] Click any attack simulation in the UI (e.g. **Access sensitive files**, **Kill process**, or **Run a reverse shell**). Each button generates activity the injected sensor observes.

### Step 3: Confirm the detection

- [ ] In the Falcon console, go to **Next-Gen SIEM** > **Monitor and investigate** > **Detections**, then filter **Source product** = **Cloud**
- [ ] A new detection tied to the Fargate pod should appear within a few minutes. Open it to review the process tree and mapped tactic/technique.

### Step 4: Clean up the vulnapp

- [ ] Stop the port-forward (Ctrl+C), then remove the app:

```bash
kubectl delete -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

---

## 7. Cleanup

> **Destructive:** This removes the Falcon components, the ECR repos and their images, and the EKS cluster. Run it only when you are finished with the lab.

### Step 1: Uninstall the Helm release

- [ ] Remove the Falcon platform release:

```bash
helm uninstall falcon-platform -n falcon-platform
```

- [ ] Delete the namespaces:

```bash
kubectl delete namespace falcon-platform falcon-system falcon-kac falcon-image-analyzer detection-vulnapp
```

> **Verify:** `kubectl get pods -A | grep falcon` should print nothing. A pod still listed as `Terminating` is fine; it disappears within a minute.

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

## 8. Challenges

### Challenge 1: Opt-in injection via namespace label

**Scenario:** Your platform team runs many namespaces on Fargate and only wants Falcon injected into approved workload namespaces — not everything. Reconfigure the injector so injection is **opt-in** rather than all-namespaces.

<details>
<summary>Hint</summary>

Look at `falcon-sensor.container.disableNSInjection` and the per-namespace label the injector honors. When injection is disabled by default, you enable it per namespace with a label.

</details>

<details>
<summary>Solution</summary>

Upgrade the release with namespace-scoped injection disabled by default. `--reuse-values` keeps everything from Section 4:

```bash
helm upgrade falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --reuse-values \
  --set falcon-sensor.container.disableNSInjection=true
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

Fargate rounds each pod up to the next CPU/memory configuration based on the **sum of all container requests**. The injected sidecar's requests come from `falcon-sensor.container.sensorResources` in the falcon-platform chart.

</details>

<details>
<summary>Solution</summary>

Set `falcon-sensor.container.sensorResources` so every injected sidecar carries a known, modest request:

```bash
helm upgrade falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --reuse-values \
  --set falcon-sensor.container.sensorResources.requests.cpu=100m \
  --set falcon-sensor.container.sensorResources.requests.memory=256Mi
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
| Enable injector mode | n/a | `--set falcon-sensor.node.enabled=false --set falcon-sensor.container.enabled=true` |
| Opt-in injection | n/a | `--set falcon-sensor.container.disableNSInjection=true` + namespace label |
| Sidecar sizing | n/a | `--set falcon-sensor.container.sensorResources.requests.{cpu,memory}` |
| Image Analyzer mode | n/a | `--set falcon-image-analyzer.deployment.enabled=true` (Watcher, never DaemonSet) |
| Deploy everything | n/a | `helm upgrade --install falcon-platform crowdstrike/falcon-platform ...` |
| Injected container name | n/a | `crowdstrike-falcon-container` |
| Namespaces needing a profile | **EKS** → cluster → **Compute** → **Add Fargate profile** | Every Falcon namespace, `kube-system`, and app namespaces |

</div>

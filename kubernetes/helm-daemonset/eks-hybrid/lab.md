# Falcon Platform Helm Deployment — EKS Hybrid (DaemonSet + Sidecar Injector)

Deploy CrowdStrike Falcon on an EKS cluster running both EC2 nodes and Fargate pods using a hybrid approach: DaemonSet sensor for EC2, sidecar injector for Fargate. This lab hosts all Falcon images in your own **same-account ECR** so pulls are authenticated by IAM — no registry pull token or pull secret anywhere.

> **Prerequisites:**
>
> - EKS cluster with both EC2 managed node groups and Fargate enabled
> - `aws` CLI and `kubectl` installed and configured (`kubectl get nodes` returns EC2 nodes)
> - `eksctl` installed (optional: only if you pick the eksctl method to create Fargate profiles, or to provision the cluster in Full Lab)
> - Helm 3 or later installed (`helm version` prints a version)
> - Docker, Podman, or Skopeo installed **and running** (to copy the images to ECR; `docker info` should print server details, not an error. Start Docker Desktop if it fails)
> - CrowdStrike Falcon API credentials (Client ID + Secret)
>   - Required API scopes to pull the images (sensor, sidecar, KAC, IAR):
>     - **Falcon Images Download** (Read)
>     - **Sensor Download** (Read)
>   - Additional scopes IAR needs at runtime to upload image assessments:
>     - **Falcon Container Image** (Read/Write)
>     - **Falcon Container CLI** (Write)
> - CrowdStrike CID (with checksum)

## Reference Docs

| Source                                | Link                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| falcon-platform Helm chart (GitHub)   | https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-platform                     |
| falcon-sensor Helm chart (Injector)   | https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-sensor                       |
| Falcon Container Image Pull Script    | https://github.com/CrowdStrike/falcon-scripts/tree/main/bash/containers/falcon-container-sensor-pull |
| EKS Fargate Pod Execution Role        | https://docs.aws.amazon.com/eks/latest/userguide/fargate-pod-configuration.html                      |
| Amazon ECR private registry auth      | https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html                            |
| Deploy Falcon Sensor via Helm (Docs)  | https://docs.crowdstrike.com/r/en-US/qg0ygdwl/l303c850                                               |

---

## Core Concepts

EKS hybrid clusters run workloads on two compute types with different constraints:

- **EC2 nodes** — Full Linux hosts. The Falcon sensor runs as a DaemonSet (one pod per node), providing kernel-level protection via eBPF.
- **Fargate pods** — Serverless, no host access. DaemonSets are ignored. Protection requires injecting the Falcon sensor as a sidecar container into each pod at admission time.

This lab deploys four components:

- **Falcon Sensor** (DaemonSet) — Kernel-level protection on every EC2 node. Namespace: `falcon-system`.
- **Falcon Sidecar Injector** (Deployment) — Mutating webhook that injects the Falcon sensor container into Fargate pods at creation. Runs on Fargate, so it needs a Fargate profile. Namespace: `falcon-container-injector`.
- **Falcon KAC** (Deployment) — Kubernetes Admission Controller for policy enforcement. Runs on EC2. Namespace: `falcon-kac`.
- **Falcon Image Analyzer** (Deployment) — Scans container images for vulnerabilities. Runs on EC2. Namespace: `falcon-image-analyzer`.

### Why host the images in ECR

Pulling images straight from CrowdStrike's registry on Fargate needs a registry pull token copied into every app namespace. Hosting the images in **same-account ECR** removes the token entirely: AWS authenticates each pull with the IAM role attached to whatever runs the pod.

- **EC2 nodes** pull with the **node instance role** (`AmazonEC2ContainerRegistryReadOnly`, attached by `eksctl` and the `terraform-aws-modules/eks` module). This covers the DaemonSet, KAC, and IAR.
- **Fargate pods** pull with the **Fargate pod execution role** (`AmazonEKSFargatePodExecutionRolePolicy`, also auto-attached). This covers the injector and every injected sidecar, with no namespace ordering to manage.

> **Why this matters:** Image pulls are always authenticated by the node instance role (EC2) or pod execution role (Fargate), never by a pod's own IAM role (IRSA), because the pull happens before the pod starts.

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

### 1. Enter your values

Enter your values once; every command below fills them in. Get your AWS account ID with `aws sts get-caller-identity --query Account --output text`:

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,CLUSTER_NAME:EKS cluster name,AWS_ACCOUNT_ID:AWS account ID,AWS_REGION:AWS region"></div>

Then copy this to export the API client secret. It is the only value kept as a shell variable, and the page never saves it:

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

### 2. Create the Fargate profile for the injector namespace

The DaemonSet sensor, KAC, and IAR land on EC2 nodes (no profile needed), but the sidecar injector runs on Fargate. Create a profile covering its namespace (skip this if your cluster already has matching profiles).

> **Tip:** A Fargate profile is what tells EKS which pods to schedule on Fargate instead of EC2 nodes — matched by namespace (plus optional pod label selectors). Any pod created in a namespace listed here lands on a serverless Fargate micro-VM; pods in other namespaces land on your EC2 node group.

<div data-profile-picker></div>

<div data-profile="console">

1. In the AWS Console, open **EKS** > **Clusters** > your cluster > **Compute** tab, and under **Fargate profiles** choose **Add Fargate profile**.
2. **Name:** `falcon-injector`. **Pod execution role:** pick the role your existing Fargate profile uses. Choose **Next**.
3. **Subnets:** keep the cluster's private subnets. Choose **Next**.
4. Under **Pod selectors**, choose **Add selector**, set **Namespace** to `falcon-container-injector`, and leave **Match labels** empty.
5. Choose **Next**, then **Create**. The profile shows **Creating** for a minute or two; wait until it is **Active**.

> **Why this matters:** The pod execution role is what lets Fargate pull your ECR images and write logs on behalf of the pods. EKS attaches it to every pod that matches a profile, so you never set it on pods yourself. Reusing the role from your existing profile is fine.

> **Verify:** Open the new profile. **Pod selectors** should list `falcon-container-injector`. If it is missing, the injector pods stay `Pending` later.

</div>

<div data-profile="awscli">

A Fargate profile needs a pod execution role and private subnets. Reuse the ones from a profile your cluster already has. List the existing profile names:

```bash
aws eks list-fargate-profiles --cluster-name <CLUSTER_NAME> --region <AWS_REGION> --query fargateProfileNames --output text
```

Create the `falcon-injector` profile. It copies the pod execution role and subnets from an existing profile (replace `<EXISTING_PROFILE>` with a name from the list above):

```bash
aws eks create-fargate-profile --cluster-name <CLUSTER_NAME> \
  --fargate-profile-name falcon-injector \
  --pod-execution-role-arn $(aws eks describe-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name <EXISTING_PROFILE> --region <AWS_REGION> --query fargateProfile.podExecutionRoleArn --output text) \
  --subnets $(aws eks describe-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name <EXISTING_PROFILE> --region <AWS_REGION> --query fargateProfile.subnets --output text) \
  --selectors namespace=falcon-container-injector \
  --region <AWS_REGION>
```

> **Why this matters:** The pod execution role is what lets Fargate pull your ECR images and write logs on behalf of the pods. EKS attaches it to every pod that matches a profile, so you never set it on pods yourself. Reusing the role from your existing profile is fine.

The profile takes a minute or two to create. Wait for it to become active:

```bash
aws eks wait fargate-profile-active --cluster-name <CLUSTER_NAME> --fargate-profile-name falcon-injector --region <AWS_REGION>
```

> **Verify:** The command returns with no output once the profile is active. If `create-fargate-profile` returns `ResourceInUseException`, a profile named `falcon-injector` already exists; check it with `aws eks describe-fargate-profile`.

</div>

<div data-profile="eksctl">

```bash
eksctl create fargateprofile --cluster <CLUSTER_NAME> --region <AWS_REGION> \
  --name falcon-injector \
  --namespace falcon-container-injector
```

eksctl picks the pod execution role and subnets for you, so no other flags are needed.

> **Verify:** `eksctl get fargateprofile --cluster <CLUSTER_NAME> --region <AWS_REGION>` should list `falcon-injector` with namespace `falcon-container-injector`.

</div>

### 3. Create ECR repos and copy the images

Create the ECR repos (skips any that already exist). The repo names must match the image names (`falcon-sensor`, `falcon-container`, `falcon-kac`, `falcon-imageanalyzer`) because `--copy` does not rename:

```bash
for repo in falcon-sensor falcon-container falcon-kac falcon-imageanalyzer; do #@opt=kac #@opt=iar
for repo in falcon-sensor falcon-container falcon-kac; do #@opt=kac #@opt=noiar
for repo in falcon-sensor falcon-container falcon-imageanalyzer; do #@opt=nokac #@opt=iar
for repo in falcon-sensor falcon-container; do #@opt=nokac #@opt=noiar
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
for t in falcon-sensor falcon-container falcon-kac falcon-imageanalyzer; do #@opt=kac #@opt=iar
for t in falcon-sensor falcon-container falcon-kac; do #@opt=kac #@opt=noiar
for t in falcon-sensor falcon-container falcon-imageanalyzer; do #@opt=nokac #@opt=iar
for t in falcon-sensor falcon-container; do #@opt=nokac #@opt=noiar
  curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
    --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type $t --copy <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
done
```

### 4. Read the image tags from ECR

`--copy` preserves each image's tag, so read it straight back from ECR — no need to invoke the pull script again just to learn the tag. These feed the Helm `image.tag` values. Note the two sensor types: `falcon-sensor` is the **DaemonSet Sensor** (node/kernel) for EC2; `falcon-container` is the **Container Sensor** (sidecar) injected into Fargate pods.

```bash
export DAEMONSET_SENSOR_TAG=$(aws ecr describe-images --repository-name falcon-sensor --region <AWS_REGION> --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
export CONTAINER_TAG=$(aws ecr describe-images --repository-name falcon-container --region <AWS_REGION> --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
export KAC_TAG=$(aws ecr describe-images --repository-name falcon-kac --region <AWS_REGION> --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text) #@opt=kac
export IAR_TAG=$(aws ecr describe-images --repository-name falcon-imageanalyzer --region <AWS_REGION> --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text) #@opt=iar
```

Validate the client secret and every image tag the Helm installs need was populated (a ✅ means set, a ❌ means missing):

```bash
echo "Client Secret    : $([ -n "$FALCON_CLIENT_SECRET" ] && echo ✅ || echo ❌)"
echo "DaemonSet Sensor : $([ -n "$DAEMONSET_SENSOR_TAG" ] && [ "$DAEMONSET_SENSOR_TAG" != None ] && echo ✅ || echo ❌) ($DAEMONSET_SENSOR_TAG)"
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

Install the `falcon-platform` umbrella chart (DaemonSet sensor + KAC + IAR) pointing at your ECR repos. No pull secret is needed because the EC2 node instance role authenticates the pulls:

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set falcon-sensor.falcon.tags="<NODE_SENSOR_TAGS:eks-ec2-node>" \
  --set global.falcon.cid=<FALCON_CID> \
  --set falcon-sensor.falcon.aph=<PROXY_HOST> \ #@opt=proxy
  --set falcon-sensor.falcon.app=<PROXY_PORT> \ #@opt=proxy
  --set falcon-sensor.node.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-sensor \
  --set falcon-sensor.node.image.tag=$DAEMONSET_SENSOR_TAG \
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
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=<FALCON_CLIENT_ID> \ #@opt=iar
  --set falcon-image-analyzer.proxyConfig.HTTP_PROXY=http://<PROXY_HOST>:<PROXY_PORT> \ #@opt=iar #@opt=proxy
  --set falcon-image-analyzer.proxyConfig.HTTPS_PROXY=http://<PROXY_HOST>:<PROXY_PORT> \ #@opt=iar #@opt=proxy
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET \ #@opt=iar
  --set createComponentNamespaces=true
```

> **Why this matters:** On GovCloud, Image Analyzer's `agentRegion` must be pinned to `gov1` or `gov2`; the sensor and KAC derive their region from the CID. The `--copy` step already resolves the correct GovCloud source registry when run with GovCloud API credentials.

Install the sidecar injector for Fargate pods, pointing at your ECR Container Sensor image. No pull secret is needed because the Fargate pod execution role authenticates the pull:

```bash
helm upgrade --install falcon-container-injector crowdstrike/falcon-sensor \
  --namespace falcon-container-injector \
  --create-namespace \
  --set falcon.tags="<FARGATE_SENSOR_TAGS:eks-fargate>" \
  --set falcon.cid=<FALCON_CID> \
  --set falcon.aph=<PROXY_HOST> \ #@opt=proxy
  --set falcon.app=<PROXY_PORT> \ #@opt=proxy
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-container \
  --set container.image.tag=$CONTAINER_TAG
```

> **Verify:** Each command prints `STATUS: deployed`. Pods may take a minute or two to start; step 6 waits for them.

### 6. Verify the Falcon pods

Wait for every Falcon component to reach Ready. Each namespace is checked in parallel and prints ✅ when ready or ❌ if not within 5 minutes:

```bash
(
for ns in falcon-system falcon-kac falcon-image-analyzer falcon-container-injector; do #@opt=kac #@opt=iar
for ns in falcon-system falcon-kac falcon-container-injector; do #@opt=kac #@opt=noiar
for ns in falcon-system falcon-image-analyzer falcon-container-injector; do #@opt=nokac #@opt=iar
for ns in falcon-system falcon-container-injector; do #@opt=nokac #@opt=noiar
  (kubectl wait --for=condition=Ready pods --all -n $ns --timeout=300s >/dev/null 2>&1 \
    && echo "✅ $ns: Ready" \
    || echo "❌ $ns: not Ready (run: kubectl get pods -n $ns)") &
done
wait
)
```

> **Heads-up:** Injector pods run on Fargate, which starts a separate micro-VM per pod, so they take about a minute. A pod stuck in `Pending` almost always means its namespace has no matching Fargate profile (step 2), and `ImagePullBackOff` means the ECR pull is failing (repo, tag, or role).

Then list everything:

```bash
kubectl get pods -A -o wide | grep falcon
```

> **Look for:** every pod `Running`. The `NODE` column shows `ip-...` (EC2) for the DaemonSet pods, KAC and IAR, and `fargate-ip-...` for the injector. Expect `falcon-system` (one pod per EC2 node), `falcon-kac` (1 pod), `falcon-image-analyzer` (1 pod), `falcon-container-injector` (2 pods). Components you unchecked in Additional settings will not appear.

### 7. Deploy the test app and trigger a detection

Create a Fargate profile for the app namespace so its pods schedule on Fargate (where the sidecar gets injected). Use the same method you picked in step 2:

<div data-profile="console">

In **EKS** > **Clusters** > your cluster > **Compute** > **Add Fargate profile**, use **Name** `app-workloads`, the same pod execution role and subnets as before, and one pod selector with **Namespace** `detection-vulnapp`. Wait until the profile is **Active**.

</div>

<div data-profile="awscli">

```bash
aws eks create-fargate-profile --cluster-name <CLUSTER_NAME> \
  --fargate-profile-name app-workloads \
  --pod-execution-role-arn $(aws eks describe-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name falcon-injector --region <AWS_REGION> --query fargateProfile.podExecutionRoleArn --output text) \
  --subnets $(aws eks describe-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name falcon-injector --region <AWS_REGION> --query fargateProfile.subnets --output text) \
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

> **Warning:** The profile must be **Active** before you deploy the app. A pod created while the profile is still creating lands on EC2 and is never injected; delete and re-apply it if that happens.

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
```

> **Verify:** The output should be `vulnerable.example.com crowdstrike-falcon-container`. If only the app container is listed, the pod was created before the `app-workloads` profile was Active or before the injector was ready; delete the vulnapp and re-apply it.

Port-forward and trigger a simulated attack, then check the console:

```bash
kubectl port-forward -n detection-vulnapp svc/vulnerable-example-com 8060:80
```

Open [http://localhost:8060](http://localhost:8060), click any attack simulation, then check **Falcon Console** > **Next-Gen SIEM** > **Monitor and investigate** > **Detections** (filter **Source product** = **Cloud**). Stop the port-forward (Ctrl+C) when done.

### 8. Clean up

Remove the vulnapp and both Helm releases:

```bash
kubectl delete -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
kubectl delete namespace detection-vulnapp
helm uninstall falcon-container-injector -n falcon-container-injector
helm uninstall falcon-platform -n falcon-platform
```

Delete the two Fargate profiles this guide created, then the ECR repos if you no longer need the images. Use the same method you picked in step 2:

<div data-profile="console">

In **EKS** > **Clusters** > your cluster > **Compute** > **Fargate profiles**, select `app-workloads`, choose **Delete**, and confirm. Repeat for `falcon-injector`. For the images, open **ECR** > **Repositories**, select the `falcon-*` repositories, and choose **Delete**.

</div>

<div data-profile="awscli">

```bash
aws eks delete-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name app-workloads --region <AWS_REGION>
aws eks wait fargate-profile-deleted --cluster-name <CLUSTER_NAME> --fargate-profile-name app-workloads --region <AWS_REGION>
aws eks delete-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name falcon-injector --region <AWS_REGION>
```

</div>

<div data-profile="eksctl">

```bash
eksctl delete fargateprofile --cluster <CLUSTER_NAME> --region <AWS_REGION> --name app-workloads --wait
eksctl delete fargateprofile --cluster <CLUSTER_NAME> --region <AWS_REGION> --name falcon-injector
```

</div>

> **Heads-up:** EKS only lets one Fargate profile change at a time, so delete them one after the other (the commands above wait where needed). Deleting the Helm releases first matters because the injector pods must be gone before their profile is removed.

Remove the ECR repos and the images in them (`--force` deletes the images too):

```bash
for repo in falcon-sensor falcon-container falcon-kac falcon-imageanalyzer; do
  aws ecr delete-repository --repository-name $repo --region <AWS_REGION> --force >/dev/null 2>&1
done
```

> **Destructive:** `--force` deletes every image in those repositories. Only run it if nothing else in the account uses them.

</div>

<div data-mode="lab">

<div data-lab-variables></div>

## 1. Provision EKS Hybrid Cluster

> **What & Why:** A hybrid EKS cluster uses both EC2 managed node groups (for DaemonSet workloads) and Fargate profiles (for serverless pods). This mirrors production environments where teams run a mix of compute types. The Falcon deployment must cover both — and because we host the images in ECR, both the node instance role and the Fargate pod execution role need ECR read (both get it by default from eksctl).

> **Tip:** A **Fargate profile** is what tells EKS which pods to schedule on Fargate instead of EC2 nodes — matched by namespace (plus optional pod label selectors). Any pod created in a namespace listed here lands on a serverless Fargate micro-VM; pods in other namespaces land on your EC2 node group. We need two: `falcon-injector` (created with the cluster) and `app-workloads` (created in Step 4).

### Step 1: Create the cluster configuration

> **Why this matters:** The first Fargate profile in an `eksctl` config also makes the **pod execution role**, the IAM role Fargate uses to pull images and write logs for your pods. Later profiles reuse it, which is why the `falcon-injector` profile is defined here.

- [ ] Create an `eksctl` cluster config with the EC2 node group and the injector's Fargate profile:

```bash
cat <<'EOF' > eksctl-hybrid.yaml
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig

metadata:
  name: {{CLUSTER_NAME}}
  region: {{REGION}}

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
EOF
```

### Step 2: Create the cluster

> **What & Why:** eksctl creates the managed node group's instance role with `AmazonEC2ContainerRegistryReadOnly` attached (so EC2 pods can pull from same-account ECR) and a Fargate pod execution role with `AmazonEKSFargatePodExecutionRolePolicy` attached (so Fargate pods can too). That's what lets every Falcon component pull from ECR later with no pull secret.

- [ ] Deploy the cluster (takes a few minutes):

```bash
eksctl create cluster -f eksctl-hybrid.yaml
```

### Step 3: Verify the hybrid setup

- [ ] **Console:** Open **EKS** → **Clusters** → your cluster → **Compute** tab. Under **Nodes** you should see the `ec2-nodes` node group, and under **Fargate profiles** the `falcon-injector` profile.

<details>
<summary>CLI equivalent</summary>

```bash
kubectl get nodes
eksctl get fargateprofile --cluster {{CLUSTER_NAME}} --region {{REGION}}
```

</details>

> **Verify:** `kubectl get nodes` lists 2 EC2 nodes in `Ready` state. Fargate "nodes" only appear once pods are scheduled onto a Fargate profile, which comes later.

### Step 4: Create the app Fargate profile

> **What & Why:** The vulnapp you deploy in Section 6 must run on Fargate so the sidecar gets injected. That needs a profile matching its namespace, `detection-vulnapp`.

> **Note:** Steps 1-2 used `eksctl` because it creates the cluster, IAM roles, and VPC in one command. A Fargate profile is a single resource, so from here you choose how to create it: AWS Console, AWS CLI, or eksctl. All three produce the same profile.

- [ ] Create the `app-workloads` profile:

<div data-profile-picker></div>

<div data-profile="console">

1. In the AWS Console, open **EKS** → **Clusters** → your cluster → **Compute** tab, and under **Fargate profiles** choose **Add Fargate profile**.
2. **Name:** `app-workloads`. **Pod execution role:** pick the role the `falcon-injector` profile uses. Choose **Next**.
3. **Subnets:** keep the cluster's private subnets. Choose **Next**.
4. Under **Pod selectors**, choose **Add selector**, set **Namespace** to `detection-vulnapp`, and leave **Match labels** empty.
5. Choose **Next**, then **Create**. Wait until the profile status is **Active**.

> **Verify:** Open the profile. **Pod selectors** should list `detection-vulnapp`.

</div>

<div data-profile="awscli">

Copy the pod execution role and subnets from the `falcon-injector` profile:

```bash
aws eks create-fargate-profile --cluster-name {{CLUSTER_NAME}} \
  --fargate-profile-name app-workloads \
  --pod-execution-role-arn $(aws eks describe-fargate-profile --cluster-name {{CLUSTER_NAME}} --fargate-profile-name falcon-injector --region {{REGION}} --query fargateProfile.podExecutionRoleArn --output text) \
  --subnets $(aws eks describe-fargate-profile --cluster-name {{CLUSTER_NAME}} --fargate-profile-name falcon-injector --region {{REGION}} --query fargateProfile.subnets --output text) \
  --selectors namespace=detection-vulnapp \
  --region {{REGION}}
```

Wait for it to become active:

```bash
aws eks wait fargate-profile-active --cluster-name {{CLUSTER_NAME}} --fargate-profile-name app-workloads --region {{REGION}}
```

> **Verify:** The wait command returns with no output once the profile is active. A `ResourceInUseException` means `app-workloads` already exists.

</div>

<div data-profile="eksctl">

```bash
eksctl create fargateprofile --cluster {{CLUSTER_NAME}} --region {{REGION}} \
  --name app-workloads \
  --namespace detection-vulnapp
```

> **Verify:** `eksctl get fargateprofile --cluster <cluster-name> --region <region>` lists both `falcon-injector` and `app-workloads`.

</div>

---

## 2. Stage Images in ECR

> **What & Why:** Hosting all four Falcon images in same-account ECR is what removes the registry pull token from this deployment. EC2 pods pull with the node instance role and Fargate pods pull with the pod execution role — both IAM-authenticated, so there's no token to mint, no secret to propagate, and no namespace-ordering caveat. IAR still needs API credentials at runtime for vulnerability reporting; that's unrelated to image pulls.

### Step 1: Enter your values and export the secret

- [ ] Enter your values. Get your AWS account ID with `aws sts get-caller-identity --query Account --output text`:

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,AWS_ACCOUNT_ID:AWS account ID"></div>

- [ ] Copy this to export the API client secret. It is the only value kept as a shell variable, and the page never saves it:

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

### Step 2: Create the ECR repositories

> **What & Why:** The pull script's `--copy` flag pushes to `<registry>/<image-name>:<tag>` but does **not** create the destination repo. The image names are fixed — `falcon-sensor`, `falcon-container`, `falcon-kac`, `falcon-imageanalyzer` (no hyphen) — so the repos must use exactly those names.

> **Why this matters:** **ECR** (Elastic Container Registry) is AWS's private image registry. A *repository* holds every tag of one image, so each Falcon image needs its own repository, in the same account and region as your cluster.

- [ ] **Console:** Open **Elastic Container Registry** → **Private registry** → **Repositories** → **Create repository**. Set **Repository name** to `falcon-sensor`, leave the other settings at their defaults, and choose **Create**. Repeat for `falcon-container`, `falcon-kac`, and `falcon-imageanalyzer`.

<details>
<summary>CLI equivalent</summary>

```bash
for repo in falcon-sensor falcon-container falcon-kac falcon-imageanalyzer; do
  aws ecr describe-repositories --repository-names $repo --region {{REGION}} >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name $repo --region {{REGION}} --query repository.repositoryUri --output text
done
```

</details>

> **Verify:** The **Repositories** list shows all four names, and the console region (top right) matches the region in your Lab Variables panel. If you see `RepositoryNotFoundException` later, the repo was created in a different region.

### Step 3: Log Docker in to ECR

> **What & Why:** The pull script logs in to the **CrowdStrike** registry to read the images, but it does **not** log in to your **destination** registry. You must authenticate Docker to ECR yourself before `--copy` can push.

- [ ] Authenticate to your ECR registry:

```bash
aws ecr get-login-password --region {{REGION}} | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com
```

> **Verify:** The last line should be `Login Succeeded`. If you see `Cannot connect to the Docker daemon`, start Docker and re-run it.

### Step 4: Copy the images into ECR

- [ ] Copy each image from the CrowdStrike registry to ECR (`--copy` pushes to `<AWS_ACCOUNT_ID>.dkr.ecr.<region>.amazonaws.com/<image-name>:<tag>`):

```bash
for t in falcon-sensor falcon-container falcon-kac falcon-imageanalyzer; do
  curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
    --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type $t --copy <AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com
done
```

> **Verify:** Each image ends with a push to your ECR address. In the console, open each repository: it should now list one image with a tag. A `403` or `no basic auth credentials` error on push means the Docker login in Step 3 expired; repeat it.

### Step 5: Read the image tags from ECR

> **What & Why:** There are two distinct sensor images: `falcon-sensor` is the **DaemonSet Sensor** (kernel image) for EC2 nodes, and `falcon-container` is the **Container Sensor** (user-space sidecar) injected into Fargate pods. Because `--copy` preserved each image's original tag, read it straight back from ECR rather than invoking the pull script a second time with `--get-image-path`. This also means the tag you deploy is exactly what actually landed in your registry.

- [ ] Capture each tag from ECR:

```bash
export DAEMONSET_SENSOR_TAG=$(aws ecr describe-images --repository-name falcon-sensor --region {{REGION}} --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
export CONTAINER_TAG=$(aws ecr describe-images --repository-name falcon-container --region {{REGION}} --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
export KAC_TAG=$(aws ecr describe-images --repository-name falcon-kac --region {{REGION}} --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
export IAR_TAG=$(aws ecr describe-images --repository-name falcon-imageanalyzer --region {{REGION}} --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
```

- [ ] Validate the client secret and every tag were populated (a ✅ means set, a ❌ means missing):

```bash
echo "Client Secret    : $([ -n "$FALCON_CLIENT_SECRET" ] && echo ✅ || echo ❌)"
echo "DaemonSet Sensor : $([ -n "$DAEMONSET_SENSOR_TAG" ] && [ "$DAEMONSET_SENSOR_TAG" != None ] && echo ✅ || echo ❌) ($DAEMONSET_SENSOR_TAG)"
echo "Container Sensor : $([ -n "$CONTAINER_TAG" ] && [ "$CONTAINER_TAG" != None ] && echo ✅ || echo ❌) ($CONTAINER_TAG)"
echo "KAC              : $([ -n "$KAC_TAG" ] && [ "$KAC_TAG" != None ] && echo ✅ || echo ❌) ($KAC_TAG)"
echo "IAR              : $([ -n "$IAR_TAG" ] && [ "$IAR_TAG" != None ] && echo ✅ || echo ❌) ($IAR_TAG)"
```

> **Verify:** All five lines show ✅ with a version in parentheses. A ❌ with `None` means that repo has no tagged image; re-run the `--copy` for it.

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

> **Verify:** Each command prints one row with a chart version. `No results found` means `helm repo update` did not run; run it again.

---

## 4. Deploy DaemonSet Sensor with KAC and IAR

> **What & Why:** The `falcon-platform` umbrella chart installs the DaemonSet sensor (EC2 nodes), KAC (admission control), and IAR (image scanning) in one release. On a hybrid cluster, DaemonSet pods only schedule on EC2 nodes — Fargate ignores them automatically.

### Step 1: Install the platform chart

> **Note:** Edit the highlighted `NODE_SENSOR_TAGS` field (the page replaces it when you click Copy) to group the EC2 node sensor in the Falcon console. Use comma-separated values; letters, numbers, `-`, `_`, `/` only.

- [ ] Deploy with all component images pointed at ECR:

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set falcon-sensor.falcon.tags="<NODE_SENSOR_TAGS:eks-ec2-node>" \
  --set createComponentNamespaces=true \
  --set global.falcon.cid=<FALCON_CID> \
  --set falcon-sensor.node.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-sensor \
  --set falcon-sensor.node.image.tag=$DAEMONSET_SENSOR_TAG \
  --set falcon-kac.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-kac \
  --set falcon-kac.image.tag=$KAC_TAG \
  --set falcon-image-analyzer.deployment.enabled=true \
  --set falcon-image-analyzer.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-imageanalyzer \
  --set falcon-image-analyzer.image.tag=$IAR_TAG \
  --set falcon-image-analyzer.crowdstrikeConfig.clusterName={{CLUSTER_NAME}} \
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=<FALCON_CLIENT_ID> \
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET
```

> **Why this matters:** No image pull secret is needed — the DaemonSet, KAC, and IAR pods land on EC2 and pull from ECR using the **node instance role** (`AmazonEC2ContainerRegistryReadOnly`, attached to the managed node group in Section 1). ECR authenticates the pull based on the caller's IAM identity, so there's nothing to mint, propagate, or rotate on the cluster side.

> **Heads-up:** On GovCloud, add `--set falcon-image-analyzer.crowdstrikeConfig.agentRegion=gov1` (or `gov2` for us-gov-2) to the command above; the sensor and KAC derive their region from the CID, but Image Analyzer does not. Skip this on a commercial CID.

### Step 2: Verify EC2 sensor pods

- [ ] Confirm the DaemonSet sensor is running on EC2 nodes only:

```bash
kubectl get pods -n falcon-system -o wide
kubectl get ds -n falcon-system
```

> **Verify:** `DESIRED` and `READY` in the DaemonSet row should both equal your EC2 node count (not the total including Fargate). Pods in `ImagePullBackOff` usually mean the ECR repo or tag is wrong, or the node instance role is missing `AmazonEC2ContainerRegistryReadOnly`.

---

## 5. Deploy Sidecar Injector (Fargate Coverage)

> **What & Why:** Fargate pods have no host to run a DaemonSet on. The sidecar injector is a mutating admission webhook — when a pod is created in a Fargate-profiled namespace, the webhook intercepts the request and injects the Falcon sensor as an additional container in the pod spec. The sidecar image is pulled from your ECR repo, and because Fargate authenticates pulls with the **pod execution role**, no `imagePullSecret` is needed and no namespace ordering matters. Any Fargate-profiled namespace can be injected at any time.

### Step 1: Deploy the injector

> **Note:** Edit the highlighted `FARGATE_SENSOR_TAGS` field (the page replaces it when you click Copy) to group the Fargate sidecars in the Falcon console. Use comma-separated values; letters, numbers, `-`, `_`, `/` only.

- [ ] Install the `falcon-sensor` chart in injector mode, pointing at your ECR image:

```bash
helm upgrade --install falcon-container-injector crowdstrike/falcon-sensor \
  --namespace falcon-container-injector \
  --create-namespace \
  --set falcon.tags="<FARGATE_SENSOR_TAGS:eks-fargate>" \
  --set falcon.cid=<FALCON_CID> \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-container \
  --set container.image.tag=$CONTAINER_TAG
```

> **Note:** `node.enabled=false` disables the DaemonSet (already covered by falcon-platform). `container.enabled=true` activates injector mode. To inject only into approved namespaces instead of all of them, see Challenge 1.

### Step 2: Verify the injector is running on Fargate

- [ ] Confirm the injector pods are running (they should be on Fargate nodes):

```bash
kubectl get pods -n falcon-container-injector -o wide
```

> **Verify:** `STATUS` is `Running`, `READY` is `1/1`, and the `NODE` column starts with `fargate-ip-` (that's how you know they landed on Fargate, not EC2). If they are `Pending`, the `falcon-injector` Fargate profile from Section 1 is missing or the namespace name does not match it. Fargate starts a micro-VM per pod, so allow about a minute.

- [ ] Confirm the mutating webhook is registered:

```bash
kubectl get mutatingwebhookconfigurations | grep falcon
```

> **Verify:** One `falcon`-named webhook is listed. This is the hook EKS calls on every new pod, which is how the sidecar gets added.

---

## 6. Verify Full Hybrid Coverage

> **What & Why:** True verification means proving both protection paths work: DaemonSet on EC2 and sidecar injection on Fargate. Deploy a test pod into a Fargate-profiled namespace and confirm the sensor container appears.

### Step 1: Check all Falcon pods across namespaces

- [ ] Wait for every Falcon component to reach Ready across all four namespaces:

```bash
for ns in falcon-system falcon-kac falcon-image-analyzer falcon-container-injector; do
  kubectl wait --for=condition=Ready pods --all -n $ns --timeout=5m
done
```

- [ ] Get a full picture of all Falcon components:

```bash
kubectl get pods -A | grep falcon
```

> **Look for:** `falcon-system` has one DaemonSet pod per EC2 node, `falcon-kac` and `falcon-image-analyzer` each have one pod on EC2, and `falcon-container-injector` has its pods on Fargate. Every pod is `Running`.

### Step 2: Deploy the CrowdStrike vulnapp

> **What & Why:** The `detection-vulnapp` namespace is covered by the `app-workloads` Fargate profile you created in Section 1, Step 4, so its pod lands on Fargate where the sidecar is injected. The namespace has to exist before you apply the YAML, which does not create it.

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
```

> **Look for:** `vulnerable.example.com crowdstrike-falcon-container`, which is your app container plus the injected Falcon sidecar. If the pod is stuck in `Init:ImagePullBackOff`, confirm the images are in ECR (Section 2) and that the Fargate pod execution role carries `AmazonEKSFargatePodExecutionRolePolicy`.

- [ ] Check the DaemonSet sensor logs on EC2:

```bash
kubectl logs -n falcon-system -l app.kubernetes.io/name=falcon-sensor --tail=20
```

### Step 4: Verify in Falcon console

- [ ] Navigate to **Falcon Console** > **Host management** > **Hosts**
- [ ] Filter by cluster name — you should see both EC2 node hosts and Fargate pod hosts

> **Verify:** EC2 nodes show up as sensor hosts (DaemonSet Sensor), and the vulnapp pod shows up as its own Fargate host (Container Sensor). Allow a few minutes for new hosts to register.

### Step 5: Test a detection (optional)

> **What & Why:** Injecting the sidecar proves coverage; triggering a real detection proves the sidecar is actively monitoring. The vulnapp deployed above doubles as a detection generator — its web UI fires safe, simulated attacks.

- [ ] Port-forward to the vulnapp service (this blocks — leave it running):

```bash
kubectl port-forward -n detection-vulnapp svc/vulnerable-example-com 8060:80
```

- [ ] Open [http://localhost:8060](http://localhost:8060) and click any attack simulation (e.g. **Access sensitive files**, **Kill process**, or **Run a reverse shell**). The injected sidecar sensor observes the activity on the Fargate pod.
- [ ] In the Falcon console, go to **Next-Gen SIEM** > **Monitor and investigate** > **Detections**, then filter **Source product** = **Cloud** — a new detection tied to the Fargate pod host should appear within a few minutes. Stop the port-forward (Ctrl+C) when done.

---

## 7. Cleanup

> **What & Why:** Removes all Falcon components, the ECR repos, and the test cluster so you stop paying for the EC2 nodes, the EKS control plane, and Fargate pods.

> **Destructive:** This deletes the Falcon deployment, every image in the four ECR repos, and the whole EKS cluster. Only run it against the lab cluster you created in Section 1.

### Step 1: Uninstall Helm releases

- [ ] Remove the vulnapp (deleting its namespace removes it) and both Falcon Helm releases:

```bash
kubectl delete namespace detection-vulnapp
helm uninstall falcon-container-injector -n falcon-container-injector
helm uninstall falcon-platform -n falcon-platform
```

> **Verify:** `helm list -A` no longer shows `falcon-platform` or `falcon-container-injector`.

### Step 2: Delete namespaces

- [ ] Clean up all Falcon namespaces:

```bash
kubectl delete namespace falcon-platform falcon-system falcon-kac falcon-image-analyzer falcon-container-injector
```

### Step 3: Delete the ECR repositories

- [ ] **Console:** Open **Elastic Container Registry** → **Private registry** → **Repositories**, select the four `falcon-*` repositories, choose **Delete**, and type `delete` to confirm. The console deletes the images inside them too.

<details>
<summary>CLI equivalent</summary>

```bash
for repo in falcon-sensor falcon-container falcon-kac falcon-imageanalyzer; do
  aws ecr delete-repository --repository-name $repo --force --region {{REGION}}
done
```

</details>

### Step 4: Delete the EKS cluster

> **Why this matters:** Deleting a cluster from the EKS console means first deleting the node group and every Fargate profile by hand, one at a time. `eksctl delete cluster` removes the node group, the Fargate profiles (including `app-workloads`, whichever method created it), and the roles and VPC it created, in the right order.

- [ ] Remove the cluster:

```bash
eksctl delete cluster --name {{CLUSTER_NAME}} --region {{REGION}}
```

> **Verify:** The command ends with `all cluster resources were deleted`. In the console, **EKS** → **Clusters** no longer lists the cluster. If it fails on a Fargate profile, wait a minute and re-run it, since EKS only deletes one profile at a time.

---

## Challenges

### Challenge 1: Opt-in injection via namespace label

**Scenario:** Your platform team only wants Falcon injected into approved workload namespaces, not every Fargate namespace. Make injection opt-in and prove an unlabeled namespace gets no sidecar.

<details>
<summary>Hint</summary>

The injector chart has a value that turns off injection by default, and a namespace label that turns it back on for one namespace.

</details>

<details>
<summary>Solution</summary>

Redeploy the injector with `--set container.disableNSInjection=true` added to the Step 1 command in Section 5, then label the app namespace:

```bash
kubectl label namespace detection-vulnapp sensor.falcon-system.crowdstrike.com/injection=enabled
```

Delete and re-apply the vulnapp to get a pod with the sidecar. A pod in a Fargate namespace without the label comes up with only its app container.

</details>

### Challenge 2: Verify coverage gaps

**Scenario:** A pod runs in a namespace that has a Fargate profile but is not covered by the injector. Confirm it runs unprotected and find how the Falcon console shows the gap.

<details>
<summary>Hint</summary>

Create a second namespace, add a Fargate profile for it, and compare its pod's containers with the vulnapp's. In the Falcon console, look at the Kubernetes and Containers inventory.

</details>

<details>
<summary>Solution</summary>

With Challenge 1's opt-in mode on, deploy any pod into an unlabeled namespace that has a Fargate profile. `kubectl get pod -o jsonpath='{.spec.containers[*].name}'` shows no `crowdstrike-falcon-container`. In the Falcon console, the Kubernetes and Containers inventory lists the pod without a sensor.

</details>

### Challenge 3: Pull from a cross-account ECR

**Scenario:** Your organization hosts golden images in a central "shared services" AWS account, while each workload account runs its own EKS hybrid cluster. Point both the EC2 nodes and the Fargate pods at the shared repos without any `imagePullSecret`.

<details>
<summary>Hint</summary>

Cross-account ECR pulls need permission on both sides: a repository policy on the source repo, and an identity policy on the consumer's roles.

</details>

<details>
<summary>Solution</summary>

In the shared account, attach a repository policy to each repo allowing the consumer account's node instance role and Fargate pod execution role to pull. In the consumer account, make sure both roles carry `AmazonEC2ContainerRegistryReadOnly`. Then point the charts at `<OWNER_ACCOUNT_ID>.dkr.ecr.<region>.amazonaws.com/<repo>`. No pull secret is needed; the repository policy authorizes the cross-account read.

</details>

---

## Quick Reference

| Action | Console Path | CLI Command |
| ------ | ------------ | ----------- |
| Create an ECR repo | **ECR** → **Private registry** → **Repositories** → **Create repository** | `aws ecr create-repository --repository-name falcon-kac --region <region>` |
| Copy an image to ECR | n/a | `... --type <t> --copy <AWS_ACCOUNT_ID>.dkr.ecr.<region>.amazonaws.com` |
| Read an image tag | **ECR** → repository → **Images** | `aws ecr describe-images --repository-name <repo> --region <region>` |
| Create a Fargate profile | **EKS** → cluster → **Compute** → **Add Fargate profile** | `aws eks create-fargate-profile ...` or `eksctl create fargateprofile ...` |
| List Fargate profiles | **EKS** → cluster → **Compute** → **Fargate profiles** | `eksctl get fargateprofile --cluster <cluster-name> --region <region>` |
| Install DaemonSet, KAC, IAR | n/a | `helm upgrade --install falcon-platform crowdstrike/falcon-platform ...` |
| Install the injector | n/a | `--set node.enabled=false --set container.enabled=true` on `crowdstrike/falcon-sensor` |
| Opt-in injection | n/a | `--set container.disableNSInjection=true` plus the namespace label |
| EC2 image pull auth | **IAM** → node instance role | `AmazonEC2ContainerRegistryReadOnly`, no pull secret |
| Fargate image pull auth | **IAM** → pod execution role | `AmazonEKSFargatePodExecutionRolePolicy`, no pull secret |
| Injected container name | n/a | `crowdstrike-falcon-container` |

</div>

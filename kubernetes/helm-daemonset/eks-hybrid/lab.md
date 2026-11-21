# Falcon Platform Helm Deployment — EKS Hybrid (DaemonSet + Sidecar Injector)

Deploy CrowdStrike Falcon on an EKS cluster that runs both EC2 nodes and Fargate pods: a DaemonSet sensor for EC2 and a sidecar injector for Fargate. All images come from your own **same-account ECR**, so pulls are authenticated by IAM and no pull token or secret is needed.

> **Prerequisites:**
>
> - Helm 3 or later <span data-tip="helm version should print a version.">installed</span>
> - `aws` CLI and `kubectl` <span data-tip="Installed and configured. eksctl is optional: Quick Deploy creates the Fargate profiles with the AWS CLI by default (or the AWS Console), and only the Full Lab needs eksctl to provision the cluster.">configured</span>
> - <span data-tip="Used to copy the images to ECR. It must be running: docker info should print server details, not an error. Start Docker Desktop if it fails.">Docker, Podman, or Skopeo</span> installed **and running**
> - CrowdStrike Falcon API <span data-tip="The pull scopes let you download the images from the CrowdStrike registry. The runtime scopes let IAR upload image assessments after it is running.">credentials</span> (Client ID + Secret)
>   - Scopes to pull the images (sensor, sidecar, KAC, IAR):
>     - **Falcon Images Download** (Read)
>     - **Sensor Download** (Read)
>   - Runtime scopes (IAR):
>     - **Falcon Container Image** (Read/Write)
>     - **Falcon Container CLI** (Write)
> - CrowdStrike <span data-tip="Use the full Customer ID including the checksum suffix. The credentials tip below shows where to find it.">CID</span> (with checksum)
> - Images hosted in <span data-tip="All four Falcon images live in same-account ECR. EC2 nodes pull with the node instance role and Fargate pods pull with the pod execution role, so no image pull secret is used anywhere.">same-account ECR</span>
> - **Quick Deploy path:** an existing EKS cluster with <span data-tip="The cluster needs both an EC2 managed node group and Fargate enabled, with kubectl pointed at it. kubectl get nodes should list your EC2 nodes.">EC2 nodes and Fargate</span>
> - **Full Lab path:** an AWS account and credentials <span data-tip="Section 1 provisions the hybrid cluster for you.">(cluster provisioned for you)</span>

> **Tip:** Where to find your Falcon credentials:
>
> - **CID (with checksum):** in the Falcon console, go to **Host setup and management** > **Deploy** > **Sensor downloads** and copy the **Customer ID** from the right panel. Direct link: [US-1](https://falcon.crowdstrike.com/sensor-downloads/all) | [US-2](https://falcon.us-2.crowdstrike.com/sensor-downloads/all) | [EU-1](https://falcon.eu-1.crowdstrike.com/sensor-downloads/all). On GovCloud, open the same page on your GovCloud console host.
> - **API client:** go to **Support and resources** > **Client Management** > **API Clients** > **Create API client**. Copy the client secret right away; the console shows it only once.

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

| Concern | EC2 nodes | EKS Fargate |
| ------- | --------- | ----------- |
| Runtime protection | DaemonSet sensor (eBPF, kernel) | Sidecar injection (user space) |
| DaemonSets and privileged containers | Allowed | **Not supported** |
| Image pull auth | **Node instance role** (same-account ECR) | **Pod execution role** (same-account ECR) |
| Scheduling a namespace | Any node, no setup | Needs a **Fargate profile**, or pods stay `Pending` |

> **Why this matters:** The namespace decides the compute type: a pod in a namespace matched by a Fargate profile runs on Fargate, and every other pod runs on EC2, where the DaemonSet covers it. The injector's webhook matches namespace labels, not Fargate profiles, so by default it would also inject EC2 pods and double-protect them. This lab installs it in **opt-in** mode and labels only Fargate namespaces with `sensor.falcon-system.crowdstrike.com/injection=enabled`.

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

The DaemonSet sensor, KAC, and IAR land on EC2 nodes (no profile needed). This lab runs the sidecar injector on Fargate, so create a profile covering its namespace (skip this if your cluster already has a profile for `falcon-container-injector`).

> **Tip:** A Fargate profile tells EKS which namespaces run on Fargate instead of EC2. A pod in a namespace with no matching profile lands on your EC2 nodes, so the profile is what moves the injector onto Fargate.

<div data-profile-picker></div>

<div data-profile="console">

1. In the AWS Console, open **EKS** > **Clusters** > your cluster > **Compute** tab, and under **Fargate profiles** choose **Add Fargate profile**.
2. **Name:** `falcon-injector`. **Pod execution role:** choose **Create recommended role**, choose **Create role** in the IAM tab that opens, then return, refresh the dropdown, and select it (or select a pod execution role you already have). Choose **Next**.
3. **Subnets:** keep the cluster's private subnets. Choose **Next**.
4. Under **Pod selectors**, choose **Add selector**, set **Namespace** to `falcon-container-injector`, and leave **Match labels** empty.
5. Choose **Next**, then **Create**. The profile shows **Creating** for a minute or two; wait until it is **Active**.

> **Why this matters:** The pod execution role is what lets Fargate pull your ECR images and write logs on behalf of the pods. EKS attaches it to every pod that matches a profile, so you never set it on pods yourself. The same role can serve every profile on the cluster.

> **Verify:** Open the new profile. **Pod selectors** should list `falcon-container-injector`. If it is missing, the injector pods stay `Pending` later.

</div>

<div data-profile="awscli">

A Fargate profile needs a pod execution role and private subnets. Create a dedicated role for the Falcon pods first. The trust policy lets only Fargate pods from this cluster's profiles assume it:

```bash
cat <<'EOF' > falcon-pod-exec-trust.json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "eks-fargate-pods.amazonaws.com" },
    "Action": "sts:AssumeRole",
    "Condition": { "ArnLike": { "aws:SourceArn": "arn:aws:eks:<AWS_REGION>:<AWS_ACCOUNT_ID>:fargateprofile/<CLUSTER_NAME>/*" } }
  }]
}
EOF
aws iam create-role --role-name <CLUSTER_NAME>-falcon-pod-exec \
  --assume-role-policy-document file://falcon-pod-exec-trust.json \
  --query Role.Arn --output text
aws iam attach-role-policy --role-name <CLUSTER_NAME>-falcon-pod-exec \
  --policy-arn arn:aws:iam::aws:policy/AmazonEKSFargatePodExecutionRolePolicy
```

> **Verify:** `create-role` prints the new role ARN. If it returns `EntityAlreadyExists`, the role is already there from an earlier run; skip to the next command.

Create the `falcon-injector` profile. It uses the new role and the cluster's private subnets (Fargate pods cannot run in public subnets):

```bash
for i in 1 2 3 4 5 6; do
  OUT=$(aws eks create-fargate-profile --cluster-name <CLUSTER_NAME> \
    --fargate-profile-name falcon-injector \
    --pod-execution-role-arn arn:aws:iam::<AWS_ACCOUNT_ID>:role/<CLUSTER_NAME>-falcon-pod-exec \
    --subnets $(aws ec2 describe-subnets --subnet-ids $(aws eks describe-cluster --name <CLUSTER_NAME> --region <AWS_REGION> --query 'cluster.resourcesVpcConfig.subnetIds' --output text) --region <AWS_REGION> --query 'Subnets[?MapPublicIpOnLaunch==`false`].SubnetId' --output text) \
    --selectors namespace=falcon-container-injector \
    --query 'fargateProfile.status' --output text --region <AWS_REGION> 2>&1) && { echo "$OUT"; break; }
  case "$OUT" in
    *"Trust Policy"*) echo "The new IAM role is still propagating. Retrying in 15 seconds ($i/6)..."; sleep 15 ;;
    *) echo "$OUT"; break ;;
  esac
done
```

> **Why this matters:** `AmazonEKSFargatePodExecutionRolePolicy` on this role is why same-account ECR pulls need no pull secret.

> **Heads-up:** A brand-new IAM role can take a minute to become usable everywhere, so the first attempt may fail with `Misconfigured PodExecutionRole Trust Policy`. The loop retries on that error only, up to 6 times. Success prints `CREATING`.

> **Heads-up:** Fargate only runs pods in private subnets. The `--subnets` lookup keeps the cluster subnets that do not auto-assign public IPs. If `create-fargate-profile` rejects the subnets, or the lookup prints nothing, your cluster has no private subnets; add them before continuing.

The profile takes a minute or two to create. Wait for it to become active:

```bash
aws eks wait fargate-profile-active --cluster-name <CLUSTER_NAME> --fargate-profile-name falcon-injector --region <AWS_REGION> \
  && echo "✅ falcon-injector profile is ACTIVE. Fargate can now schedule the injector; move on to the next step." \
  || echo "❌ falcon-injector profile is not ACTIVE yet. Check its status with: aws eks describe-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name falcon-injector --region <AWS_REGION> --query fargateProfile.status"
```

> **Verify:** If `create-fargate-profile` returns `ResourceInUseException`, a profile named `falcon-injector` already exists; check it with `aws eks describe-fargate-profile`.

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
  if aws ecr describe-repositories --repository-names $repo --region <AWS_REGION> >/dev/null 2>&1; then
    echo "✅ $repo already exists"
  else
    aws ecr create-repository --repository-name $repo --region <AWS_REGION> --query repository.repositoryUri --output text \
      && echo "🆕 Created $repo"
  fi
done
```

> **Verify:** Each repo prints `✅ ... already exists` (reused) or its address followed by `🆕 Created ...` (new, for example `<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-kac`).

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

`--copy` preserves each image's tag, so read it back from ECR instead of calling the pull script again. `falcon-sensor` is the **DaemonSet Sensor** (EC2) and `falcon-container` is the **Container Sensor** (Fargate sidecar):

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

<div data-sensor-tags="NODE_SENSOR_TAGS:eks-ec2-node" data-tags-label="EC2 node sensor grouping tags"></div>

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

<div data-sensor-tags="FARGATE_SENSOR_TAGS:eks-fargate" data-tags-label="Fargate sidecar grouping tags"></div>

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
  --set container.disableNSInjection=true \
  --set container.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-container \
  --set container.image.tag=$CONTAINER_TAG
```

> **Why this matters:** `container.disableNSInjection=true` makes injection opt-in, so only namespaces you label get a sidecar (see Core Concepts). You label the test namespace in step 7.

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

> **Look for:** every pod `Running`, with `NODE` starting `ip-` (EC2) for the DaemonSet, KAC, and IAR pods and `fargate-ip-` for the injector. Expect one `falcon-system` pod per EC2 node, 1 each in `falcon-kac` and `falcon-image-analyzer`, and 2 in `falcon-container-injector`. Components you unchecked will not appear.

### 7. Deploy the test app and trigger a detection

Choose where the test app should run. The page below shows only the steps for your choice: on **Fargate** the injector adds the sidecar, and on **EC2** the DaemonSet sensor on the node already protects the pod, so no sidecar and no Fargate profile are involved.

<div data-test-target-picker></div>

<div data-test-target="fargate">

Create a separate Fargate profile for the test app so it is easy to remove later and is not confused with your own workloads. Use the same method you picked in step 2:

<div data-profile="console">

In **EKS** > **Clusters** > your cluster > **Compute** > **Add Fargate profile**: **Name** `falcon-test-detection`, the same **Pod execution role** and subnets as before, and one **Pod selector** with namespace `detection-vulnapp`. Choose **Create** and wait for **Active**.

</div>

<div data-profile="awscli">

Same role and subnets as step 2:

```bash
aws eks create-fargate-profile --cluster-name <CLUSTER_NAME> \
  --fargate-profile-name falcon-test-detection \
  --pod-execution-role-arn arn:aws:iam::<AWS_ACCOUNT_ID>:role/<CLUSTER_NAME>-falcon-pod-exec \
  --subnets $(aws ec2 describe-subnets --subnet-ids $(aws eks describe-cluster --name <CLUSTER_NAME> --region <AWS_REGION> --query 'cluster.resourcesVpcConfig.subnetIds' --output text) --region <AWS_REGION> --query 'Subnets[?MapPublicIpOnLaunch==`false`].SubnetId' --output text) \
  --selectors namespace=detection-vulnapp \
  --query 'fargateProfile.status' --output text --region <AWS_REGION>
```

Wait for it to become active:

```bash
aws eks wait fargate-profile-active --cluster-name <CLUSTER_NAME> --fargate-profile-name falcon-test-detection --region <AWS_REGION> \
  && echo "✅ falcon-test-detection profile is ACTIVE. Fargate can now schedule the test app; move on to deploying it." \
  || echo "❌ falcon-test-detection profile is not ACTIVE yet. Check its status with: aws eks describe-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name falcon-test-detection --region <AWS_REGION> --query fargateProfile.status"
```

</div>

<div data-profile="eksctl">

```bash
eksctl create fargateprofile --cluster <CLUSTER_NAME> --region <AWS_REGION> \
  --name falcon-test-detection \
  --namespace detection-vulnapp
```

</div>

> **Warning:** The profile must be **Active** before you deploy the app. A pod created while the profile is still creating lands on EC2, where the DaemonSet protects it but the sidecar path is never exercised; delete and re-apply it if that happens.

Create the app namespace and opt it in to injection. The label is what tells the injector that this namespace is a Fargate one:

```bash
kubectl create namespace detection-vulnapp
kubectl label namespace detection-vulnapp sensor.falcon-system.crowdstrike.com/injection=enabled
```

</div>

<div data-test-target="ec2">

Create the app namespace. Leave it **unlabeled** and give it no Fargate profile, so the pod lands on an EC2 node and only the DaemonSet sensor protects it:

```bash
kubectl create namespace detection-vulnapp
```

> **Heads-up:** If a Fargate profile that matches `detection-vulnapp` already exists (for example `falcon-test-detection` from an earlier Fargate run), the pod will land on Fargate instead. Delete that profile first, or the verify step below will show a `fargate-ip-` node.

</div>

Deploy the CrowdStrike vulnapp, a web app that fires safe, simulated attacks:

```bash
kubectl apply -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

Wait for the pod to be Ready (a Fargate pod starts its own micro-VM, so expect about a minute; an EC2 pod is usually faster):

```bash
kubectl wait --for=condition=Ready pods --all -n detection-vulnapp --timeout=300s \
  && echo "✅ detection-vulnapp pod is Ready. Next, confirm which node it landed on." \
  || echo "❌ detection-vulnapp pod is not Ready yet. Check it with: kubectl describe pods -n detection-vulnapp"
```

Confirm what the pod is running and which node it landed on:

```bash
kubectl get pod -l run=vulnerable.example.com -n detection-vulnapp -o jsonpath='{.items[0].spec.containers[*].name}{"\n"}{.items[0].spec.nodeName}{"\n"}'
```

<div data-test-target="fargate">

> **Verify:** The first line should include `crowdstrike-falcon-container` next to your app container, and the second should start with `fargate-ip-`. If only the app container is listed, the pod was created before the `falcon-test-detection` profile was Active or before the namespace label was applied; delete the vulnapp and re-apply it.

</div>

<div data-test-target="ec2">

> **Verify:** The first line should list **only** the app container (no `crowdstrike-falcon-container`), and the second should start with `ip-` (an EC2 node). The DaemonSet sensor on that node is what protects this pod. A `fargate-ip-` node means a Fargate profile matched the namespace; a sidecar here would mean the namespace is labeled for injection, which double-protects an EC2 pod.

</div>

Port-forward to the app (this blocks, so leave it running):

```bash
kubectl port-forward -n detection-vulnapp svc/vulnerable-example-com 8060:80
```

Open [http://localhost:8060](http://localhost:8060) in your browser and click any attack simulation (e.g. **Access sensitive files**, **Kill process**) to generate activity the sensor will detect.

<div data-test-target="fargate">

First confirm the pod registered: in **Falcon Console** > **Host setup and management** > **Host management**, filter **Grouping Tags** for `eks-fargate`. The vulnapp pod should be listed as its own host.

</div>

<div data-test-target="ec2">

First confirm the node registered: in **Falcon Console** > **Host setup and management** > **Host management**, filter **Grouping Tags** for `eks-ec2-node`. The EC2 node that runs the vulnapp (its name is in the second line of the output above) should be listed. There is no separate host for the pod, because the node's sensor sees it.

</div>

Stop the port-forward (Ctrl+C), then remove the app:

```bash
kubectl delete -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

### 8. Clean up

Removes everything this guide deployed. Your EKS cluster, EC2 node group, and the Terraform-or-eksctl resources behind them are not touched.

Remove the vulnapp and both Helm releases (the injector pods must be gone before their Fargate profile can be deleted):

```bash
kubectl delete -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml --ignore-not-found
kubectl delete namespace detection-vulnapp --ignore-not-found
helm uninstall falcon-container-injector -n falcon-container-injector
helm uninstall falcon-platform -n falcon-platform
```

Delete the namespaces:

```bash
kubectl delete ns falcon-platform falcon-system falcon-kac falcon-image-analyzer falcon-container-injector --ignore-not-found
```

Confirm nothing is left in the cluster:

```bash
kubectl get pods -A | grep falcon
helm list -A | grep falcon
```

> **Verify:** Both commands should print nothing. A pod still listed as `Terminating` is fine; it disappears within a minute.

Delete the Fargate profiles this guide created (`falcon-injector`, plus `falcon-test-detection` if you tested on Fargate). Use the same method you picked in step 2:

<div data-profile="console">

In **EKS** > **Clusters** > your cluster > **Compute** > **Fargate profiles**, select `falcon-test-detection` (Fargate test only), choose **Delete**, and confirm. Wait until it disappears, then repeat for `falcon-injector`.

</div>

<div data-profile="awscli">

<div data-test-target="fargate">

```bash
aws eks delete-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name falcon-test-detection --query 'fargateProfile.status' --output text --region <AWS_REGION>
aws eks wait fargate-profile-deleted --cluster-name <CLUSTER_NAME> --fargate-profile-name falcon-test-detection --region <AWS_REGION> \
  && echo "✅ falcon-test-detection profile deleted. Safe to delete falcon-injector next." \
  || echo "❌ falcon-test-detection is still deleting. Re-run the wait before continuing."
```

</div>

```bash
aws eks delete-fargate-profile --cluster-name <CLUSTER_NAME> --fargate-profile-name falcon-injector --query 'fargateProfile.status' --output text --region <AWS_REGION>
aws eks wait fargate-profile-deleted --cluster-name <CLUSTER_NAME> --fargate-profile-name falcon-injector --region <AWS_REGION> \
  && echo "✅ falcon-injector profile deleted. You can now remove the pod execution role." \
  || echo "❌ falcon-injector is still deleting. Re-run the wait before removing the role."
```

</div>

<div data-profile="eksctl">

<div data-test-target="fargate">

```bash
eksctl delete fargateprofile --cluster <CLUSTER_NAME> --region <AWS_REGION> --name falcon-test-detection --wait
```

</div>

```bash
eksctl delete fargateprofile --cluster <CLUSTER_NAME> --region <AWS_REGION> --name falcon-injector --wait
```

</div>

> **Heads-up:** EKS only lets one Fargate profile change at a time, so delete them one after the other (the commands above wait where needed).

If you created the pod execution role in step 2 with the AWS CLI, remove it now that no profile uses it (skip this for the Console and eksctl methods, which manage their own role):

```bash
aws iam detach-role-policy --role-name <CLUSTER_NAME>-falcon-pod-exec --policy-arn arn:aws:iam::aws:policy/AmazonEKSFargatePodExecutionRolePolicy
aws iam delete-role --role-name <CLUSTER_NAME>-falcon-pod-exec
```

Remove the ECR repos and the images in them (`--force` deletes the images too):

```bash
for repo in falcon-sensor falcon-container falcon-kac falcon-imageanalyzer; do
  aws ecr delete-repository --repository-name $repo --region <AWS_REGION> --force >/dev/null 2>&1
done
```

> **Destructive:** `--force` deletes every image in those repositories. Only run it if nothing else in the account uses them.

> **Note:** The host entries stay in the Falcon console for a while after the sensors are gone.

</div>

<div data-mode="lab">

## 1. Provision EKS Hybrid Cluster

> **What & Why:** A hybrid cluster runs EC2 nodes (DaemonSet sensor, KAC, IAR) alongside Fargate (sidecar injector, test app), so Falcon has to cover both. Both the node instance role and the Fargate pod execution role need ECR read access; `eksctl` and the console's recommended roles attach it for you.

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

> **What & Why:** The EC2 node group runs everything no Fargate profile matches. We pre-declare `falcon-injector` for the injector's namespace. The test app's profile is created later, in Section 6, only if you test on Fargate. Cluster creation takes several minutes; do not Ctrl+C.

> **Why this matters:** A **Fargate profile** tells EKS which namespaces run on Fargate, and each profile needs a **pod execution role**, the IAM role Fargate uses to pull images from ECR and write logs. You never attach it to pods yourself, and `AmazonEKSFargatePodExecutionRolePolicy` on it is why same-account ECR pulls need no pull secret.

- [ ] **Console:** Navigate to **EKS** → **Clusters** → **Create cluster** → set name `{{CLUSTER_NAME}}` and a cluster service role (create one if you do not have `AmazonEKSClusterRole`) → accept the default VPC and subnets → **Create**
- [ ] When the cluster shows **Active**, open it → **Compute** tab → **Add node group**: name `ec2-nodes`, a node IAM role (create one with `AmazonEKSWorkerNodePolicy`, `AmazonEKS_CNI_Policy`, and `AmazonEC2ContainerRegistryReadOnly`), instance type `m5.large`, desired size `2` → **Create**
- [ ] Still on the **Compute** tab, choose **Add Fargate profile**, choose **Create recommended role** for the pod execution role, and create `falcon-injector` with namespace `falcon-container-injector`

<details>
<summary>CLI equivalent</summary>

`eksctl` collapses all of the above into one config file. It attaches `AmazonEC2ContainerRegistryReadOnly` to the node group's instance role and `AmazonEKSFargatePodExecutionRolePolicy` to a shared Fargate pod execution role for you:

```bash
cat <<'EOF' > eksctl-hybrid.yaml
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig

metadata:
  name: {{CLUSTER_NAME}}
  region: {{REGION}}

iam:
  withOIDC: true

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

```bash
eksctl create cluster -f eksctl-hybrid.yaml
```

</details>

> **Note:** If you already have a hybrid cluster, skip this step, run `aws eks update-kubeconfig --region {{REGION}} --name {{CLUSTER_NAME}}`, and make sure the `falcon-injector` profile exists.

### Step 3: Verify the hybrid setup

- [ ] Confirm kubectl points at the new cluster (the output should contain `{{CLUSTER_NAME}}`):

```bash
kubectl config current-context
```

- [ ] Confirm the EC2 nodes are up:

```bash
kubectl get nodes
```

> **Look for:** two nodes in `Ready` state whose names start with `ip-` (EC2). Fargate "nodes" (`fargate-ip-...`) only appear once pods are scheduled onto a Fargate profile, which happens later.

- [ ] Confirm the Fargate profile exists:

```bash
eksctl get fargateprofile --cluster {{CLUSTER_NAME}} --region {{REGION}}
```

You should see `falcon-injector`.

- [ ] Confirm both compute paths can pull from ECR. Print the policies on the node instance role and on the Fargate pod execution role:

```bash
aws iam list-attached-role-policies --region {{REGION}} --query 'AttachedPolicies[].PolicyName' --output text \
  --role-name $(aws eks describe-nodegroup --cluster-name {{CLUSTER_NAME}} --nodegroup-name ec2-nodes --region {{REGION}} --query nodegroup.nodeRole --output text | awk -F/ '{print $NF}')
aws iam list-attached-role-policies --region {{REGION}} --query 'AttachedPolicies[].PolicyName' --output text \
  --role-name $(aws eks describe-fargate-profile --cluster-name {{CLUSTER_NAME}} --fargate-profile-name falcon-injector --region {{REGION}} --query fargateProfile.podExecutionRoleArn --output text | awk -F/ '{print $NF}')
```

> **Verify:** The first line should include `AmazonEC2ContainerRegistryReadOnly` (EC2 nodes pull with this) and the second should include `AmazonEKSFargatePodExecutionRolePolicy` (Fargate pods pull with this). If either is missing, pulls from ECR fail later with `ImagePullBackOff`.

---

## 2. Stage Images in ECR

> **What & Why:** Hosting the images in same-account ECR removes the pull token: EC2 pods pull with the node instance role and Fargate pods with the pod execution role, both IAM-authenticated. IAR still needs API credentials at runtime for vulnerability reporting, which is unrelated to image pulls.

### Step 1: Create an API client

- [ ] Navigate to **Falcon Console** > **Support and resources** > **Client Management** > **API Clients** > **Create API client**
- [ ] Set the following OAuth 2.0 scopes:
  - Sensor Download: **Read**
  - Falcon Images Download: **Read**
  - Falcon Container Image: **Read/Write**
  - Falcon Container CLI: **Write**

<details>
<summary>CLI equivalent</summary>

There is no CLI for creating API clients; this must be done in the console.

</details>

### Step 2: Enter your values and export the secret

- [ ] Enter your values. Get your AWS account ID with `aws sts get-caller-identity --query Account --output text`:

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,AWS_ACCOUNT_ID:AWS account ID"></div>

- [ ] Copy this to export the API client secret. It is the only value kept as a shell variable, and the page never saves it:

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

### Step 3: Create the ECR repositories

> **What & Why:** The pull script's `--copy` flag pushes to `<registry>/<image-name>:<tag>` but does **not** create the destination repo. The image names are fixed — `falcon-sensor`, `falcon-container`, `falcon-kac`, `falcon-imageanalyzer` (no hyphen) — so the repos must use exactly those names.

> **Why this matters:** **ECR** (Elastic Container Registry) is AWS's private image registry. A *repository* holds every tag of one image, so each Falcon image needs its own repository, in the same account and region as your cluster.

- [ ] **Console:** Open **Elastic Container Registry** → **Private registry** → **Repositories** → **Create repository**, set the name to `falcon-sensor`, keep the defaults, and choose **Create**. Repeat for `falcon-container`, `falcon-kac`, and `falcon-imageanalyzer`.

<details>
<summary>CLI equivalent</summary>

```bash
for repo in falcon-sensor falcon-container falcon-kac falcon-imageanalyzer; do
  if aws ecr describe-repositories --repository-names $repo --region {{REGION}} >/dev/null 2>&1; then
    echo "✅ $repo already exists"
  else
    aws ecr create-repository --repository-name $repo --region {{REGION}} --query repository.repositoryUri --output text \
      && echo "🆕 Created $repo"
  fi
done
```

</details>

> **Verify:** The **Repositories** list shows all four names, and the console region (top right) matches the region in your Lab Variables panel. If you see `RepositoryNotFoundException` later, the repo was created in a different region.

### Step 4: Log Docker in to ECR

> **What & Why:** The pull script logs in to the **CrowdStrike** registry to read the images, but it does **not** log in to your **destination** registry. You must authenticate Docker to ECR yourself before `--copy` can push.

- [ ] Authenticate to your ECR registry:

```bash
aws ecr get-login-password --region {{REGION}} | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com
```

> **Verify:** The last line should be `Login Succeeded`. If you see `Cannot connect to the Docker daemon`, start Docker and re-run it.

### Step 5: Copy the images into ECR

- [ ] Copy each image from the CrowdStrike registry to ECR (`--copy` pushes to `<AWS_ACCOUNT_ID>.dkr.ecr.<region>.amazonaws.com/<image-name>:<tag>`):

```bash
for t in falcon-sensor falcon-container falcon-kac falcon-imageanalyzer; do
  curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
    --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type $t --copy <AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com
done
```

> **Verify:** Each image ends with a push to your ECR address. In the console, open each repository: it should now list one image with a tag. A `403` or `no basic auth credentials` error on push means the Docker login in Step 3 expired; repeat it.

### Step 6: Read the image tags from ECR

> **What & Why:** `falcon-sensor` is the **DaemonSet Sensor** (kernel image) for EC2 and `falcon-container` is the **Container Sensor** (user-space sidecar) for Fargate. `--copy` preserved each tag, so read it back from ECR rather than calling the pull script again.

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

> **Look for:** a ✅ on all five lines, each with a version in parentheses. A ❌ on a tag means that repo is empty, so re-run the matching `--copy` in Step 5. `None` as a tag value means the image was pushed untagged.

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

<div data-sensor-tags="NODE_SENSOR_TAGS:eks-ec2-node" data-tags-label="EC2 node sensor grouping tags"></div>

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
  --set falcon-image-analyzer.crowdstrikeConfig.agentRegion=<YOUR_AGENT_REGION:us-1> \
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=<FALCON_CLIENT_ID> \
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET
```

> **Why this matters:** No pull secret is needed: these pods land on EC2 and pull from ECR with the **node instance role** (`AmazonEC2ContainerRegistryReadOnly`, attached in Section 1). `deployment.enabled=true` selects Image Analyzer **Watcher mode** (a non-privileged Deployment).

> **Note:** Set `agentRegion` to your Falcon cloud: `us-1`, `us-2`, or `eu-1` for commercial. For GovCloud this flag is **required**, so use `gov1` (US-GOV-1) or `gov2` (US-GOV-2). The sensor and KAC derive their region from the CID.

### Step 2: Verify EC2 sensor pods

- [ ] Confirm the DaemonSet sensor is running on EC2 nodes only:

```bash
kubectl get pods -n falcon-system -o wide
kubectl get ds -n falcon-system
```

> **Look for:** `DESIRED` and `READY` in the DaemonSet row both equal your EC2 node count (not counting Fargate), and each pod's `NODE` starts with `ip-`. `ImagePullBackOff` usually means a wrong ECR repo or tag, or a node role missing `AmazonEC2ContainerRegistryReadOnly`.

### Step 3: Verify KAC

- [ ] Confirm the KAC pod is running (one pod, three containers):

```bash
kubectl get pods -n falcon-kac -o wide
```

> **Look for:** `READY` `3/3`, `STATUS` `Running`, and a `NODE` value starting with `ip-` (KAC runs on EC2 in this lab).

### Step 4: Verify Image Analyzer

- [ ] Confirm Image Analyzer is running as a Deployment (not a DaemonSet):

```bash
kubectl get deploy -n falcon-image-analyzer
kubectl get pods -n falcon-image-analyzer -o wide
```

> **Look for:** one `falcon-image-analyzer` Deployment with `READY` `1/1`, and no DaemonSet in that namespace.

---

## 5. Deploy Sidecar Injector (Fargate Coverage)

> **What & Why:** Fargate pods have no host to run a DaemonSet on, so the sidecar injector, a mutating admission webhook, adds the Falcon sensor as an extra container to pods created in opted-in namespaces. The image is pulled from your ECR repo with the **pod execution role**, so no `imagePullSecret` is needed.

### Step 1: Deploy the injector

<div data-sensor-tags="FARGATE_SENSOR_TAGS:eks-fargate" data-tags-label="Fargate sidecar grouping tags"></div>

- [ ] Install the `falcon-sensor` chart in injector mode, pointing at your ECR image:

```bash
helm upgrade --install falcon-container-injector crowdstrike/falcon-sensor \
  --namespace falcon-container-injector \
  --create-namespace \
  --set falcon.tags="<FARGATE_SENSOR_TAGS:eks-fargate>" \
  --set falcon.cid=<FALCON_CID> \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.disableNSInjection=true \
  --set container.image.repository=<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-container \
  --set container.image.tag=$CONTAINER_TAG
```

> **Why this matters:** `node.enabled=false` turns off the DaemonSet (`falcon-platform` already covers EC2) and `container.enabled=true` turns on injector mode. `container.disableNSInjection=true` makes injection opt-in (see Core Concepts); you label the test namespace in Section 6.

### Step 2: Verify the injector is running on Fargate

- [ ] Confirm the injector pods are running (they should be on Fargate nodes):

```bash
kubectl get pods -n falcon-container-injector -o wide
```

> **Look for:** `STATUS` `Running`, `READY` `1/1`, and a `NODE` starting with `fargate-ip-` (proof it landed on Fargate, not EC2). `Pending` or an `ip-` node means the `falcon-injector` profile from Section 1 is missing or does not match `falcon-container-injector`. Allow about a minute for the Fargate micro-VM.

- [ ] Confirm the mutating webhook is registered:

```bash
kubectl get mutatingwebhookconfigurations | grep falcon
```

> **Look for:** One `falcon`-named webhook is listed. This is the hook EKS calls on every new pod, which is how the sidecar gets added.

---

## 6. Verify Deployment

> **What & Why:** Confirm every Falcon pod is running in-cluster, then prove both protection paths work end to end: the DaemonSet covers the EC2 nodes, and a new pod in a Fargate-profiled namespace comes up with the Falcon sidecar attached. Both should register as hosts in the Falcon console.

### Step 1: Confirm all Falcon pods are Running

- [ ] Wait for every Falcon component to reach Ready. Each namespace is checked in parallel and prints a ✅ when ready or a ❌ if not within 5 minutes:

```bash
(
for ns in falcon-system falcon-kac falcon-image-analyzer falcon-container-injector; do
  (kubectl wait --for=condition=Ready pods --all -n $ns --timeout=300s >/dev/null 2>&1 \
    && echo "✅ $ns: Ready" \
    || echo "❌ $ns: not Ready (run: kubectl get pods -n $ns)") &
done
wait
)
```

> **Heads-up:** Injector pods run on Fargate, so they take about a minute. `Pending` almost always means no matching Fargate profile, and `ImagePullBackOff` means the ECR pull is failing (repo, tag, or role), so do not wait out the timeout.

<details>
<summary>Injector pods or app pods fail with a registry timeout on a custom cluster?</summary>

This only affects clusters where the EC2 nodes use a **different security group** from Fargate pods, such as clusters built with the Terraform EKS module. CoreDNS runs on the EC2 nodes, so Fargate pods must be able to reach it. Symptoms: the injector log shows `pinging container registry ... context deadline exceeded`, and because the webhook fails closed, new pods in opted-in namespaces are denied.

Confirm it from a Fargate pod, then allow traffic between the two security groups (replace the IDs with your cluster's node security group and primary cluster security group):

```bash
kubectl logs -n falcon-container-injector -l app.kubernetes.io/name=falcon-sensor --tail=5
aws ec2 authorize-security-group-ingress --group-id <NODE_SECURITY_GROUP_ID> --protocol -1 --source-group <CLUSTER_PRIMARY_SECURITY_GROUP_ID>
```

Clusters created with `eksctl` or the console already share the primary security group, so you will not see this.

</details>

- [ ] List every Falcon pod across all namespaces:

```bash
kubectl get pods -A -o wide | grep falcon
```

> **Look for:** every pod `Running`. The `NODE` column starts with `ip-` (EC2) for the DaemonSet pods in `falcon-system`, KAC, and Image Analyzer, and with `fargate-ip-` for the injector in `falcon-container-injector`. Expect one DaemonSet pod per EC2 node, KAC `3/3`, and Image Analyzer `1/1`.

### Step 2: Deploy the vulnapp

> **What & Why:** The same test app can run on either compute type, and what protects it differs. On **Fargate** the injector adds a sidecar. On **EC2** the DaemonSet sensor on the node already protects the pod, so there is no sidecar. Pick the path you want to see.

<div data-test-target-picker></div>

<div data-test-target="fargate">

> **Why this matters:** A namespace only runs on Fargate if a Fargate profile matches it, and the injector only touches namespaces you label. You create both here, so this namespace is a Fargate one. Because Fargate pulls with the pod execution role, there is no pull secret to seed ahead of the injector.

- [ ] **Console:** Navigate to **EKS** → **Clusters** → `{{CLUSTER_NAME}}` → **Compute** tab → **Add Fargate profile**. Set **Name** to `falcon-test-detection`, choose the same **Pod execution role** as `falcon-injector`, keep the private subnets, and add one **Pod selector** with namespace `detection-vulnapp`. Choose **Create** and wait for **Active**.

<details>
<summary>CLI equivalent</summary>

```bash
aws eks create-fargate-profile --cluster-name {{CLUSTER_NAME}} \
  --fargate-profile-name falcon-test-detection \
  --pod-execution-role-arn $(aws eks describe-fargate-profile --cluster-name {{CLUSTER_NAME}} --fargate-profile-name falcon-injector --region {{REGION}} --query fargateProfile.podExecutionRoleArn --output text) \
  --subnets $(aws eks describe-fargate-profile --cluster-name {{CLUSTER_NAME}} --fargate-profile-name falcon-injector --region {{REGION}} --query fargateProfile.subnets --output text) \
  --selectors namespace=detection-vulnapp \
  --query 'fargateProfile.status' --output text --region {{REGION}}
aws eks wait fargate-profile-active --cluster-name {{CLUSTER_NAME}} --fargate-profile-name falcon-test-detection --region {{REGION}} \
  && echo "✅ falcon-test-detection profile is ACTIVE. Fargate can now schedule the test app." \
  || echo "❌ falcon-test-detection profile is not ACTIVE yet. Check it with: aws eks describe-fargate-profile --cluster-name {{CLUSTER_NAME}} --fargate-profile-name falcon-test-detection --region {{REGION}} --query fargateProfile.status"
```

</details>

> **Warning:** The profile must be **Active** before you deploy the app. A pod created while it is still creating lands on EC2, where the sidecar path is never exercised.

- [ ] Create the namespace and opt it in to injection. The label is what tells the injector this is a Fargate namespace:

```bash
kubectl create namespace detection-vulnapp
kubectl label namespace detection-vulnapp sensor.falcon-system.crowdstrike.com/injection=enabled
```

</div>

<div data-test-target="ec2">

> **Why this matters:** With no Fargate profile for `detection-vulnapp`, EKS schedules its pod on your EC2 nodes, where the DaemonSet sensor already watches every container. Leaving the namespace **unlabeled** also keeps the injector away, so the pod is not protected twice.

- [ ] Create the namespace. Do not label it and do not create a Fargate profile for it:

```bash
kubectl create namespace detection-vulnapp
```

> **Heads-up:** If a Fargate profile matching `detection-vulnapp` already exists (for example `falcon-test-detection` from an earlier Fargate run), the pod lands on Fargate instead. Delete that profile first.

</div>

- [ ] Deploy the CrowdStrike vulnapp, a web app that fires safe, simulated attacks:

```bash
kubectl apply -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

- [ ] Wait for the pod to become Ready (a Fargate pod starts its own micro-VM, so expect about a minute; an EC2 pod is usually faster):

```bash
kubectl wait --for=condition=Ready pods --all -n detection-vulnapp --timeout=300s \
  && echo "✅ detection-vulnapp pod is Ready. Next, confirm which node it landed on." \
  || echo "❌ detection-vulnapp pod is not Ready yet. Check it with: kubectl describe pods -n detection-vulnapp"
```

### Step 3: Verify protection

- [ ] Confirm what the pod is running and which node it landed on:

```bash
kubectl get pod -l run=vulnerable.example.com -n detection-vulnapp -o jsonpath='{.items[0].spec.containers[*].name}{"\n"}{.items[0].spec.nodeName}{"\n"}'
```

<div data-test-target="fargate">

> **Verify:** The first line includes `crowdstrike-falcon-container` next to your app container, and the second starts with `fargate-ip-`. A pod stuck in `Init:ImagePullBackOff` means the images are missing from ECR (Section 2) or the pod execution role lacks `AmazonEKSFargatePodExecutionRolePolicy`. Only the app container means the pod predates the profile or the label; delete and re-apply the vulnapp.

</div>

<div data-test-target="ec2">

> **Verify:** The first line lists **only** the app container (no `crowdstrike-falcon-container`), and the second starts with `ip-` (an EC2 node). The DaemonSet sensor on that node is what protects this pod. A `fargate-ip-` node means a Fargate profile matched the namespace; a sidecar means the namespace is labeled for injection.

</div>

- [ ] Check the DaemonSet sensor logs on an EC2 node:

```bash
kubectl logs -n falcon-system -l app.kubernetes.io/name=falcon-sensor --tail=20
```

> **Look for:** log lines with no repeated errors. A burst of connection errors means the node cannot reach the Falcon cloud over TLS 443.

### Step 4: Verify in the Falcon console

- [ ] Navigate to **Falcon Console** > **Host setup and management** > **Host management**
- [ ] Filter by **Grouping Tags** using the tags you set at deploy time (`eks-ec2-node` for the nodes, `eks-fargate` for the Fargate pod by default)

<div data-test-target="fargate">

> **Verify:** The EC2 nodes show up as sensor hosts (DaemonSet Sensor) and the vulnapp pod shows up as its own Fargate host (Container Sensor). Allow a few minutes for new hosts to register.

</div>

<div data-test-target="ec2">

> **Verify:** The EC2 nodes show up as sensor hosts (DaemonSet Sensor), including the node that runs the vulnapp (its name is the second line of the Step 3 output). There is no separate host for the pod, because the node's sensor sees it. Allow a few minutes for new hosts to register.

</div>

### Step 5: Troubleshooting

If a pod is not Running or a sidecar never registers, work through this table:

| Symptom | Likely cause | Check |
|---------|--------------|-------|
| Injector pod stuck in `Pending` | `falcon-container-injector` has no matching Fargate profile | `eksctl get fargateprofile --cluster {{CLUSTER_NAME}} --region {{REGION}}`, then add the namespace to a profile |
| `ImagePullBackOff` or `Init:ImagePullBackOff` | Image missing from ECR, wrong repo name or tag, or the role lacks ECR read | `kubectl describe pod <name> -n <ns>` and read `Events`; re-run the Section 2 validate block |
| DaemonSet `DESIRED` is lower than your node count | A node is tainted or unschedulable | `kubectl describe ds -n falcon-system` and read `Events` |
| Pod Running but no `crowdstrike-falcon-container` | Namespace is not labeled for injection, or the pod predates the label | `kubectl get ns <ns> --show-labels` should show `sensor.falcon-system.crowdstrike.com/injection=enabled`; label it, then delete and recreate the pod |
| EC2 pod also has a sidecar | Injection is on by default (the injector was installed without `container.disableNSInjection=true`) | Reinstall the injector with that flag (Section 5) and remove the label from EC2 namespaces |
| Sensor Running but no host in console | Egress to the Falcon cloud blocked, or still registering | `kubectl logs <pod> -n <ns> -c crowdstrike-falcon-container`; wait 5 more minutes |
| `helm status` shows `failed` | Empty variable in a `--set` value | Re-run the Section 2 validate block; any ❌ means an earlier step failed silently |

<details>
<summary>Injector pods or app pods fail with a registry timeout on a custom cluster?</summary>

This only affects clusters where the EC2 nodes use a **different security group** from Fargate pods, such as clusters built with the Terraform EKS module. CoreDNS runs on the EC2 nodes, so Fargate pods must be able to reach it. Symptoms: the injector log shows `pinging container registry ... context deadline exceeded`, and because the webhook fails closed, new pods in opted-in namespaces are denied.

Confirm it from a Fargate pod, then allow traffic between the two security groups (replace the IDs with your cluster's node security group and primary cluster security group):

```bash
kubectl logs -n falcon-container-injector -l app.kubernetes.io/name=falcon-sensor --tail=5
aws ec2 authorize-security-group-ingress --group-id <NODE_SECURITY_GROUP_ID> --protocol -1 --source-group <CLUSTER_PRIMARY_SECURITY_GROUP_ID>
```

Clusters created with `eksctl` or the console already share the primary security group, so you will not see this.

</details>

---

## 7. Test a Detection (Optional)

> **What & Why:** A registered host proves connectivity; a detection proves the sidecar is actively monitoring. The vulnapp from Section 6 fires safe, simulated attacks from a browser.

### Step 1: Port-forward and open the web UI

- [ ] Forward the service to your local machine (this blocks, so leave it running):

```bash
kubectl port-forward -n detection-vulnapp svc/vulnerable-example-com 8060:80
```

- [ ] Open [http://localhost:8060](http://localhost:8060) in your browser.

### Step 2: Trigger a simulated attack

- [ ] Click any attack simulation in the UI (e.g. **Access sensitive files**, **Kill process**, or **Run a reverse shell**). Each button generates activity the sensor observes: the injected sidecar on Fargate, or the node's DaemonSet sensor on EC2.

### Step 3: Confirm the detection

- [ ] In the Falcon console, go to **Next-Gen SIEM** > **Monitor and investigate** > **Detections**, then filter **Source product** = **Cloud**
- [ ] A new detection should appear within a few minutes, tied to the Fargate pod host or to the EC2 node, depending on where you tested. Open it to review the process tree and mapped tactic/technique.

### Step 4: Clean up the vulnapp

- [ ] Stop the port-forward (Ctrl+C), then remove the app:

```bash
kubectl delete -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

---

## 8. Cleanup

> **What & Why:** Removes all Falcon components, the ECR repos, and the test cluster so you stop paying for the EC2 nodes, the EKS control plane, and Fargate pods.

> **Destructive:** This deletes the Falcon deployment, every image in the four ECR repos, and the whole EKS cluster. Only run it against the lab cluster you created in Section 1.

### Step 1: Uninstall Helm releases

- [ ] Remove the vulnapp (deleting its namespace removes it) and both Falcon Helm releases. The injector pods must be gone before their Fargate profile can be deleted:

```bash
kubectl delete namespace detection-vulnapp --ignore-not-found
helm uninstall falcon-container-injector -n falcon-container-injector
helm uninstall falcon-platform -n falcon-platform
```

- [ ] Delete the Falcon namespaces:

```bash
kubectl delete namespace falcon-platform falcon-system falcon-kac falcon-image-analyzer falcon-container-injector --ignore-not-found
```

> **Verify:** `kubectl get pods -A | grep falcon` and `helm list -A | grep falcon` should both print nothing. A pod still listed as `Terminating` is fine; it disappears within a minute.

### Step 2: Delete the ECR repositories

- [ ] **Console:** Open **Elastic Container Registry** → **Private registry** → **Repositories**, select the four `falcon-*` repositories, choose **Delete**, and type `delete` to confirm. The console deletes the images inside them too.

<details>
<summary>CLI equivalent</summary>

```bash
for repo in falcon-sensor falcon-container falcon-kac falcon-imageanalyzer; do
  aws ecr delete-repository --repository-name $repo --force --region {{REGION}}
done
```

</details>

### Step 3: Delete the EKS cluster

> **Why this matters:** Deleting a cluster from the EKS console means first deleting the node group and every Fargate profile by hand, one at a time. `eksctl delete cluster` removes the node group, every Fargate profile, and the roles and VPC it created, in the right order.

- [ ] **Console:** Navigate to **EKS** → **Clusters** → select `{{CLUSTER_NAME}}` → **Compute** tab. Delete the `ec2-nodes` node group, then each Fargate profile one at a time (wait for one to disappear before deleting the next), then choose **Delete cluster**.

<details>
<summary>CLI equivalent</summary>

```bash
eksctl delete cluster --name {{CLUSTER_NAME}} --region {{REGION}}
```

</details>

> **Verify:** The command ends with `all cluster resources were deleted`. In the console, **EKS** → **Clusters** no longer lists the cluster. If it fails on a Fargate profile, wait a minute and re-run it, since EKS only deletes one profile at a time.

---

## Challenges

### Challenge 1: Prove EC2 pods are not double-protected

**Scenario:** A teammate worries that every EC2 pod now runs two Falcon sensors, the DaemonSet and a sidecar. Prove that only Fargate pods carry a sidecar, and show what would happen if the injector had been installed in its default mode.

<details>
<summary>Hint</summary>

Compare the containers and the node name of a pod in `detection-vulnapp` with a pod in a namespace that is **not** labeled for injection (for example one you create on the EC2 nodes). `kubectl get ns --show-labels` shows which namespaces are opted in.

</details>

<details>
<summary>Solution</summary>

Create an unlabeled namespace with a pod, then compare:

```bash
kubectl create namespace ec2-check
kubectl run ec2-check --image=nginx -n ec2-check
kubectl get pod ec2-check -n ec2-check -o jsonpath='{.spec.containers[*].name}{"\n"}{.spec.nodeName}{"\n"}'
```

The containers list only `ec2-check` and the node starts with `ip-`, so the DaemonSet alone protects this pod; the vulnapp shows `crowdstrike-falcon-container` and a `fargate-ip-` node. To see the default behavior, label `ec2-check` with `sensor.falcon-system.crowdstrike.com/injection=enabled` and recreate the pod: it now has a sidecar on top of the DaemonSet. Delete the namespace when done.

</details>

### Challenge 2: Verify coverage gaps

**Scenario:** A Fargate pod runs in a namespace that has a Fargate profile but was never labeled for injection. Confirm it runs unprotected and find how the Falcon console shows the gap.

<details>
<summary>Hint</summary>

Create a second namespace, add a Fargate profile for it, and compare its pod's containers with the vulnapp's. In the Falcon console, look at the Kubernetes and Containers inventory.

</details>

<details>
<summary>Solution</summary>

A Fargate namespace you forget to label gets no sidecar, and Fargate has no DaemonSet to fall back on. Deploy a pod into an unlabeled namespace that has a Fargate profile: `kubectl get pod -o jsonpath='{.spec.containers[*].name}'` shows no `crowdstrike-falcon-container`, and the Falcon console's Kubernetes and Containers inventory lists the pod without a sensor. Label the namespace and recreate the pod to close the gap.

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
| Create a pod execution role | **EKS** → **Add Fargate profile** → **Create recommended role** | `aws iam create-role ...` then `aws iam attach-role-policy ...` |
| Create a Fargate profile | **EKS** → cluster → **Compute** → **Add Fargate profile** | `aws eks create-fargate-profile ...` or `eksctl create fargateprofile ...` |
| List Fargate profiles | **EKS** → cluster → **Compute** → **Fargate profiles** | `eksctl get fargateprofile --cluster <cluster-name> --region <region>` |
| Tell EC2 from Fargate pods | n/a | `kubectl get pods -A -o wide` (`ip-` is EC2, `fargate-ip-` is Fargate) |
| Install DaemonSet, KAC, IAR | n/a | `helm upgrade --install falcon-platform crowdstrike/falcon-platform ...` |
| Install the injector | n/a | `--set node.enabled=false --set container.enabled=true` on `crowdstrike/falcon-sensor` |
| Opt a namespace in to injection | n/a | `kubectl label namespace <ns> sensor.falcon-system.crowdstrike.com/injection=enabled` (injector installed with `--set container.disableNSInjection=true`) |
| EC2 image pull auth | **IAM** → node instance role | `AmazonEC2ContainerRegistryReadOnly`, no pull secret |
| Fargate image pull auth | **IAM** → pod execution role | `AmazonEKSFargatePodExecutionRolePolicy`, no pull secret |
| Injected container name | n/a | `crowdstrike-falcon-container` |
| Find detections | **Next-Gen SIEM** → **Monitor and investigate** → **Detections** (**Source product** = **Cloud**) | n/a |

</div>

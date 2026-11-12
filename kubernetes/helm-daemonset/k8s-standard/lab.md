# Falcon Platform Helm Deployment — Standard Kubernetes (DaemonSet)

Deploy the CrowdStrike Falcon Platform on any standard Kubernetes cluster (EKS, GKE Standard, AKS, on-prem) using the DaemonSet approach, pulling images directly from CrowdStrike's registry.

> **Prerequisites:**
>
> - Helm 3 installed (`helm version` shows v3.x)
> - CrowdStrike Falcon API credentials (Client ID + Secret)
>   - Required scopes to pull the images (sensor, KAC, IAR):
>     - **Sensor Download** (Read)
>     - **Falcon Images Download** (Read)
>   - Additional scopes IAR needs at runtime to upload image assessments:
>     - **Falcon Container Image** (Read/Write)
>     - **Falcon Container CLI** (Write)
> - CrowdStrike CID (with checksum)
> - **Quick Deploy path:** an existing Kubernetes cluster with `kubectl` configured (`kubectl get nodes` returns nodes)
> - **Full Lab path:** cloud CLI for your provider (`gcloud` / `aws` + `eksctl` / `az`) — Section 1 Step 1 covers install and auth

## Reference Docs

| Source                               | Link                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| falcon-platform Helm chart (GitHub)  | https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-platform                     |
| Falcon Container Image Pull Script   | https://github.com/CrowdStrike/falcon-scripts/tree/main/bash/containers/falcon-container-sensor-pull |
| Deploy Falcon Sensor via Helm (Docs) | https://docs.crowdstrike.com/r/en-US/qg0ygdwl/l303c850                                               |
| Falcon Helm Chart Values Reference   | https://github.com/CrowdStrike/falcon-helm/blob/main/helm-charts/falcon-platform/values.yaml         |

---

## Core Concepts

The **falcon-platform** umbrella Helm chart deploys three components in a single `helm install`:

- **Falcon Sensor** (DaemonSet) — Kernel-level runtime protection on every node. One pod per node in `falcon-system` namespace.
- **Falcon KAC** (Deployment) — Kubernetes Admission Controller. Validates pod specs against CrowdStrike policy before they're admitted. Runs in `falcon-kac` namespace.
- **Falcon Image Analyzer** (Deployment) — Scans container images running in the cluster for vulnerabilities and misconfigurations. Runs in `falcon-image-analyzer` namespace.

All three pull images either directly from CrowdStrike's private registry (`registry.crowdstrike.com`) using a pull token generated from your API credentials, or from your own registry after you copy the images there.

```
KUBERNETES CLUSTER — FALCON PLATFORM HELM DEPLOYMENT
DaemonSet: 1 pod per node | Deployment: 1 pod per cluster
Node 1: falcon-sensor | Node 2: falcon-sensor | Node 3: falcon-sensor
Falcon KAC (Deployment) — Admission Controller
Falcon Image Analyzer (Deployment) — Image Assessment
Image Registry (CrowdStrike) — sensor, KAC and IAR images
CrowdStrike Cloud — Telemetry
```

---

## Deployment Steps

<div data-mode="guide">

### 1. Set credentials

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,CLUSTER_NAME:Cluster name"></div>

Export the API client secret:

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

### 2. Get the images

Choose where Kubernetes should pull the Falcon images from. The page below shows only the steps for your choice.

<div data-registry-picker></div>

<div data-registry="crowdstrike">

Generate the registry pull token (Kubernetes uses it to authenticate to CrowdStrike's registry):

```bash
export FALCON_PULL_TOKEN=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --get-pull-token)
echo "FALCON_PULL_TOKEN: $FALCON_PULL_TOKEN"
```

Get each component's image location and split it into registry + tag. `--get-image-path` returns the image's location in CrowdStrike's registry, so Kubernetes pulls directly from CrowdStrike at runtime:

```bash
export SENSOR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --get-image-path)
echo "SENSOR_IMAGE_PATH: $SENSOR_IMAGE_PATH"
export DAEMONSET_SENSOR_REGISTRY=$(echo $SENSOR_IMAGE_PATH | cut -d: -f1)
export DAEMONSET_SENSOR_IMAGE_TAG=$(echo $SENSOR_IMAGE_PATH | cut -d: -f2)
#@opt=kac
export KAC_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \ #@opt=kac
  --client-id <FALCON_CLIENT_ID> \ #@opt=kac
  --client-secret $FALCON_CLIENT_SECRET \ #@opt=kac
  --type falcon-kac \ #@opt=kac
  --get-image-path) #@opt=kac
echo "KAC_IMAGE_PATH: $KAC_IMAGE_PATH" #@opt=kac
export KAC_REGISTRY=$(echo $KAC_IMAGE_PATH | cut -d: -f1) #@opt=kac
export KAC_IMAGE_TAG=$(echo $KAC_IMAGE_PATH | cut -d: -f2) #@opt=kac
#@opt=iar
export IAR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \ #@opt=iar
  --client-id <FALCON_CLIENT_ID> \ #@opt=iar
  --client-secret $FALCON_CLIENT_SECRET \ #@opt=iar
  --type falcon-imageanalyzer \ #@opt=iar
  --get-image-path) #@opt=iar
echo "IAR_IMAGE_PATH: $IAR_IMAGE_PATH" #@opt=iar
export IAR_REGISTRY=$(echo $IAR_IMAGE_PATH | cut -d: -f1) #@opt=iar
export IAR_IMAGE_TAG=$(echo $IAR_IMAGE_PATH | cut -d: -f2) #@opt=iar
```

</div>

<div data-registry="ecr">

<div data-registry="ecr-new">

Enter your AWS account and region. They build your ECR registry address (`<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com`):

<div data-fill-fields="AWS_ACCOUNT_ID:AWS account ID,AWS_REGION:AWS region" data-fill-derive="REGISTRY=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com"></div>

ECR does not create repositories on push, so create one per image (this skips any that already exist):

```bash
for repo in falcon-sensor falcon-kac falcon-imageanalyzer; do #@opt=kac #@opt=iar
for repo in falcon-sensor falcon-kac; do #@opt=kac #@opt=noiar
for repo in falcon-sensor falcon-imageanalyzer; do #@opt=nokac #@opt=iar
for repo in falcon-sensor; do #@opt=nokac #@opt=noiar
  aws ecr describe-repositories --repository-names $repo --region <AWS_REGION> >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name $repo --region <AWS_REGION>
done
```

Log Docker in to ECR (the pull script does not log in to the destination):

```bash
aws ecr get-login-password --region <AWS_REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

> **Note:** `--copy` appends the image name itself, so each image lands in the repo named after it.

</div>

<div data-registry="ecr-existing">

Enter your AWS account, region, and the name of your existing ECR repository (`<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/<ECR_REPOSITORY>`):

<div data-fill-fields="AWS_ACCOUNT_ID:AWS account ID,AWS_REGION:AWS region,ECR_REPOSITORY:ECR repository" data-fill-derive="REGISTRY=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/<ECR_REPOSITORY>"></div>

Log Docker in to the ECR registry (the pull script does not log in to the destination):

```bash
aws ecr get-login-password --region <AWS_REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

> **Note:** The repository must already exist. All the images go into it, tagged `<image>-<version>` (for example `falcon-sensor-8.11.0-19508-1`).

</div>

</div>

<div data-registry="acr">

Enter your ACR name and resource group. The registry address is `<ACR_NAME>.azurecr.io`:

<div data-fill-fields="ACR_NAME:ACR name,RESOURCE_GROUP:Resource group" data-fill-derive="REGISTRY=<ACR_NAME>.azurecr.io"></div>

Log Docker in to ACR. ACR creates each repository on first push, so there is nothing to pre-create:

```bash
az acr login --name <ACR_NAME>
```

Let the AKS cluster pull from this registry (grants its kubelet identity the `AcrPull` role):

```bash
az aks update --name <CLUSTER_NAME> --resource-group <RESOURCE_GROUP> --attach-acr <ACR_NAME>
```

> **Why this matters:** AKS has no pull access to your ACR until you attach it. If you skip this, pods stay in `ImagePullBackOff` with an `unauthorized` error.

</div>

<div data-registry="gar">

Enter your Artifact Registry location, project, and repository name. The path is `<GAR_REGION>-docker.pkg.dev/<PROJECT_ID>/<REPO_NAME>`:

<div data-fill-fields="GAR_REGION:GAR region,PROJECT_ID:GCP project ID,REPO_NAME:Repository name" data-fill-derive="REGISTRY=<GAR_REGION>-docker.pkg.dev/<PROJECT_ID>/<REPO_NAME>"></div>

Create the Docker repository (this skips it if it already exists; the name must match the last part of the path above):

```bash
gcloud artifacts repositories describe <REPO_NAME> --location=<GAR_REGION> --project=<PROJECT_ID> >/dev/null 2>&1 \
  || gcloud artifacts repositories create <REPO_NAME> --repository-format=docker --location=<GAR_REGION> --project=<PROJECT_ID>
```

> **Heads-up:** If you see `Artifact Registry API has not been used`, run `gcloud services enable artifactregistry.googleapis.com --project=<PROJECT_ID>` and retry.

Log Docker in to Artifact Registry:

```bash
gcloud auth configure-docker <GAR_REGION>-docker.pkg.dev
```

> **Why this matters:** GKE nodes pull from Artifact Registry in the same project with the node service account (the default Compute Engine account can read it), so Helm needs no registry credentials. For a registry in another project, grant that service account `roles/artifactregistry.reader` on it.

</div>

<div data-registry="generic">

Enter your registry host, repository path, and the username and password Kubernetes will pull with. The registry address is `<REGISTRY_HOST>/<REPOSITORY_PATH>`:

<div data-fill-fields="REGISTRY_HOST:Registry host,REPOSITORY_PATH:Repository path,REGISTRY_USERNAME:Registry username,REGISTRY_PASSWORD:Registry password" data-fill-derive="REGISTRY=<REGISTRY_HOST>/<REPOSITORY_PATH>"></div>

Log Docker in so the pull script can push to it:

```bash
docker login <REGISTRY_HOST>
```

Build the credentials Kubernetes will use to pull from it. This creates a base64 Docker config for Helm without touching the cluster:

```bash
export REGISTRY_CONFIG_JSON=$(kubectl create secret docker-registry regcred \
  --docker-server=<REGISTRY_HOST> \
  --docker-username=<REGISTRY_USERNAME> \
  --docker-password=<REGISTRY_PASSWORD> \
  --dry-run=client -o jsonpath='{.data.\.dockerconfigjson}')
```

> **Why this matters:** A registry outside your cloud can't use node identity, so Kubernetes needs a username and password. Helm takes them as `global.containerRegistry.configJSON`, which the chart turns into an image pull secret in each Falcon namespace for you.

</div>

<div data-registry="own">

Copy the images into your registry:

```bash
tag_of() { curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type $1 --get-image-path | cut -d: -f2; }
for t in falcon-sensor falcon-kac falcon-imageanalyzer; do #@opt=kac #@opt=iar
for t in falcon-sensor falcon-kac; do #@opt=kac #@opt=noiar
for t in falcon-sensor falcon-imageanalyzer; do #@opt=nokac #@opt=iar
for t in falcon-sensor; do #@opt=nokac #@opt=noiar
  curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
    --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type $t --copy <REGISTRY> #@registry=per-image
    --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type $t --copy <REGISTRY> --copy-omit-image-name --copy-custom-tag "$t-$(tag_of $t)" #@registry=ecr-existing
done
```

<div data-registry="per-image">

Set the registry + tag variables (the copy keeps the source tag, so `tag_of` returns what landed in your registry):

```bash
export DAEMONSET_SENSOR_REGISTRY=<REGISTRY>/falcon-sensor
export DAEMONSET_SENSOR_IMAGE_TAG=$(tag_of falcon-sensor)
#@opt=kac
export KAC_REGISTRY=<REGISTRY>/falcon-kac #@opt=kac
export KAC_IMAGE_TAG=$(tag_of falcon-kac) #@opt=kac
#@opt=iar
export IAR_REGISTRY=<REGISTRY>/falcon-imageanalyzer #@opt=iar
export IAR_IMAGE_TAG=$(tag_of falcon-imageanalyzer) #@opt=iar
```

</div>

<div data-registry="ecr-existing">

Every image is in the same repository, so each tag starts with the image name (`falcon-sensor-<version>`). Set the registry + tag variables:

```bash
export DAEMONSET_SENSOR_REGISTRY=<REGISTRY>
export DAEMONSET_SENSOR_IMAGE_TAG=falcon-sensor-$(tag_of falcon-sensor)
#@opt=kac
export KAC_REGISTRY=<REGISTRY> #@opt=kac
export KAC_IMAGE_TAG=falcon-kac-$(tag_of falcon-kac) #@opt=kac
#@opt=iar
export IAR_REGISTRY=<REGISTRY> #@opt=iar
export IAR_IMAGE_TAG=falcon-imageanalyzer-$(tag_of falcon-imageanalyzer) #@opt=iar
```

</div>

</div>

Validate the client secret and every image variable the Helm install needs was populated (a ✅ means set, a ❌ means missing):

```bash
echo "Client Secret  : $([ -n "$FALCON_CLIENT_SECRET" ] && echo ✅ || echo ❌)"
echo "Pull Token     : $([ -n "$FALCON_PULL_TOKEN" ] && echo ✅ || echo ❌)"  #@registry=crowdstrike
echo "Registry creds : $([ -n "$REGISTRY_CONFIG_JSON" ] && echo ✅ || echo ❌)"  #@registry=generic
echo "Sensor         : $([ -n "$DAEMONSET_SENSOR_REGISTRY" ] && echo ✅ || echo ❌) ($DAEMONSET_SENSOR_REGISTRY:$DAEMONSET_SENSOR_IMAGE_TAG)"
echo "KAC            : $([ -n "$KAC_REGISTRY" ] && echo ✅ || echo ❌) ($KAC_REGISTRY:$KAC_IMAGE_TAG)"  #@opt=kac
echo "IAR            : $([ -n "$IAR_REGISTRY" ] && echo ✅ || echo ❌) ($IAR_REGISTRY:$IAR_IMAGE_TAG)"  #@opt=iar
```

### 3. Add Helm repo

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update
```

### 4. Deploy the chart

> **Note:** Open **Additional settings** below for GovCloud, proxy, and which components (KAC, Image Analyzer) to deploy. The commands update to match.

<div data-deploy-options></div>

<div data-registry="crowdstrike">

Install the chart, passing the pull token so Kubernetes can pull from CrowdStrike's registry:

> **Note:** Edit the highlighted `SENSOR_TAGS` field (the page replaces it when you click Copy) to group this sensor in the Falcon console. Use comma-separated values; letters, numbers, `-`, `_`, `/` only.

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set falcon-sensor.falcon.tags="<SENSOR_TAGS:daemonset-sensor>" \
  --set global.falcon.cid=<FALCON_CID> \
  --set global.containerRegistry.configJSON=$FALCON_PULL_TOKEN \
  --set falcon-sensor.node.image.repository=$DAEMONSET_SENSOR_REGISTRY \
  --set falcon-sensor.node.image.tag=$DAEMONSET_SENSOR_IMAGE_TAG \
  --set falcon-sensor.falcon.aph=<PROXY_HOST> \ #@opt=proxy
  --set falcon-sensor.falcon.app=<PROXY_PORT> \ #@opt=proxy
  --set falcon-kac.enabled=false \ #@opt=nokac
  --set falcon-kac.image.repository=$KAC_REGISTRY \ #@opt=kac
  --set falcon-kac.image.tag=$KAC_IMAGE_TAG \ #@opt=kac
  --set falcon-kac.falcon.aph=<PROXY_HOST> \ #@opt=kac #@opt=proxy
  --set falcon-kac.falcon.app=<PROXY_PORT> \ #@opt=kac #@opt=proxy
  --set falcon-image-analyzer.enabled=false \ #@opt=noiar
  --set falcon-image-analyzer.deployment.enabled=true \ #@opt=iar
  --set falcon-image-analyzer.image.repository=$IAR_REGISTRY \ #@opt=iar
  --set falcon-image-analyzer.image.tag=$IAR_IMAGE_TAG \ #@opt=iar
  --set falcon-image-analyzer.crowdstrikeConfig.clusterName=<CLUSTER_NAME> \ #@opt=iar
  --set falcon-image-analyzer.crowdstrikeConfig.agentRegion=gov1 \ #@opt=iar #@region=gov1
  --set falcon-image-analyzer.crowdstrikeConfig.agentRegion=gov2 \ #@opt=iar #@region=gov2
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=<FALCON_CLIENT_ID> \ #@opt=iar
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET \ #@opt=iar
  --set falcon-image-analyzer.proxyConfig.HTTP_PROXY=http://<PROXY_HOST>:<PROXY_PORT> \ #@opt=iar #@opt=proxy
  --set falcon-image-analyzer.proxyConfig.HTTPS_PROXY=http://<PROXY_HOST>:<PROXY_PORT> \ #@opt=iar #@opt=proxy
  --set createComponentNamespaces=true
```

</div>

<div data-registry="ecr,acr,gar">

Install the chart. No registry credentials are passed because the cluster's nodes pull from your registry with their own cloud identity:

> **Note:** Edit the highlighted `SENSOR_TAGS` field (the page replaces it when you click Copy) to group this sensor in the Falcon console. Use comma-separated values; letters, numbers, `-`, `_`, `/` only.

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set falcon-sensor.falcon.tags="<SENSOR_TAGS:daemonset-sensor>" \
  --set global.falcon.cid=<FALCON_CID> \
  --set falcon-sensor.node.image.repository=$DAEMONSET_SENSOR_REGISTRY \
  --set falcon-sensor.node.image.tag=$DAEMONSET_SENSOR_IMAGE_TAG \
  --set falcon-sensor.falcon.aph=<PROXY_HOST> \ #@opt=proxy
  --set falcon-sensor.falcon.app=<PROXY_PORT> \ #@opt=proxy
  --set falcon-kac.enabled=false \ #@opt=nokac
  --set falcon-kac.image.repository=$KAC_REGISTRY \ #@opt=kac
  --set falcon-kac.image.tag=$KAC_IMAGE_TAG \ #@opt=kac
  --set falcon-kac.falcon.aph=<PROXY_HOST> \ #@opt=kac #@opt=proxy
  --set falcon-kac.falcon.app=<PROXY_PORT> \ #@opt=kac #@opt=proxy
  --set falcon-image-analyzer.enabled=false \ #@opt=noiar
  --set falcon-image-analyzer.deployment.enabled=true \ #@opt=iar
  --set falcon-image-analyzer.image.repository=$IAR_REGISTRY \ #@opt=iar
  --set falcon-image-analyzer.image.tag=$IAR_IMAGE_TAG \ #@opt=iar
  --set falcon-image-analyzer.crowdstrikeConfig.clusterName=<CLUSTER_NAME> \ #@opt=iar
  --set falcon-image-analyzer.crowdstrikeConfig.agentRegion=gov1 \ #@opt=iar #@region=gov1
  --set falcon-image-analyzer.crowdstrikeConfig.agentRegion=gov2 \ #@opt=iar #@region=gov2
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=<FALCON_CLIENT_ID> \ #@opt=iar
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET \ #@opt=iar
  --set falcon-image-analyzer.proxyConfig.HTTP_PROXY=http://<PROXY_HOST>:<PROXY_PORT> \ #@opt=iar #@opt=proxy
  --set falcon-image-analyzer.proxyConfig.HTTPS_PROXY=http://<PROXY_HOST>:<PROXY_PORT> \ #@opt=iar #@opt=proxy
  --set createComponentNamespaces=true
```

</div>

<div data-registry="generic">

Install the chart, passing the registry credentials built in Step 2 so Kubernetes can pull from your registry:

> **Note:** Edit the highlighted `SENSOR_TAGS` field (the page replaces it when you click Copy) to group this sensor in the Falcon console. Use comma-separated values; letters, numbers, `-`, `_`, `/` only.

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set falcon-sensor.falcon.tags="<SENSOR_TAGS:daemonset-sensor>" \
  --set global.falcon.cid=<FALCON_CID> \
  --set global.containerRegistry.configJSON=$REGISTRY_CONFIG_JSON \
  --set falcon-sensor.node.image.repository=$DAEMONSET_SENSOR_REGISTRY \
  --set falcon-sensor.node.image.tag=$DAEMONSET_SENSOR_IMAGE_TAG \
  --set falcon-sensor.falcon.aph=<PROXY_HOST> \ #@opt=proxy
  --set falcon-sensor.falcon.app=<PROXY_PORT> \ #@opt=proxy
  --set falcon-kac.enabled=false \ #@opt=nokac
  --set falcon-kac.image.repository=$KAC_REGISTRY \ #@opt=kac
  --set falcon-kac.image.tag=$KAC_IMAGE_TAG \ #@opt=kac
  --set falcon-kac.falcon.aph=<PROXY_HOST> \ #@opt=kac #@opt=proxy
  --set falcon-kac.falcon.app=<PROXY_PORT> \ #@opt=kac #@opt=proxy
  --set falcon-image-analyzer.enabled=false \ #@opt=noiar
  --set falcon-image-analyzer.deployment.enabled=true \ #@opt=iar
  --set falcon-image-analyzer.image.repository=$IAR_REGISTRY \ #@opt=iar
  --set falcon-image-analyzer.image.tag=$IAR_IMAGE_TAG \ #@opt=iar
  --set falcon-image-analyzer.crowdstrikeConfig.clusterName=<CLUSTER_NAME> \ #@opt=iar
  --set falcon-image-analyzer.crowdstrikeConfig.agentRegion=gov1 \ #@opt=iar #@region=gov1
  --set falcon-image-analyzer.crowdstrikeConfig.agentRegion=gov2 \ #@opt=iar #@region=gov2
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=<FALCON_CLIENT_ID> \ #@opt=iar
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET \ #@opt=iar
  --set falcon-image-analyzer.proxyConfig.HTTP_PROXY=http://<PROXY_HOST>:<PROXY_PORT> \ #@opt=iar #@opt=proxy
  --set falcon-image-analyzer.proxyConfig.HTTPS_PROXY=http://<PROXY_HOST>:<PROXY_PORT> \ #@opt=iar #@opt=proxy
  --set createComponentNamespaces=true
```

</div>

### 5. Verify deployment

Wait for every Falcon pod to reach `Ready`. Each namespace is checked in parallel, each prints ✅ when all its pods are Ready or ❌ if they aren't within 3 minutes:

```bash
(
for ns in falcon-system falcon-kac falcon-image-analyzer; do #@opt=kac #@opt=iar
for ns in falcon-system falcon-kac; do #@opt=kac #@opt=noiar
for ns in falcon-system falcon-image-analyzer; do #@opt=nokac #@opt=iar
for ns in falcon-system; do #@opt=nokac #@opt=noiar
  (kubectl wait --for=condition=Ready pods --all -n $ns --timeout=180s >/dev/null 2>&1 \
    && echo "✅ $ns: Ready" \
    || echo "❌ $ns: not Ready (run: kubectl get pods -n $ns)") &
done
wait
)
```

> **Heads-up:** The first sensor image pull is ~500 MB per node, so it is normally the slowest part. If you see ❌ right away, the pods may not have been created yet; wait a few seconds and re-run. If a pod shows `ImagePullBackOff` in `kubectl get pods`, the image pull is failing (registry address, tag, or credentials), so don't wait out the timeout.

Then confirm what's running:

```bash
kubectl get pods -A | grep falcon
kubectl get ds -n falcon-system
```

Every Falcon pod should be `Running`. The DaemonSet should show `DESIRED` = `CURRENT` = number of nodes.

> **Note:** If your nodes have taints (common on dedicated or GPU node pools), the sensor DaemonSet will skip them unless you add tolerations via `falcon-sensor.node.daemonset.tolerations`. Most lab clusters have no taints, so you can ignore this.

### 6. Test a detection (optional)

Deploy the CrowdStrike vulnapp, trigger a simulated attack from its web UI, and confirm the detection lands in the Falcon console.

```bash
kubectl apply -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

Once the pod is running, port-forward to it (this blocks — leave it running):

```bash
kubectl port-forward svc/vulnerable-example-com 8060:80
```

Open [http://localhost:8060](http://localhost:8060) in your browser and click any attack simulation (e.g. **Access sensitive files**, **Kill process**) to generate activity the node sensor will detect.

Check **Falcon Console** > **Next-Gen SIEM** > **Monitor and investigate** > **Detections**, then filter **Source product** = **Cloud** — a new detection should appear within a few minutes. Then stop the port-forward (Ctrl+C) and remove the app:

```bash
kubectl delete -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

### 7. Clean up (optional)

Removes everything this guide deployed. Your cluster itself is not touched.

Remove the vulnapp if it's still running (safe to run if you already deleted it):

```bash
kubectl delete -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml --ignore-not-found
```

Uninstall the Falcon platform release. This removes the sensor, KAC, and Image Analyzer, and a post-delete hook cleans the sensor files off each node:

```bash
helm uninstall falcon-platform -n falcon-platform
```

Delete the namespaces the chart created:

```bash
kubectl delete ns falcon-platform falcon-system falcon-kac falcon-image-analyzer --ignore-not-found
```

Confirm nothing is left:

```bash
kubectl get pods -A | grep falcon
helm list -A | grep falcon
```

> **Verify:** Both commands should print nothing. A pod still listed as `Terminating` is fine; it disappears within a minute.

> **Note:** The host entries stay in the Falcon console for a while after the sensors are gone. If you copied images into your own registry, those images are not removed by this step.

</div>

<div data-mode="lab">

## 1. Provision a Test Cluster

> **What & Why:** You need a running Kubernetes cluster to deploy the Falcon sensor. Any standard cluster works — the Helm chart is cloud-agnostic. Pick whichever provider you have access to.

### Step 1: Install and authenticate your cloud CLI

> **What & Why:** Fresh accounts often hit "command not found" or "API not enabled" errors on the very first provision command. Install and log in first, then enable the container service API for GKE.

<div data-lab-variables></div>

<div data-cloud="gke">

**GKE:** [Install `gcloud`](https://cloud.google.com/sdk/docs/install), then:

```bash
gcloud auth login
gcloud projects list                                  # find your project ID
gcloud config set project <YOUR_GCP_PROJECT_ID>
gcloud services enable container.googleapis.com       # can take ~1-2 min
```

</div>

<div data-cloud="eks">

**EKS:** [Install `aws` CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) and [`eksctl`](https://eksctl.io/installation/), then:

```bash
aws configure   # or: aws sso login
aws sts get-caller-identity   # confirm you're the expected principal
```

Your IAM principal needs the [eksctl minimum policies](https://eksctl.io/usage/minimum-iam-policies/) (EC2, EKS, IAM, CloudFormation, VPC).

</div>

<div data-cloud="aks">

**AKS:** [Install `az` CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), then:

```bash
az login
az account list --output table                        # find your subscription ID
az account set --subscription <YOUR_AZURE_SUBSCRIPTION_ID>
```

</div>

### Step 2: Create the cluster

Cluster provisioning takes several minutes — don't Ctrl+C.

<div data-cloud="gke">

**GKE:** *(expect ~3-5 min)*

- [ ] **Console:** Navigate to **Kubernetes Engine** → **Clusters** → **Create** → choose **Standard** → set name `{{CLUSTER_NAME}}`, zone `{{REGION}}`, and node count `2` (machine type `e2-standard-2`) → **Create**

> **Why this matters:** A GKE Standard cluster gives you node-level access (needed for the DaemonSet sensor to load its eBPF module). Autopilot restricts that — use the separate GKE Autopilot lab if you want the managed-node experience.

<details>
<summary>CLI equivalent</summary>

```bash
gcloud container clusters create {{CLUSTER_NAME}} \
  --zone {{REGION}} \
  --num-nodes 2 \
  --machine-type e2-standard-2
```

</details>

</div>

<div data-cloud="eks">

**EKS:** *(expect ~15-20 min — a VPC, subnets, IAM roles, control plane, and node group are all created)*

- [ ] **Console:** Navigate to **EKS** → **Clusters** → **Create cluster** → set name `{{CLUSTER_NAME}}`, Kubernetes version (default is fine), and cluster service role (create one if you don't have `AmazonEKSClusterRole`) → accept default VPC/subnets → **Create**
- [ ] After the cluster shows **Active** (~10-15 min), open it → **Compute** tab → **Add node group** → name it `default`, pick the `AmazonEKSNodeRole` (create if needed), instance type `t3.large`, desired size `2` → **Create**

> **Why this matters:** EKS separates the control plane (managed by AWS) from the data plane (your node group). Both need distinct IAM roles — the cluster role authorizes AWS to manage the control plane, and the node role authorizes each worker to pull from ECR, join the cluster, and describe EC2 resources.

<details>
<summary>CLI equivalent</summary>

```bash
eksctl create cluster \
  --name {{CLUSTER_NAME}} \
  --region {{REGION}} \
  --nodes 2 \
  --node-type t3.large
```

`eksctl` collapses the two console steps (cluster + node group) into one command and generates both IAM roles automatically.

</details>

</div>

<div data-cloud="aks">

**AKS:** *(expect ~5-10 min)*

- [ ] **Console (Azure portal):** Search **Resource groups** → **Create** → name `falcon-lab-rg`, region `{{REGION}}` → **Review + create** → **Create**
- [ ] Search **Kubernetes services** → **Create** → **Kubernetes cluster** → pick subscription + `falcon-lab-rg`, cluster name `{{CLUSTER_NAME}}`, region `{{REGION}}` → on the **Node pools** tab set node count `2`, size `Standard_D2s_v5` → **Review + create** → **Create**

> **Why this matters:** A resource group is Azure's container for all resources tied to a workload — deleting the group at cleanup time deletes the cluster, its node VMs, load balancers, and disks together. Get in the habit of creating one per lab.

<details>
<summary>CLI equivalent</summary>

```bash
az group create --name falcon-lab-rg --location {{REGION}}
az aks create --resource-group falcon-lab-rg --name {{CLUSTER_NAME}} \
  --node-count 2 --node-vm-size Standard_D2s_v5 --generate-ssh-keys
az aks get-credentials --resource-group falcon-lab-rg --name {{CLUSTER_NAME}}
```

`az aks get-credentials` merges the cluster's kubeconfig into `~/.kube/config` — the console equivalent is the **Connect** button on the cluster's Overview page, which prints the same command.

</details>

</div>

### Step 3: Verify connectivity

- [ ] Confirm kubectl is pointing at the new cluster (the output should contain your cluster name):

```bash
kubectl config current-context
```

- [ ] List the nodes:

```bash
kubectl get nodes
```

You should see 2 nodes in `Ready` state:

```
NAME                                     STATUS   ROLES    AGE   VERSION
<node-1>                                 Ready    <none>   2m    v1.30.x
<node-2>                                 Ready    <none>   2m    v1.30.x
```

---

## 2. Configure API Credentials

> **What & Why:** The Falcon container images live in CrowdStrike's private registry. You need API credentials to generate a pull token and discover the correct image paths for your CID.

### Step 1: Create an API client

- [ ] Navigate to **Falcon Console** > **Support and resources** > **API clients and keys** > **Create API client**
- [ ] Set the following OAuth 2.0 scopes:
  - Sensor Download: **Read**
  - Falcon Images Download: **Read**
  - Falcon Container Image: **Read/Write**
  - Falcon Container CLI: **Write**

<details>
<summary>CLI equivalent</summary>

There is no CLI for creating API clients — this must be done in the console.

</details>

### Step 2: Export credentials

- [ ] Enter your values:

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID"></div>

- [ ] Export the API client secret:

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

---

## 3. Get Pull Token and Image Paths

> **What & Why:** The pull token authenticates Kubernetes to CrowdStrike's container registry. The image paths tell Helm exactly which sensor, KAC, and IAR images to pull for your CID's assigned cloud region.

### Step 1: Generate pull token

- [ ] Run the CrowdStrike pull script with `--get-pull-token`:

```bash
export FALCON_PULL_TOKEN=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --get-pull-token)
```

### Step 2: Get image paths for all three components

- [ ] Get the sensor image path:

```bash
export SENSOR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --get-image-path)
echo "SENSOR_IMAGE_PATH: $SENSOR_IMAGE_PATH"
```

- [ ] Get the KAC image path:

```bash
export KAC_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-kac \
  --get-image-path)
echo "KAC_IMAGE_PATH: $KAC_IMAGE_PATH"
```

- [ ] Get the Image Analyzer image path:

```bash
export IAR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-imageanalyzer \
  --get-image-path)
echo "IAR_IMAGE_PATH: $IAR_IMAGE_PATH"
```

> **Note:** `--get-image-path` returns the image location in CrowdStrike's registry, so Kubernetes pulls directly from CrowdStrike at runtime. To host the images in your own registry instead, swap `--get-image-path` for `--copy <your-registry>` — see the example below.

<details>
<summary><strong>Example — copy the sensor image to your own registry</strong></summary>

`--copy` pulls from CrowdStrike to your local Docker daemon, then pushes into your registry. **Prereq:** the destination repo must exist and Docker must already be authenticated to it (`aws ecr get-login-password ... | docker login` / `az acr login` / `gcloud auth configure-docker`). The repo name must **exactly match** the image name (`falcon-sensor`) — `--copy` doesn't rename.

> **Why this matters:** Hosting images in-cloud removes runtime dependency on CrowdStrike's registry, gives you image scanning + retention control, and lets you pre-warm images before rolling clusters. On EKS/GKE/AKS, node roles/service accounts can pull from same-cloud registries natively — meaning in Section 5 you can drop `--set global.containerRegistry.configJSON=$FALCON_PULL_TOKEN` from the Helm install.

<div data-cloud="eks">

**AWS Elastic Container Registry (ECR)**

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --copy <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

> **Note:** The script appends the image name itself, so `--copy` takes just the registry (no `/<REPOSITORY>` suffix) and pushes to `<registry>/falcon-sensor:<tag>`. To push to a differently named ECR repo instead, end the value with the repo and add `--copy-omit-image-name` — this pushes to `<REPOSITORY>:<tag>`:

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --copy <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/<REPOSITORY> \
  --copy-omit-image-name
```

</div>

<div data-cloud="aks">

**Azure Container Registry (ACR)**

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --copy <ACR_NAME>.azurecr.io
```

</div>

<div data-cloud="gke">

**GCP Google Artifact Registry (GAR)**

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --copy <GAR_REGION>-docker.pkg.dev/<PROJECT_ID>/<REPO_NAME>
```

</div>

Repeat the same command with `--type falcon-kac` and `--type falcon-imageanalyzer` for the other components, then point `DAEMONSET_SENSOR_REGISTRY` / `KAC_REGISTRY` / `IAR_REGISTRY` at your registry before the Helm install.

</details>

### Step 3: Parse and set all variables

- [ ] Split the image paths into registry and tag:

```bash
export DAEMONSET_SENSOR_REGISTRY=$(echo $SENSOR_IMAGE_PATH | cut -d: -f1)
export DAEMONSET_SENSOR_IMAGE_TAG=$(echo $SENSOR_IMAGE_PATH | cut -d: -f2)

export KAC_REGISTRY=$(echo $KAC_IMAGE_PATH | cut -d: -f1)
export KAC_IMAGE_TAG=$(echo $KAC_IMAGE_PATH | cut -d: -f2)

export IAR_REGISTRY=$(echo $IAR_IMAGE_PATH | cut -d: -f1)
export IAR_IMAGE_TAG=$(echo $IAR_IMAGE_PATH | cut -d: -f2)
```

### Step 4: Validate the saved variables

> **What & Why:** Each command above can fail silently — an expired token or a missing API scope returns an empty string, and the `cut` parsing happily produces empty registry/tag values. Echoing every variable the Helm install consumes confirms they're all saved before you build a 14-flag command on top of them. Secrets are reported as `SET`/`MISSING` rather than printed.

- [ ] Print every value the Helm install needs:

```bash
echo "Client Secret  : $([ -n "$FALCON_CLIENT_SECRET" ] && echo SET || echo MISSING)"
echo "Pull Token     : $([ -n "$FALCON_PULL_TOKEN" ] && echo SET || echo MISSING)"
echo "Sensor         : $([ -n "$DAEMONSET_SENSOR_REGISTRY" ] && echo SET || echo MISSING) ($DAEMONSET_SENSOR_REGISTRY:$DAEMONSET_SENSOR_IMAGE_TAG)"
echo "KAC            : $([ -n "$KAC_REGISTRY" ] && echo SET || echo MISSING) ($KAC_REGISTRY:$KAC_IMAGE_TAG)"
echo "IAR            : $([ -n "$IAR_REGISTRY" ] && echo SET || echo MISSING) ($IAR_REGISTRY:$IAR_IMAGE_TAG)"
```

---

## 4. Add Helm Repository

> **What & Why:** The CrowdStrike Helm charts are published to a public Helm repository. Adding it to your local Helm config lets you install charts by name rather than downloading them manually.

- [ ] Add the CrowdStrike Helm repo and update:

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update
```

- [ ] Verify the chart is available:

```bash
helm search repo crowdstrike/falcon-platform
```

---

## 5. Deploy the Falcon Platform

> **What & Why:** The `falcon-platform` umbrella chart installs all three components (sensor, KAC, IAR) in a single Helm release. Using `--set createComponentNamespaces=true` gives each component its own namespace for isolation.

### Step 1: Install the chart

> **Note:** Edit the highlighted `SENSOR_TAGS` field (the page replaces it when you click Copy) to group this sensor in the Falcon console. Use comma-separated values; letters, numbers, `-`, `_`, `/` only.

- [ ] Run the Helm install with all component configurations:

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set falcon-sensor.falcon.tags="<SENSOR_TAGS:daemonset-sensor>" \
  --set createComponentNamespaces=true \
  --set global.falcon.cid=<FALCON_CID> \
  --set global.containerRegistry.configJSON=$FALCON_PULL_TOKEN \
  --set falcon-sensor.node.image.repository=$DAEMONSET_SENSOR_REGISTRY \
  --set falcon-sensor.node.image.tag=$DAEMONSET_SENSOR_IMAGE_TAG \
  --set falcon-kac.image.repository=$KAC_REGISTRY \
  --set falcon-kac.image.tag=$KAC_IMAGE_TAG \
  --set falcon-image-analyzer.deployment.enabled=true \
  --set falcon-image-analyzer.image.repository=$IAR_REGISTRY \
  --set falcon-image-analyzer.image.tag=$IAR_IMAGE_TAG \
  --set falcon-image-analyzer.crowdstrikeConfig.clusterName={{CLUSTER_NAME}} \
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=<FALCON_CLIENT_ID> \
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET
```

> **Note:** If registering to CrowdStrike GovCloud (us-gov-1 or us-gov-2), add one flag so Image Analyzer targets the right region: `--set falcon-image-analyzer.crowdstrikeConfig.agentRegion=gov1` (use `gov2` for us-gov-2). Skip this if your CID is in a commercial cloud.

### Step 2: Wait for pods to be Ready

- [ ] Block until every Falcon pod reaches `Ready`:

```bash
kubectl wait --for=condition=Ready pods --all -n falcon-system --timeout=5m
kubectl wait --for=condition=Ready pods --all -n falcon-kac --timeout=5m
kubectl wait --for=condition=Ready pods --all -n falcon-image-analyzer --timeout=5m
```

First-time sensor image pull is ~500 MB per node — expect 2-5 minutes on a 2-node cluster. If a wait times out, check the pod status with `kubectl describe pod <name> -n <ns>` (see the Troubleshooting section).

- [ ] Confirm what's running:

```bash
kubectl get pods -A | grep falcon
```

Expected output (one sensor pod per node, one KAC pod, one IAR pod):

```
falcon-system           falcon-sensor-abcde                          1/1     Running   0   2m
falcon-system           falcon-sensor-fghij                          1/1     Running   0   2m
falcon-kac              falcon-kac-<hash>-xyz                        1/1     Running   0   2m
falcon-image-analyzer   falcon-image-analyzer-<hash>-abc             1/1     Running   0   2m
```

---

## 6. Verify Deployment

> **What & Why:** Confirm every Falcon pod is running in-cluster, then confirm the sensors have registered with CrowdStrike by finding them under the tag you set at deploy time.

### Step 1: Confirm all Falcon pods are Running

- [ ] List every Falcon pod across all namespaces:

```bash
kubectl get pods -A | grep -i "falcon"
```

You should see pods in `Running` state across three namespaces:

- `falcon-system` — one `falcon-sensor-*` pod per node (DaemonSet)
- `falcon-kac` — one `falcon-kac-*` pod (Deployment)
- `falcon-image-analyzer` — one `falcon-image-analyzer-*` pod (Deployment)

### Step 2: Verify in Falcon console

- [ ] Navigate to **Falcon Console** > **Host setup and management** > **Host management**
- [ ] In the filter bar, use the **Grouping Tags** filter and enter the tag you set in Section 5: `daemonset-sensor`
- [ ] Your sensor hosts (one per node) should appear within a few minutes of deployment

### Step 3: Troubleshooting

If a pod isn't Running or a sensor never registers, work through this table:

| Symptom | Likely cause | Check |
|---------|--------------|-------|
| `ImagePullBackOff` on any Falcon pod | Pull token expired, missing scope, or wrong region | `kubectl describe pod <name> -n <ns>` — look at the `Events` section for the exact registry error. Re-run the pull-script and re-check API scopes. |
| `CrashLoopBackOff` on `falcon-sensor` | CID mismatch, unsupported kernel, or missing privileged access | `kubectl logs -n falcon-system <pod> -c falcon-node-sensor` |
| Pods Running but no host in Falcon Console | Egress to Falcon cloud blocked (firewall/proxy) or sensor still registering | `kubectl logs -n falcon-system <pod>` and look for connection errors; wait 5 more minutes |
| `kubectl` commands hang or timeout | Wrong kubectl context, or cluster still provisioning | `kubectl config current-context` — should match Section 1 Step 3 pattern |
| `helm status` shows `failed` | Bad `--set` value (empty variable) | Re-run the validate block in Section 3 Step 4 — any `MISSING` value means the step above it silently failed |

---

## 7. Test a Detection (Optional)

> **What & Why:** Confirming the sensor reports hosts proves connectivity, but triggering a real detection proves the sensor is actively monitoring workloads. The CrowdStrike vulnapp is a purpose-built web app that generates safe, simulated attacks you can fire from a browser and watch land in the Falcon console.

### Step 1: Deploy the vulnapp

- [ ] Deploy the app:

```bash
kubectl apply -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

### Step 2: Port-forward and open the web UI

- [ ] Once the pod is running, forward the service to your local machine (this blocks — leave it running):

```bash
kubectl port-forward svc/vulnerable-example-com 8060:80
```

- [ ] Open [http://localhost:8060](http://localhost:8060) in your browser.

### Step 3: Trigger a simulated attack

- [ ] Click any attack simulation in the UI (e.g. **Access sensitive files**, **Kill process**, or **Run a reverse shell**). Each button generates activity the node sensor observes.

### Step 4: Confirm the detection

- [ ] In the Falcon console, go to **Next-Gen SIEM** > **Monitor and investigate** > **Detections**, then filter **Source product** = **Cloud**
- [ ] A new detection tied to your cluster host should appear within a few minutes. Open it to review the process tree and mapped tactic/technique.

### Step 5: Clean up the vulnapp

- [ ] Stop the port-forward (Ctrl+C), then remove the app:

```bash
kubectl delete -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

---

## 8. Cleanup

> **Destructive:** This removes the Falcon components and the test cluster. Run it only when you are finished with the lab.

### Step 1: Uninstall the Helm release

- [ ] Remove the Falcon platform release:

```bash
helm uninstall falcon-platform -n falcon-platform
```

- [ ] Delete the namespaces:

```bash
kubectl delete ns falcon-platform falcon-system falcon-kac falcon-image-analyzer
```

> **Verify:** `kubectl get pods -A | grep falcon` should print nothing. A pod still listed as `Terminating` is fine; it disappears within a minute.

### Step 2: Delete the test cluster

- [ ] Remove the cluster (pick your provider):

<div data-cloud="gke">

**GKE:**

```bash
gcloud container clusters delete {{CLUSTER_NAME}} --zone {{REGION}} --quiet
```

</div>

<div data-cloud="eks">

**EKS:**

```bash
eksctl delete cluster --name {{CLUSTER_NAME}} --region {{REGION}}
```

</div>

<div data-cloud="aks">

**AKS:** Deleting the resource group cascades to the cluster and any related resources. `--no-wait` returns immediately (delete runs async).

```bash
az group delete --name falcon-lab-rg --yes --no-wait
```

</div>

</div>

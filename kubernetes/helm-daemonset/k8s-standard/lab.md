# Falcon Platform Helm Deployment — DaemonSet (Standard Kubernetes)

Deploy the CrowdStrike Falcon Platform on any standard Kubernetes cluster (EKS, GKE Standard, AKS, on-prem) using the DaemonSet approach, pulling images directly from CrowdStrike's registry.

> **Prerequisites:**
>
> - Kubernetes cluster running (EKS, GKE Standard, AKS, kubeadm, Rancher, k3s, etc.)
> - `kubectl` configured for your cluster (`kubectl get nodes` returns nodes)
> - Helm 3 installed (`helm version` shows v3.x)
> - CrowdStrike Falcon API credentials (Client ID + Secret)
>   - Required API scopes:
>     - **Falcon Images Download** (Read)
>     - **Sensor Download** (Read)
>     - **Falcon Container Image** (Read/Write)
>     - **Falcon Container CLI** (Write)
> - CrowdStrike CID (with checksum)
> - ~30 minutes (Quick Deploy) / ~60 minutes (Full Lab)

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

All three pull images from CrowdStrike's private registry (`registry.crowdstrike.com`) using a pull token generated from your API credentials.

```
KUBERNETES CLUSTER — FALCON PLATFORM HELM DEPLOYMENT
DaemonSet: 1 pod per node | Deployment: 1 pod per cluster
Node 1: falcon-sensor | Node 2: falcon-sensor | Node 3: falcon-sensor
Falcon KAC (Deployment) — Admission Controller
Falcon Image Analyzer (Deployment) — Image Assessment
CrowdStrike Cloud — Telemetry
```

---

## Deployment Steps

<div data-mode="guide">

### 1. Set credentials and get pull token

```bash
export FALCON_CID="<YOUR_CID_WITH_CHECKSUM>"
export CLUSTER_NAME="<YOUR_CLUSTER_NAME>"
export FALCON_CLIENT_ID="<YOUR_FALCON_CLIENT_ID>"
export FALCON_CLIENT_SECRET="<YOUR_FALCON_CLIENT_SECRET>"
```

Generate the registry pull token:

```bash
export FALCON_PULL_TOKEN=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --get-pull-token)
```

### 2. Get image paths

```bash
export SENSOR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --get-image-path)

export KAC_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-kac \
  --get-image-path)

export IAR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-imageanalyzer \
  --get-image-path)
```

> **Note:** `--get-image-path` returns the image location in CrowdStrike's registry, so Kubernetes pulls directly from CrowdStrike at runtime. To host the images in your own registry instead, swap `--get-image-path` for `--copy <your-registry>` (e.g. `--copy myregistry.com/mynamespace`) — this copies the sensor image from CrowdStrike into a customer-owned registry rather than pulling from CrowdStrike. Add `--copy-custom-tag <tag>` to override the version tag, then point the `*_REGISTRY` variables at your registry.

Parse into registry + tag:

```bash
export DAEMONSET_SENSOR_REGISTRY=$(echo $SENSOR_IMAGE_PATH | cut -d: -f1)
export DAEMONSET_SENSOR_IMAGE_TAG=$(echo $SENSOR_IMAGE_PATH | cut -d: -f2)

export KAC_REGISTRY=$(echo $KAC_IMAGE_PATH | cut -d: -f1)
export KAC_IMAGE_TAG=$(echo $KAC_IMAGE_PATH | cut -d: -f2)

export IAR_REGISTRY=$(echo $IAR_IMAGE_PATH | cut -d: -f1)
export IAR_IMAGE_TAG=$(echo $IAR_IMAGE_PATH | cut -d: -f2)
```

Validate every variable the Helm install needs was populated:

```bash
echo "CID            : $([ -n "$FALCON_CID" ] && echo SET || echo MISSING) ($FALCON_CID)"
echo "Cluster        : $([ -n "$CLUSTER_NAME" ] && echo SET || echo MISSING) ($CLUSTER_NAME)"
echo "Client ID      : $([ -n "$FALCON_CLIENT_ID" ] && echo SET || echo MISSING) ($FALCON_CLIENT_ID)"
echo "Client Secret  : $([ -n "$FALCON_CLIENT_SECRET" ] && echo SET || echo MISSING) ($FALCON_CLIENT_SECRET)"
echo "Pull Token     : $([ -n "$FALCON_PULL_TOKEN" ] && echo SET || echo MISSING) ($FALCON_PULL_TOKEN)"
echo "Sensor         : $([ -n "$DAEMONSET_SENSOR_REGISTRY" ] && echo SET || echo MISSING) ($DAEMONSET_SENSOR_REGISTRY:$DAEMONSET_SENSOR_IMAGE_TAG)"
echo "KAC            : $([ -n "$KAC_REGISTRY" ] && echo SET || echo MISSING) ($KAC_REGISTRY:$KAC_IMAGE_TAG)"
echo "IAR            : $([ -n "$IAR_REGISTRY" ] && echo SET || echo MISSING) ($IAR_REGISTRY:$IAR_IMAGE_TAG)"
```

Every line should read `SET`. Any line printing `MISSING` means that variable didn't get set — re-check your API scopes, pull token, and the values you exported.

### 3. Add Helm repo

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update
```

### 4. Deploy the chart

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set falcon-sensor.falcon.tags="daemonset-sensor" \
  --set createComponentNamespaces=true \
  --set global.falcon.cid=$FALCON_CID \
  --set global.containerRegistry.configJSON=$FALCON_PULL_TOKEN \
  --set falcon-sensor.node.image.repository=$DAEMONSET_SENSOR_REGISTRY \
  --set falcon-sensor.node.image.tag=$DAEMONSET_SENSOR_IMAGE_TAG \
  --set falcon-kac.image.repository=$KAC_REGISTRY \
  --set falcon-kac.image.tag=$KAC_IMAGE_TAG \
  --set falcon-image-analyzer.deployment.enabled=true \
  --set falcon-image-analyzer.image.repository=$IAR_REGISTRY \
  --set falcon-image-analyzer.image.tag=$IAR_IMAGE_TAG \
  --set falcon-image-analyzer.crowdstrikeConfig.clusterName=$CLUSTER_NAME \
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=$FALCON_CLIENT_ID \
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET
```

> `falcon-sensor.falcon.tags="daemonset-sensor"` applies Falcon console grouping tags to the node sensor — change it to any comma-separated tags you want (e.g. `prod,team-a`).

> `createComponentNamespaces=true` places sensor in `falcon-system`, KAC in `falcon-kac`, and IAR in `falcon-image-analyzer`.

> **GovCloud (us-gov-1 / us-gov-2):** Running the pull script with GovCloud API credentials makes `--get-pull-token` / `--get-image-path` resolve to the GovCloud registry automatically, so your `*_REGISTRY` vars are already correct. Add one flag so Image Analyzer targets the right region: `--set falcon-image-analyzer.crowdstrikeConfig.agentRegion=gov1` (use `gov2` for us-gov-2). Sensor and KAC derive their region from the CID; optionally pin the sensor with `--set falcon-sensor.falcon.cloud=us-gov-1`.

### 5. Verify deployment

```bash
kubectl get pods -n falcon-system
kubectl get pods -n falcon-kac
kubectl get pods -n falcon-image-analyzer
kubectl get ds -n falcon-system
```

All pods should be `Running`. The DaemonSet should show `DESIRED` = `CURRENT` = number of nodes.

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

</div>

<div data-mode="lab">

## 1. Provision a Test Cluster

> **~10 min | Beginner**

> **What & Why:** You need a running Kubernetes cluster to deploy the Falcon sensor. Any standard cluster works — the Helm chart is cloud-agnostic. Pick whichever provider you have access to.

### Step 1: Create the cluster

- [ ] Choose one provider and run the commands below:

**GKE:**

```bash
export PROJECT_ID=$(gcloud config get-value project)
export CLUSTER_NAME="falcon-helm-lab"
export REGION="us-central1"

gcloud container clusters create $CLUSTER_NAME \
  --region $REGION \
  --num-nodes 2 \
  --machine-type e2-standard-2
```

**EKS:**

```bash
export CLUSTER_NAME="falcon-helm-lab"
export REGION="us-east-1"

eksctl create cluster \
  --name $CLUSTER_NAME \
  --region $REGION \
  --nodes 2 \
  --node-type t3.medium
```

**AKS:**

```bash
export CLUSTER_NAME="falcon-helm-lab"
export RESOURCE_GROUP="falcon-lab-rg"

az group create --name $RESOURCE_GROUP --location eastus
az aks create --resource-group $RESOURCE_GROUP --name $CLUSTER_NAME \
  --node-count 2 --node-vm-size Standard_B2s --generate-ssh-keys
az aks get-credentials --resource-group $RESOURCE_GROUP --name $CLUSTER_NAME
```

### Step 2: Verify connectivity

- [ ] Confirm kubectl can reach your cluster:

```bash
kubectl get nodes
```

You should see 2+ nodes in `Ready` state.

---

## 2. Configure API Credentials

> **~5 min | Beginner**

> **What & Why:** The Falcon container images live in CrowdStrike's private registry. You need API credentials to generate a pull token and discover the correct image paths for your CID.

### Step 1: Create an API client

- [ ] Navigate to **Falcon Console** > **Support and resources** > **API clients and keys** > **Create API client**
- [ ] Set the following OAuth 2.0 scopes:
  - Falcon Images Download: **Read**
  - Sensor Download: **Read**
  - Falcon Container Image: **Read/Write**
  - Falcon Container CLI: **Write**

<details>
<summary>CLI equivalent</summary>

There is no CLI for creating API clients — this must be done in the console.

</details>

### Step 2: Export credentials

- [ ] Set your credentials as environment variables:

```bash
export FALCON_CLIENT_ID="<YOUR_FALCON_CLIENT_ID>"
export FALCON_CLIENT_SECRET="<YOUR_FALCON_CLIENT_SECRET>"
```

---

## 3. Get Pull Token and Image Paths

> **~5 min | Beginner**

> **What & Why:** The pull token authenticates Kubernetes to CrowdStrike's container registry. The image paths tell Helm exactly which sensor, KAC, and IAR images to pull for your CID's assigned cloud region.

### Step 1: Generate pull token

- [ ] Run the CrowdStrike pull script with `--get-pull-token`:

```bash
export FALCON_PULL_TOKEN=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --get-pull-token)
```

### Step 2: Get image paths for all three components

- [ ] Get the sensor image path:

```bash
export SENSOR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --get-image-path)
```

- [ ] Get the KAC image path:

```bash
export KAC_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-kac \
  --get-image-path)
```

- [ ] Get the Image Analyzer image path:

```bash
export IAR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-imageanalyzer \
  --get-image-path)
```

> **Note:** `--get-image-path` returns the image location in CrowdStrike's registry, so Kubernetes pulls directly from CrowdStrike at runtime. To host the images in your own registry instead, swap `--get-image-path` for `--copy <your-registry>` (e.g. `--copy myregistry.com/mynamespace`) — this copies the sensor image from CrowdStrike into a customer-owned registry rather than pulling from CrowdStrike. Add `--copy-custom-tag <tag>` to override the version tag, then point the `*_REGISTRY` variables at your registry.

### Step 3: Parse and set all variables

- [ ] Split the image paths into registry and tag, and set remaining variables:

```bash
export FALCON_CID="<YOUR_CID_WITH_CHECKSUM>"
export CLUSTER_NAME="falcon-helm-lab"

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
echo "CID            : $([ -n "$FALCON_CID" ] && echo SET || echo MISSING) ($FALCON_CID)"
echo "Cluster        : $([ -n "$CLUSTER_NAME" ] && echo SET || echo MISSING) ($CLUSTER_NAME)"
echo "Client ID      : $([ -n "$FALCON_CLIENT_ID" ] && echo SET || echo MISSING) ($FALCON_CLIENT_ID)"
echo "Client Secret  : $([ -n "$FALCON_CLIENT_SECRET" ] && echo SET || echo MISSING) ($FALCON_CLIENT_SECRET)"
echo "Pull Token     : $([ -n "$FALCON_PULL_TOKEN" ] && echo SET || echo MISSING) ($FALCON_PULL_TOKEN)"
echo "Sensor         : $([ -n "$DAEMONSET_SENSOR_REGISTRY" ] && echo SET || echo MISSING) ($DAEMONSET_SENSOR_REGISTRY:$DAEMONSET_SENSOR_IMAGE_TAG)"
echo "KAC            : $([ -n "$KAC_REGISTRY" ] && echo SET || echo MISSING) ($KAC_REGISTRY:$KAC_IMAGE_TAG)"
echo "IAR            : $([ -n "$IAR_REGISTRY" ] && echo SET || echo MISSING) ($IAR_REGISTRY:$IAR_IMAGE_TAG)"
```

Every line should read `SET`, and each image path must show a full `registry.crowdstrike.com/...:<tag>` value. A line printing `MISSING` means that variable is empty — re-check the matching `--get-image-path` command, your API scopes, the values you exported, and the pull token from Step 1.

---

## 4. Add Helm Repository

> **~2 min | Beginner**

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

> **~5 min | Intermediate**

> **What & Why:** The `falcon-platform` umbrella chart installs all three components (sensor, KAC, IAR) in a single Helm release. Using `--set createComponentNamespaces=true` gives each component its own namespace for isolation.

### Step 1: Install the chart

- [ ] Run the Helm install with all component configurations:

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set falcon-sensor.falcon.tags="daemonset-sensor" \
  --set createComponentNamespaces=true \
  --set global.falcon.cid=$FALCON_CID \
  --set global.containerRegistry.configJSON=$FALCON_PULL_TOKEN \
  --set falcon-sensor.node.image.repository=$DAEMONSET_SENSOR_REGISTRY \
  --set falcon-sensor.node.image.tag=$DAEMONSET_SENSOR_IMAGE_TAG \
  --set falcon-kac.image.repository=$KAC_REGISTRY \
  --set falcon-kac.image.tag=$KAC_IMAGE_TAG \
  --set falcon-image-analyzer.deployment.enabled=true \
  --set falcon-image-analyzer.image.repository=$IAR_REGISTRY \
  --set falcon-image-analyzer.image.tag=$IAR_IMAGE_TAG \
  --set falcon-image-analyzer.crowdstrikeConfig.clusterName=$CLUSTER_NAME \
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=$FALCON_CLIENT_ID \
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET
```

> `falcon-sensor.falcon.tags="daemonset-sensor"` applies Falcon console grouping tags to the node sensor — change it to any comma-separated tags you want (e.g. `prod,team-a`).

> **GovCloud (us-gov-1 / us-gov-2):** When you generate the pull token and image paths with GovCloud API credentials, `--get-pull-token` / `--get-image-path` resolve to the GovCloud registry (`registry.laggar.gcw.crowdstrike.com` for gov-1, `registry.us-gov-2.crowdstrike.mil` for gov-2) automatically — the `*_REGISTRY` variables need no changes. Add one flag to the Helm install so Image Analyzer talks to the right region:
>
> ```
> --set falcon-image-analyzer.crowdstrikeConfig.agentRegion=gov1   # use gov2 for us-gov-2
> ```
>
> The sensor and KAC derive their region from the CID and registry, so they need no extra flag (optionally pin the sensor with `--set falcon-sensor.falcon.cloud=us-gov-1`).

### Step 2: Watch deployment progress

- [ ] Wait for all pods to reach Running state:

```bash
kubectl get pods -n falcon-system -w
kubectl get pods -n falcon-kac
kubectl get pods -n falcon-image-analyzer
```

---

## 6. Verify Deployment

> **~5 min | Beginner**

> **What & Why:** Verification confirms the sensor DaemonSet has a pod on every node, KAC's webhook is registered, and IAR is scanning. This ensures full protection is active before declaring the deployment complete.

### Step 1: Check DaemonSet coverage

- [ ] Verify the sensor DaemonSet matches node count:

```bash
kubectl get ds -n falcon-system
```

`DESIRED` should equal `CURRENT` and match your node count.

### Step 2: Check sensor connectivity

- [ ] Verify sensors are communicating with the CrowdStrike cloud:

```bash
kubectl logs -n falcon-system -l app.kubernetes.io/name=falcon-sensor --tail=20
```

Look for successful registration messages (no `ERROR` lines).

### Step 3: Verify KAC webhook

- [ ] Confirm the admission webhook is registered:

```bash
kubectl get validatingwebhookconfigurations | grep falcon
```

### Step 4: Test KAC enforcement

- [ ] Deploy a test pod and verify KAC intercepts it:

```bash
kubectl run test-pod --image=nginx --restart=Never
kubectl describe pod test-pod | grep -A5 "Events"
```

You should see the admission controller annotating the pod creation event.

- [ ] Clean up the test pod:

```bash
kubectl delete pod test-pod
```

### Step 5: Verify in Falcon console

- [ ] Navigate to **Falcon Console** > **Host management** > **Hosts**
- [ ] Filter by your cluster name — sensor hosts should appear within 5 minutes of deployment

---

## 7. Test a Detection (Optional)

> **~10 min | Beginner**

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

> **~5 min | Beginner**

> **What & Why:** Removes all Falcon components and the test cluster to avoid ongoing cloud costs.

### Step 1: Uninstall the Helm release

- [ ] Remove the Falcon platform:

```bash
helm uninstall falcon-platform -n falcon-platform
kubectl delete ns falcon-platform falcon-system falcon-kac falcon-image-analyzer
```

### Step 2: Delete the test cluster

- [ ] Remove the cluster (pick your provider):

**GKE:**

```bash
gcloud container clusters delete $CLUSTER_NAME --region $REGION --quiet
```

**EKS:**

```bash
eksctl delete cluster --name $CLUSTER_NAME --region $REGION
```

**AKS:**

```bash
az aks delete --resource-group $RESOURCE_GROUP --name $CLUSTER_NAME --yes
az group delete --name $RESOURCE_GROUP --yes
```

---

## Challenges

### Challenge 1: Values file deployment

Instead of passing `--set` flags inline, create a `values.yaml` file with all configuration and deploy using `helm upgrade --install -f values.yaml`. This is more maintainable for production use.

### Challenge 2: Selective component deployment

Deploy only the Falcon Sensor (no KAC, no IAR) by disabling the other sub-charts. Then add KAC separately. Hint: check the chart's `values.yaml` for enable/disable flags.

### Challenge 3: Node selector targeting

Configure the DaemonSet to only run on nodes with a specific label (e.g., `falcon-sensor=enabled`). Deploy to a subset of nodes, then expand coverage by labeling additional nodes.

---

## Quick Reference

| Variable                     | Value                                               | Where Used                                 |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------ |
| `FALCON_CLIENT_ID`           | Your API client ID                                  | Pull token, IAR config                     |
| `FALCON_CLIENT_SECRET`       | Your API client secret                              | Pull token, IAR config                     |
| `FALCON_CID`                 | CID with checksum (e.g., `ABCD1234-AB`)             | Helm `global.falcon.cid`                   |
| `FALCON_PULL_TOKEN`          | Base64 registry auth                                | Helm `global.containerRegistry.configJSON` |
| `CLUSTER_NAME`               | Your cluster name                                   | IAR cluster identification                 |
| `DAEMONSET_SENSOR_REGISTRY`  | `registry.crowdstrike.com/falcon-sensor/...`        | Helm sensor image repo                     |
| `DAEMONSET_SENSOR_IMAGE_TAG` | Sensor version tag                                  | Helm sensor image tag                      |
| `KAC_REGISTRY`               | `registry.crowdstrike.com/falcon-kac/...`           | Helm KAC image repo                        |
| `KAC_IMAGE_TAG`              | KAC version tag                                     | Helm KAC image tag                         |
| `IAR_REGISTRY`               | `registry.crowdstrike.com/falcon-imageanalyzer/...` | Helm IAR image repo                        |
| `IAR_IMAGE_TAG`              | IAR version tag                                     | Helm IAR image tag                         |

</div>

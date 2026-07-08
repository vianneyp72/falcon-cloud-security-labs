# Falcon Sidecar Injection on AKS Virtual Nodes — Serverless Container Protection

Deploy CrowdStrike Falcon on an AKS cluster that runs application pods on **Virtual Nodes** (Azure Container Instances / ACI via the Virtual Kubelet), using the sidecar injector for runtime protection, plus KAC for admission control and Image Analyzer for image scanning.

> **Performance note:** ACI cold-start dominates — a virtual-node pod typically takes tens of seconds (sometimes over a minute) to reach Ready, noticeably slower than a real node pool, and the injected sidecar adds a few seconds on top (init container + sensor launch). Runtime footprint is the same Container Sensor image used on EKS Fargate: roughly **30–35 MiB** memory and **<1 millicore** CPU per protected pod at idle; CPU scales with syscall/process-event volume.

> **Prerequisites:**
>
> - Azure subscription with the `az` CLI installed and logged in (`az login`)
> - `kubectl` and Helm 3 installed (`helm version` shows v3.x)
> - Docker, Podman, or Skopeo installed and running (to copy the images to ACR)
> - The `virtual-node` capability available in your region (ACI + Azure CNI)
> - CrowdStrike Falcon API credentials (Client ID + Secret)
>   - Required API scopes to pull the images (injector, KAC, IAR):
>     - **Falcon Images Download** (Read)
>     - **Sensor Download** (Read)
>   - Additional scopes IAR needs at runtime to upload image assessments:
>     - **Falcon Container Image** (Read/Write)
>     - **Falcon Container CLI** (Read/Write)
> - CrowdStrike CID (with checksum)

> **Windows:** These commands are written for bash. Run them from **WSL** or **Git Bash** — CrowdStrike's `falcon-container-sensor-pull` script is bash-only, and tools like `grep`/`cut`/`awk` aren't available in native PowerShell.

> **Image hosting:** This lab hosts all three Falcon images in **Azure Container Registry (ACR)**. Pods on the **system node pool** (injector, KAC, IAR) pull via the cluster's kubelet managed identity (`az aks update --attach-acr`). The injected sidecar runs on the **virtual node (ACI)**, which has **no node identity**, so it pulls using an **image pull secret** that the injector replicates into your application namespaces.

## Reference Docs

| Source                                                  | Link                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Get Started with Falcon Container Sensor for Linux      | https://docs.crowdstrike.com/r/en-US/iopiipqy/e58b97e0                          |
| Falcon Container Sensor for Linux Architecture          | https://docs.crowdstrike.com/r/en-US/iopiipqy/ff6d35ef                          |
| Deploy Falcon Container Sensor with a Helm chart        | https://docs.crowdstrike.com/r/en-US/qg0ygdwl/ebc28f99                          |
| Deploy Falcon Kubernetes Admission Controller with Helm | https://docs.crowdstrike.com/r/en-US/qg0ygdwl/d0a3095c                          |
| Deploy Image Assessment at Runtime with Helm            | https://docs.crowdstrike.com/r/en-US/qg0ygdwl/a0cf9976                          |
| Use virtual nodes with AKS                              | https://learn.microsoft.com/en-us/azure/aks/virtual-nodes                       |
| Create virtual nodes using the Azure CLI                | https://learn.microsoft.com/en-us/azure/aks/virtual-nodes-cli                   |
| Authenticate with ACR from AKS                          | https://learn.microsoft.com/en-us/azure/aks/cluster-container-registry-integration |
| falcon-sensor Helm chart (Injector)                     | https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-sensor  |

---

## Core Concepts

AKS **Virtual Nodes** use the open-source **Virtual Kubelet** to present **Azure Container Instances (ACI)** as a node named `virtual-node-aci-linux`. Pods scheduled there run as serverless ACI container groups — there is **no worker-node OS or kernel you control**, no privileged containers, and no DaemonSets. That rules out the kernel-mode **DaemonSet Sensor** (the `falcon-sensor` image) for those pods. Instead, virtual-node workloads are protected with the **Container Sensor** (the `falcon-container` image), which runs fully in **user space** and is injected into each application pod as a sidecar. This is the Azure analog of the EKS Fargate model.

This lab deploys three components, each as a standard non-privileged workload:

- **Sidecar Injector** (`falcon-sensor` chart, injector mode) — a Deployment fronted by a `MutatingWebhookConfiguration`. When a pod is created in an injectable namespace, the webhook patches the pod spec to add the Container Sensor as a sidecar. Namespace: `falcon-container-injector`.
- **Falcon KAC** (`falcon-kac` chart) — Kubernetes Admission Controller for cluster visibility and policy enforcement. A non-privileged Deployment. Namespace: `falcon-kac`.
- **Falcon Image Analyzer / IAR** (`falcon-image-analyzer` chart) — scans images for vulnerabilities. Must run in **Watcher mode** (`deployment.enabled=true`) — Socket/DaemonSet mode has no node to run on. Namespace: `falcon-image-analyzer`.

### The hybrid layout: infra on real nodes, apps on the virtual node

An AKS cluster with virtual nodes always keeps at least one **system node pool** of real Linux VMs. Falcon's own components (injector, KAC, IAR) run there — the virtual node carries a taint (`virtual-kubelet.io/provider`) that repels any pod without a matching toleration, so the controllers stay on real nodes automatically. Only your **application pods**, when they explicitly target the virtual node, land on ACI and receive the injected sidecar.

| Concern                | Real system node pool           | Virtual Node (ACI)                                 |
| ---------------------- | ------------------------------- | -------------------------------------------------- |
| Runtime protection     | DaemonSet sensor (eBPF, kernel) | **Sidecar injection (user space)**                 |
| Privileged containers  | Allowed                         | **Not allowed**                                    |
| DaemonSets             | Scheduled per node              | **Not supported**                                  |
| Image Analyzer mode    | Socket (DaemonSet) or Watcher   | **Watcher (Deployment) only**                      |
| Image pull auth        | Kubelet managed identity (ACR)  | **Image pull secret (no node identity)**           |
| Pod scheduling         | Default                         | Requires **nodeSelector + tolerations**            |

### Image pulls: kubelet identity vs. pull secret

`az aks update --attach-acr` grants the cluster's **kubelet managed identity** the `AcrPull` role, which authenticates image pulls for pods on the **real system node pool** — that covers the injector, KAC, and IAR with no secret. But **ACI-backed pods do not use the kubelet identity**. When the injector patches a virtual-node pod to add the Container Sensor, that sidecar image must be pulled by ACI itself, which only knows how to use an `imagePullSecret` on the pod. So the injector is configured to **replicate an ACR pull secret into each application namespace** and reference it on every injected pod.

> **Ordering caveat:** the injector creates that pull secret only in namespaces that **exist when it is installed** (the namespaces you list in `container.image.pullSecrets.namespaces`). Create your application namespace **before** installing the injector, or re-run the Helm upgrade after creating it — otherwise ACI pods land in `ImagePullBackOff`.

### Scheduling a pod onto the virtual node

A pod only runs on ACI if it opts in with a nodeSelector and tolerates the virtual-node taint:

```yaml
nodeSelector:
  kubernetes.io/os: linux
  type: virtual-kubelet
tolerations:
  - key: virtual-kubelet.io/provider
    operator: Exists
  - key: azure.com/aci
    effect: NoSchedule
```

> **Support note:** CrowdStrike names Microsoft ACI as a Container Sensor use case, but AKS Virtual Nodes/ACI is **not** in the formally tested-environments table (unlike EKS Fargate). Treat it as supported-in-principle: validate thoroughly and engage your CrowdStrike account team before production.

```
AKS VIRTUAL NODES CLUSTER
System Node Pool (real VMs): Falcon-Injector, KAC, IAR — pull via kubelet identity
Virtual Kubelet (ACI): app pod + falcon-container sidecar (injected)
Falcon-Injector-Pod: mutating webhook patches each virtual-node pod
Azure Container Registry (ACR): hosts falcon-container, falcon-kac, falcon-imageanalyzer
ACI image pull: imagePullSecret replicated into app namespaces
CrowdStrike Cloud: sidecar telemetry over TLS 443
```

---

## Deployment Steps

<div data-mode="guide">

### 1. Set credentials and context

Set your API credentials, CID, existing cluster/RG, and your ACR name, then derive the login server:

```bash
export FALCON_CID=<YOUR_FALCON_CID>
export FALCON_CLIENT_ID=<YOUR_CLIENT_ID>
export FALCON_CLIENT_SECRET=<YOUR_CLIENT_SECRET>
export RESOURCE_GROUP=<YOUR_RESOURCE_GROUP>
export CLUSTER_NAME=<YOUR_CLUSTER_NAME>
export ACR_NAME=<YOUR_ACR_NAME>
export ACR_LOGIN_SERVER=$(az acr show --name $ACR_NAME --query loginServer --output tsv)
export APP_NAMESPACE=detection-vulnapp
```

Get cluster credentials and attach the ACR so system-node-pool pods can pull without a secret:

```bash
az aks get-credentials --resource-group $RESOURCE_GROUP --name $CLUSTER_NAME
az aks update --resource-group $RESOURCE_GROUP --name $CLUSTER_NAME --attach-acr $ACR_NAME
```

> Your cluster must already have Virtual Nodes enabled (Azure CNI + an ACI-delegated subnet). Confirm the node exists: `kubectl get nodes` should list a `virtual-node-aci-linux` node.

### 2. Stage the Falcon images in ACR

Log Docker in to your registry (the pull script does not log in to the destination):

```bash
az acr login --name $ACR_NAME
```

Copy each image from the CrowdStrike registry into ACR (`--copy` pushes to `$ACR_LOGIN_SERVER/<image-name>:<tag>`):

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-container --copy $ACR_LOGIN_SERVER
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-kac --copy $ACR_LOGIN_SERVER
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-imageanalyzer --copy $ACR_LOGIN_SERVER
```

Read each tag straight back from ACR and validate everything the Helm installs need was populated:

```bash
export CONTAINER_TAG=$(az acr repository show-tags --name $ACR_NAME --repository falcon-container --orderby time_desc --top 1 --output tsv)
export KAC_TAG=$(az acr repository show-tags --name $ACR_NAME --repository falcon-kac --orderby time_desc --top 1 --output tsv)
export IAR_TAG=$(az acr repository show-tags --name $ACR_NAME --repository falcon-imageanalyzer --orderby time_desc --top 1 --output tsv)

echo "CID              : $([ -n "$FALCON_CID" ] && echo SET || echo MISSING) ($FALCON_CID)"
echo "Cluster          : $([ -n "$CLUSTER_NAME" ] && echo SET || echo MISSING) ($CLUSTER_NAME)"
echo "ACR              : $([ -n "$ACR_LOGIN_SERVER" ] && echo SET || echo MISSING) ($ACR_LOGIN_SERVER)"
echo "Container Sensor : $([ -n "$CONTAINER_TAG" ] && echo SET || echo MISSING) ($ACR_LOGIN_SERVER/falcon-container:$CONTAINER_TAG)"
echo "KAC              : $([ -n "$KAC_TAG" ] && echo SET || echo MISSING) ($ACR_LOGIN_SERVER/falcon-kac:$KAC_TAG)"
echo "IAR              : $([ -n "$IAR_TAG" ] && echo SET || echo MISSING) ($ACR_LOGIN_SERVER/falcon-imageanalyzer:$IAR_TAG)"
```

> `falcon-container` is the **Container Sensor** (the user-space sidecar), not `falcon-sensor` — the DaemonSet Sensor (kernel-mode image) that can't run on the virtual node.

### 3. Deploy the Falcon components

Create the application namespace **first** so the injector can replicate the ACR pull secret into it:

```bash
kubectl create namespace $APP_NAMESPACE
```

Create a repository-scoped ACR pull token and build a docker config the injector will hand to ACI pods:

```bash
export TOKEN_PASS=$(az acr token create --name falcon-pull --registry $ACR_NAME \
  --repository falcon-container content/read --query 'credentials.passwords[0].value' --output tsv)
export REGISTRY_CONFIG_JSON=$(kubectl create secret docker-registry falcon-acr-pull \
  --docker-server=$ACR_LOGIN_SERVER --docker-username=falcon-pull --docker-password="$TOKEN_PASS" \
  --dry-run=client -o jsonpath='{.data.\.dockerconfigjson}')
```

Add the CrowdStrike chart repo:

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update
```

Install the injector, replicating the ACR pull secret into the app namespace so injected ACI pods can pull the sidecar:

```bash
helm upgrade --install falcon-container-injector crowdstrike/falcon-sensor \
  --namespace falcon-container-injector \
  --create-namespace \
  --set falcon.tags="aks-virtual-nodes" \
  --set falcon.cid=$FALCON_CID \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=$ACR_LOGIN_SERVER/falcon-container \
  --set container.image.tag=$CONTAINER_TAG \
  --set container.image.pullSecrets.enable=true \
  --set container.image.pullSecrets.namespaces=$APP_NAMESPACE \
  --set container.image.pullSecrets.registryConfigJSON=$REGISTRY_CONFIG_JSON
```

Install KAC (cluster visibility + admission control):

```bash
helm upgrade --install falcon-kac crowdstrike/falcon-kac \
  --namespace falcon-kac --create-namespace \
  --set falcon.cid=$FALCON_CID \
  --set clusterName=$CLUSTER_NAME \
  --set image.repository=$ACR_LOGIN_SERVER/falcon-kac \
  --set image.tag=$KAC_TAG
```

Install Image Analyzer in Watcher mode (image vulnerability scanning):

```bash
helm upgrade --install falcon-image-analyzer crowdstrike/falcon-image-analyzer \
  --namespace falcon-image-analyzer --create-namespace \
  --set deployment.enabled=true \
  --set image.repository=$ACR_LOGIN_SERVER/falcon-imageanalyzer \
  --set image.tag=$IAR_TAG \
  --set crowdstrikeConfig.cid=$FALCON_CID \
  --set crowdstrikeConfig.clusterName=$CLUSTER_NAME \
  --set crowdstrikeConfig.clientID=$FALCON_CLIENT_ID \
  --set crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET \
  --set crowdstrikeConfig.agentRegion=us-1
```

> `node.enabled=false` disables the DaemonSet sensor (no kernel on ACI). `container.enabled=true` turns on injector mode, and `container.image.pullSecrets.*` replicates the ACR secret into `$APP_NAMESPACE` for injected pods. `deployment.enabled=true` selects IAR **Watcher mode** — the only mode that works without nodes. `crowdstrikeConfig.cid` is required (the chart's schema rejects a null CID). Set `agentRegion` to your cloud (`us-1`, `us-2`, `eu-1`, `gov1`, `gov2`).

### 4. Schedule a workload onto the virtual node and verify injection

Deploy the CrowdStrike vulnapp, then pin it to the virtual node so it runs on ACI and gets the sidecar:

```bash
kubectl apply -n $APP_NAMESPACE -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

```bash
export DEPLOY=$(kubectl -n $APP_NAMESPACE get deploy -o jsonpath='{.items[0].metadata.name}')
kubectl -n $APP_NAMESPACE patch deploy $DEPLOY --type merge -p '{"spec":{"template":{"spec":{"nodeSelector":{"kubernetes.io/os":"linux","type":"virtual-kubelet"},"tolerations":[{"key":"virtual-kubelet.io/provider","operator":"Exists"},{"key":"azure.com/aci","effect":"NoSchedule"}]}}}}'
```

Confirm the pod landed on the virtual node **and** the Falcon sidecar was injected (give ACI a minute to cold-start):

```bash
kubectl get pod -n $APP_NAMESPACE -o wide
kubectl get pod -l run=vulnerable.example.com -n $APP_NAMESPACE -o jsonpath='{.items[0].spec.containers[*].name}'
# NODE should be virtual-node-aci-linux; containers should show: crowdstrike-falcon-container vulnapp
```

### 5. Trigger a detection and verify in the console

Port-forward and trigger a simulated attack:

```bash
kubectl port-forward -n $APP_NAMESPACE svc/vulnerable-example-com 8060:80
```

Open [http://localhost:8060](http://localhost:8060), click any attack simulation, then check **Falcon Console** > **Next-Gen SIEM** > **Monitor and investigate** > **Detections** (filter **Source product** = **Cloud**). Stop the port-forward (Ctrl+C) when done.

When you're finished, remove the vulnapp:

```bash
kubectl delete -n $APP_NAMESPACE -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

</div>

<div data-mode="lab">

## 1. Provision an AKS Cluster with Virtual Nodes

> **What & Why:** Virtual Nodes require **Azure CNI** networking and a dedicated subnet **delegated to ACI** — you can't add them to a kubenet cluster after the fact. We provision a small system node pool (for CoreDNS, the Falcon controllers, and anything not pinned to ACI) plus the ACI-delegated subnet, then enable the `virtual-node` addon so the `virtual-node-aci-linux` node appears.

### Step 1: Create the resource group and network

> **What & Why:** The AKS nodes and the ACI subnet live in the same VNet. The ACI subnet must carry a delegation to `Microsoft.ContainerInstance/containerGroups`, which is what lets ACI place container groups into your network as virtual-node pods.

- [ ] Create the resource group, VNet, and both subnets:

```bash
export RESOURCE_GROUP=falcon-aks-vn-lab
export LOCATION=eastus
export CLUSTER_NAME=falcon-aks-vn

az group create --name $RESOURCE_GROUP --location $LOCATION

az network vnet create --resource-group $RESOURCE_GROUP --name aks-vnet \
  --address-prefixes 10.0.0.0/8 \
  --subnet-name aks-subnet --subnet-prefix 10.240.0.0/16

az network vnet subnet create --resource-group $RESOURCE_GROUP --vnet-name aks-vnet \
  --name aci-subnet --address-prefixes 10.241.0.0/16 \
  --delegations Microsoft.ContainerInstance/containerGroups
```

### Step 2: Create the cluster with the virtual-node addon

> **What & Why:** `--network-plugin azure` places pods directly in the VNet (required for virtual nodes). `--enable-addons virtual-node --aci-subnet-name aci-subnet` wires the Virtual Kubelet to the delegated subnet. The addon creates the `virtual-node-aci-linux` node once the cluster is up.

- [ ] Create the cluster on the AKS subnet:

```bash
export AKS_SUBNET_ID=$(az network vnet subnet show --resource-group $RESOURCE_GROUP \
  --vnet-name aks-vnet --name aks-subnet --query id --output tsv)

az aks create --resource-group $RESOURCE_GROUP --name $CLUSTER_NAME \
  --node-count 2 \
  --network-plugin azure \
  --vnet-subnet-id $AKS_SUBNET_ID \
  --enable-addons virtual-node \
  --aci-subnet-name aci-subnet \
  --generate-ssh-keys
```

> **Terraform alternative:** The `tf-k8s-aks-virtual-nodes-lab` project provisions this same cluster (VNet, ACI-delegated subnet, `aci_connector_linux`), the ACR, and the `AcrPull` role assignment. If you applied it, skip the `az` provisioning steps and run `az aks get-credentials --resource-group $RESOURCE_GROUP --name $CLUSTER_NAME`, then continue from Section 2.

### Step 3: Get credentials and verify the virtual node

- [ ] Merge the cluster into your kubeconfig:

```bash
az aks get-credentials --resource-group $RESOURCE_GROUP --name $CLUSTER_NAME
```

- [ ] Confirm both the real node pool and the virtual node are present:

```bash
kubectl get nodes
```

You should see one or more `aks-...` nodes (the system node pool) **and** a `virtual-node-aci-linux` node. The virtual node shows as `Ready` but runs no pods until one targets it.

---

## 2. Stage Images in ACR and Wire Up Pull Access

> **What & Why:** Two different identities pull these images. Pods on the **system node pool** (injector, KAC, IAR) authenticate with the cluster's **kubelet managed identity** once you attach the ACR. Pods on the **virtual node** (the injected sidecar) run on ACI, which has no such identity, so they need an **image pull secret**. We host all three images in ACR and set up both paths.

### Step 1: Create the ACR and set context

> **What & Why:** The ACR name must be globally unique (it becomes `<name>.azurecr.io`). `--attach-acr` grants the kubelet identity the `AcrPull` role so system-node-pool pods pull with no secret.

- [ ] Create the registry, attach it, and export context:

```bash
export ACR_NAME=falconaksvnlab$RANDOM
export APP_NAMESPACE=detection-vulnapp

az acr create --resource-group $RESOURCE_GROUP --name $ACR_NAME --sku Standard
az aks update --resource-group $RESOURCE_GROUP --name $CLUSTER_NAME --attach-acr $ACR_NAME

export ACR_LOGIN_SERVER=$(az acr show --name $ACR_NAME --query loginServer --output tsv)
```

- [ ] Export your Falcon API credentials and CID:

```bash
export FALCON_CID=<YOUR_FALCON_CID>
export FALCON_CLIENT_ID=<YOUR_CLIENT_ID>
export FALCON_CLIENT_SECRET=<YOUR_CLIENT_SECRET>
```

### Step 2: Log Docker in to ACR

> **What & Why:** The pull script logs in to the **CrowdStrike** registry to read the images, but not to your **destination** registry. Authenticate Docker to ACR yourself before `--copy` can push.

- [ ] Authenticate to your registry:

```bash
az acr login --name $ACR_NAME
```

### Step 3: Copy the images into ACR

- [ ] Copy each image from the CrowdStrike registry to ACR (`--copy` pushes to `$ACR_LOGIN_SERVER/<image-name>:<tag>`):

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-container --copy $ACR_LOGIN_SERVER
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-kac --copy $ACR_LOGIN_SERVER
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-imageanalyzer --copy $ACR_LOGIN_SERVER
```

### Step 4: Read the image tags from ACR

> **What & Why:** The sidecar sensor is the `falcon-container` image — the user-space **Container Sensor**, distinct from `falcon-sensor` (the **DaemonSet Sensor**, a kernel-mode image which cannot run on ACI). Because `--copy` preserved each image's original tag, read it straight back from ACR rather than invoking the pull script a second time.

- [ ] Capture each tag from ACR and validate everything populated:

```bash
export CONTAINER_TAG=$(az acr repository show-tags --name $ACR_NAME --repository falcon-container --orderby time_desc --top 1 --output tsv)
export KAC_TAG=$(az acr repository show-tags --name $ACR_NAME --repository falcon-kac --orderby time_desc --top 1 --output tsv)
export IAR_TAG=$(az acr repository show-tags --name $ACR_NAME --repository falcon-imageanalyzer --orderby time_desc --top 1 --output tsv)

echo "CID              : $([ -n "$FALCON_CID" ] && echo SET || echo MISSING) ($FALCON_CID)"
echo "Cluster          : $([ -n "$CLUSTER_NAME" ] && echo SET || echo MISSING) ($CLUSTER_NAME)"
echo "ACR              : $([ -n "$ACR_LOGIN_SERVER" ] && echo SET || echo MISSING) ($ACR_LOGIN_SERVER)"
echo "Container Sensor : $([ -n "$CONTAINER_TAG" ] && echo SET || echo MISSING) ($ACR_LOGIN_SERVER/falcon-container:$CONTAINER_TAG)"
echo "KAC              : $([ -n "$KAC_TAG" ] && echo SET || echo MISSING) ($ACR_LOGIN_SERVER/falcon-kac:$KAC_TAG)"
echo "IAR              : $([ -n "$IAR_TAG" ] && echo SET || echo MISSING) ($ACR_LOGIN_SERVER/falcon-imageanalyzer:$IAR_TAG)"
```

### Step 5: Build the ACI pull secret

> **What & Why:** ACI can't use the kubelet identity, so the injected sidecar needs an `imagePullSecret`. We mint a **repository-scoped ACR token** (least privilege — read-only on `falcon-container`) and encode it as a docker config. In the next section we hand this to the injector, which replicates it into your application namespaces.

- [ ] Create the app namespace **before** the injector so the secret can be replicated into it:

```bash
kubectl create namespace $APP_NAMESPACE
```

- [ ] Create the scoped token and build the base64 docker config:

```bash
export TOKEN_PASS=$(az acr token create --name falcon-pull --registry $ACR_NAME \
  --repository falcon-container content/read --query 'credentials.passwords[0].value' --output tsv)
export REGISTRY_CONFIG_JSON=$(kubectl create secret docker-registry falcon-acr-pull \
  --docker-server=$ACR_LOGIN_SERVER --docker-username=falcon-pull --docker-password="$TOKEN_PASS" \
  --dry-run=client -o jsonpath='{.data.\.dockerconfigjson}')
```

> ⚠️ **In production:** rotate the token password on a schedule (`az acr token credential generate`) and scope the token to only the repositories your virtual-node workloads need. Avoid the ACR admin user.

---

## 3. Add the Helm Repository

> **What & Why:** CrowdStrike publishes a standalone chart per component. We deploy three separate charts (`falcon-sensor` in injector mode, `falcon-kac`, `falcon-image-analyzer`) rather than the `falcon-platform` umbrella, because the umbrella's node-sensor subchart assumes DaemonSet mode.

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

> **What & Why:** Virtual-node pods have no host to run a DaemonSet on, so runtime protection comes from a mutating admission webhook. When a pod is created in an injectable namespace, the webhook patches the pod spec to add the Container Sensor as a sidecar. The injector runs on the real system node pool (it can't tolerate the virtual-node taint), and we pass the ACR pull secret so injected ACI pods can pull the sidecar image.

### Step 1: Install the injector

- [ ] Install the `falcon-sensor` chart in injector mode, pointing at your ACR image and replicating the pull secret into the app namespace:

```bash
helm upgrade --install falcon-container-injector crowdstrike/falcon-sensor \
  --namespace falcon-container-injector \
  --create-namespace \
  --set falcon.tags="aks-virtual-nodes" \
  --set falcon.cid=$FALCON_CID \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=$ACR_LOGIN_SERVER/falcon-container \
  --set container.image.tag=$CONTAINER_TAG \
  --set container.image.pullSecrets.enable=true \
  --set container.image.pullSecrets.namespaces=$APP_NAMESPACE \
  --set container.image.pullSecrets.registryConfigJSON=$REGISTRY_CONFIG_JSON
```

> `node.enabled=false` disables the DaemonSet (no kernel on ACI). `container.enabled=true` activates injector mode. `container.image.pullSecrets.namespaces` is the comma-separated list of namespaces the injector seeds the ACR secret into — it only covers namespaces that exist **now**. To scope injection itself to specific namespaces, see Challenge 1.

### Step 2: Verify the injector and the replicated secret

- [ ] Confirm the injector pods are running on the system node pool:

```bash
kubectl get pods -n falcon-container-injector -o wide
```

The `NODE` column should show an `aks-...` node, never `virtual-node-aci-linux`.

- [ ] Confirm the mutating webhook is registered and the pull secret landed in the app namespace:

```bash
kubectl get mutatingwebhookconfigurations | grep falcon
kubectl get secret -n $APP_NAMESPACE
```

---

## 5. Deploy the Kubernetes Admission Controller (KAC)

> **What & Why:** KAC gives you cluster-wide Kubernetes visibility and admission-time policy enforcement. It's a single non-privileged Deployment (three containers, all `readOnlyRootFilesystem`, `runAsNonRoot`), so it runs on the system node pool and pulls from ACR via the kubelet identity — no pull secret needed.

### Step 1: Install KAC

- [ ] Deploy the `falcon-kac` chart from your ACR repo:

```bash
helm upgrade --install falcon-kac crowdstrike/falcon-kac \
  --namespace falcon-kac \
  --create-namespace \
  --set falcon.cid=$FALCON_CID \
  --set clusterName=$CLUSTER_NAME \
  --set image.repository=$ACR_LOGIN_SERVER/falcon-kac \
  --set image.tag=$KAC_TAG
```

> KAC's pod-validating webhook defaults to `failurePolicy: Ignore`, the safer setting — an admission hiccup won't block pod scheduling. KAC also auto-excludes `kube-system`, `kube-public`, `falcon-system`, and its own namespace.

### Step 2: Verify KAC

- [ ] Confirm the KAC pod is running (one pod, three containers):

```bash
kubectl get pods -n falcon-kac -o wide
kubectl get pod -n falcon-kac -o jsonpath='{.items[0].spec.containers[*].name}'
# Expected: falcon-client falcon-watcher falcon-ac
```

---

## 6. Deploy Falcon Image Analyzer (IAR)

> **What & Why:** IAR scans images for vulnerabilities. It has two modes: Socket mode (a privileged DaemonSet that mounts the container runtime socket) and Watcher mode (a non-privileged Deployment that watches the K8s API and pulls images itself). **Only Watcher mode fits here** — there's no node socket to mount on ACI and no privileged containers allowed. IAR itself runs on the system node pool.

### Step 1: Install IAR in Watcher mode

- [ ] Deploy the `falcon-image-analyzer` chart with `deployment.enabled=true` from your ACR repo:

```bash
helm upgrade --install falcon-image-analyzer crowdstrike/falcon-image-analyzer \
  --namespace falcon-image-analyzer \
  --create-namespace \
  --set deployment.enabled=true \
  --set image.repository=$ACR_LOGIN_SERVER/falcon-imageanalyzer \
  --set image.tag=$IAR_TAG \
  --set crowdstrikeConfig.cid=$FALCON_CID \
  --set crowdstrikeConfig.clusterName=$CLUSTER_NAME \
  --set crowdstrikeConfig.clientID=$FALCON_CLIENT_ID \
  --set crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET \
  --set crowdstrikeConfig.agentRegion=us-1
```

> `deployment.enabled=true` selects Watcher mode. **Never** set `daemonset.enabled=true` here. `crowdstrikeConfig.*` supplies the **runtime** API credentials IAR uses to upload assessments (unrelated to image pulls); `crowdstrikeConfig.cid` is required — the chart's schema rejects a null CID. Set `agentRegion` to your cloud (`us-1`, `us-2`, `eu-1`, `gov1`, `gov2`).

### Step 2: Verify IAR

- [ ] Confirm the IAR pod is running as a Deployment (not a DaemonSet):

```bash
kubectl get deploy -n falcon-image-analyzer
kubectl get pods -n falcon-image-analyzer -o wide
```

---

## 7. Schedule a Workload onto the Virtual Node and Test a Detection

> **What & Why:** Verification means proving the injection path works end to end: a pod pinned to the virtual node should come up on ACI with the Falcon sidecar attached and generate real detections. The CrowdStrike vulnapp doubles as both the injection target and a safe attack simulator.

### Step 1: Deploy the vulnapp and pin it to the virtual node

> The stock vulnapp manifest has no nodeSelector, so it would land on the system node pool. We patch its Deployment to add the virtual-node nodeSelector and tolerations, forcing it onto ACI.

- [ ] Deploy the vulnapp into the app namespace (already created in Section 2):

```bash
kubectl apply -n $APP_NAMESPACE -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

- [ ] Patch it onto the virtual node:

```bash
export DEPLOY=$(kubectl -n $APP_NAMESPACE get deploy -o jsonpath='{.items[0].metadata.name}')
kubectl -n $APP_NAMESPACE patch deploy $DEPLOY --type merge -p '{"spec":{"template":{"spec":{"nodeSelector":{"kubernetes.io/os":"linux","type":"virtual-kubelet"},"tolerations":[{"key":"virtual-kubelet.io/provider","operator":"Exists"},{"key":"azure.com/aci","effect":"NoSchedule"}]}}}}'
```

- [ ] Give the pod a minute — ACI provisions a container group per pod, so the first start is slower than a real node.

### Step 2: Verify placement and sidecar injection

- [ ] Confirm the pod is on the virtual node and carries the Falcon sidecar:

```bash
kubectl get pod -n $APP_NAMESPACE -o wide
kubectl get pod -l run=vulnerable.example.com -n $APP_NAMESPACE -o jsonpath='{.items[0].spec.containers[*].name}'
# NODE: virtual-node-aci-linux ; containers: crowdstrike-falcon-container vulnapp
```

> **Look for:** the `NODE` column reading `virtual-node-aci-linux` **and** the `crowdstrike-falcon-container` name alongside your app container (`vulnapp`). If the sidecar is missing, the webhook didn't reach this namespace — re-check Section 4. If the pod is stuck in `Init:ImagePullBackOff`, the ACR pull secret wasn't replicated into `$APP_NAMESPACE` (confirm the namespace existed before the injector install — see the ordering caveat, or Challenge 3).

### Step 3: Verify in the Falcon console

- [ ] Navigate to **Falcon Console** > **Host management** > **Hosts**
- [ ] Filter by your cluster name — the virtual-node pod should appear as a host tagged `aks-virtual-nodes`

### Step 4: Test a detection (optional)

> **What & Why:** Injection proves coverage; a real detection proves the sidecar is actively monitoring. The vulnapp's web UI fires safe, simulated attacks.

- [ ] Port-forward to the vulnapp service (this blocks — leave it running):

```bash
kubectl port-forward -n $APP_NAMESPACE svc/vulnerable-example-com 8060:80
```

- [ ] Open [http://localhost:8060](http://localhost:8060) and click any attack simulation (e.g. **Access sensitive files**, **Kill process**, **Run a reverse shell**).
- [ ] In the console, go to **Next-Gen SIEM** > **Monitor and investigate** > **Detections**, filter **Source product** = **Cloud** — a detection tied to the virtual-node pod should appear within a few minutes. Stop the port-forward (Ctrl+C) when done.

### Step 5: Clean up the vulnapp

- [ ] Remove the vulnapp:

```bash
kubectl delete -n $APP_NAMESPACE -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

---

## 8. Connect Back to Terraform

> **What & Why:** You've built everything by hand — now make it repeatable. The `tf-k8s-aks-virtual-nodes-lab` project describes the resource group, VNet + ACI-delegated subnet, the AKS cluster with `aci_connector_linux` (virtual nodes), the ACR, and the `AcrPull` role assignment. Import your existing resources so Terraform can tear the lab down and rebuild it with one command.

### Step 1: Initialize Terraform

- [ ] From the project folder, run:

```bash
cd ~/projects/tf-k8s-aks-virtual-nodes-lab
terraform init
```

### Step 2: Import the resources you created

> **What & Why:** `terraform import` maps each resource in your `.tf` files to the real Azure object. Azure resource IDs use the full ARM path — grab them from `az ... show --query id -o tsv`.

- [ ] Import each resource (adjust IDs to your subscription):

```bash
export SUB=$(az account show --query id -o tsv)
terraform import azurerm_resource_group.lab \
  /subscriptions/$SUB/resourceGroups/$RESOURCE_GROUP
terraform import azurerm_container_registry.acr \
  /subscriptions/$SUB/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME
terraform import azurerm_kubernetes_cluster.aks \
  /subscriptions/$SUB/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerService/managedClusters/$CLUSTER_NAME
```

### Step 3: Validate with terraform plan

- [ ] Run:

```bash
terraform plan
```

> Look for: `No changes. Your infrastructure matches the configuration.` If Terraform wants to modify something, update the `.tf` files to match reality (subnet prefixes, node count, tags).

### Step 4: Test the lifecycle

- [ ] Tear down and rebuild from scratch:

```bash
terraform destroy
terraform apply
```

> After `apply`, re-run `az aks get-credentials` and repeat Sections 2–7. Next time, skip the manual `az` provisioning — just `terraform apply`.

---

## 9. Cleanup

> **What & Why:** Removes all Falcon components and the Azure resources to avoid ongoing cost.

### Step 1: Uninstall the Helm releases

- [ ] Remove all three releases:

```bash
helm uninstall falcon-container-injector -n falcon-container-injector
helm uninstall falcon-kac -n falcon-kac
helm uninstall falcon-image-analyzer -n falcon-image-analyzer
```

### Step 2: Delete the namespaces and the ACR token

- [ ] Clean up the Falcon and app namespaces and revoke the pull token:

```bash
kubectl delete namespace falcon-container-injector falcon-kac falcon-image-analyzer $APP_NAMESPACE
az acr token delete --name falcon-pull --registry $ACR_NAME --yes
```

### Step 3: Delete the cluster and registry

- [ ] Remove everything by deleting the resource group (or `terraform destroy` if you imported):

```bash
az group delete --name $RESOURCE_GROUP --yes --no-wait
```

---

## Challenges

### Challenge 1: Opt-in injection via namespace label

**Scenario:** Your platform team runs many namespaces and only wants Falcon injected into approved workload namespaces — not everything. Reconfigure the injector so injection is **opt-in** rather than all-namespaces.

<details>
<summary>💡 Hint</summary>

Look at `container.disableNSInjection` and the per-namespace label the injector honors. When injection is disabled by default, you enable it per namespace with a label.

</details>

<details>
<summary>✅ Solution</summary>

Redeploy the injector with namespace-scoped injection disabled by default (keep the pull-secret flags):

```bash
helm upgrade --install falcon-container-injector crowdstrike/falcon-sensor \
  --namespace falcon-container-injector \
  --reuse-values \
  --set container.disableNSInjection=true
```

Then opt a namespace in with the label:

```bash
kubectl label namespace $APP_NAMESPACE sensor.falcon-system.crowdstrike.com/injection=enabled
```

Only labeled namespaces now get the sidecar — a safe pattern that guarantees you never accidentally inject into an infra namespace.

</details>

### Challenge 2: Keep the Falcon controllers off the virtual node

**Scenario:** A teammate worries the injector or KAC could get scheduled onto ACI, where a controller has no business running. Explain why that won't happen by default, and how you'd hard-guarantee it.

<details>
<summary>💡 Hint</summary>

The virtual node carries a taint. Pods only land there if they **tolerate** it. What do the Falcon controller pods lack, and what could you add to be extra explicit?

</details>

<details>
<summary>✅ Solution</summary>

The `virtual-node-aci-linux` node is tainted `virtual-kubelet.io/provider=azure:NoSchedule` (and `azure.com/aci`). The injector, KAC, and IAR pods don't set those tolerations, so the scheduler never places them on ACI — they stay on the real system node pool automatically.

To make it explicit (belt-and-suspenders), pin the controllers to the real pool with a nodeSelector, e.g. for the injector:

```bash
helm upgrade --install falcon-container-injector crowdstrike/falcon-sensor \
  --namespace falcon-container-injector --reuse-values \
  --set-json 'container.nodeAffinity={"requiredDuringSchedulingIgnoredDuringExecution":{"nodeSelectorTerms":[{"matchExpressions":[{"key":"type","operator":"NotIn","values":["virtual-kubelet"]}]}]}}'
```

This is the mirror image of what the application pod does: apps **add** the toleration to opt in, controllers **omit** it to stay out.

</details>

### Challenge 3: Fix an ACI pod stuck in ImagePullBackOff after adding a new namespace

**Scenario:** You added a new application namespace `team-b` *after* the injector was installed. Its virtual-node pods are stuck in `Init:ImagePullBackOff`, even though `detection-vulnapp` works fine. Diagnose and fix it.

<details>
<summary>💡 Hint</summary>

The injector replicates the ACR pull secret only into the namespaces listed in `container.image.pullSecrets.namespaces` **at install time**. What's missing in `team-b`?

</details>

<details>
<summary>✅ Solution</summary>

The ACR pull secret was never created in `team-b`, so ACI can't authenticate the `falcon-container` pull. Re-run the injector upgrade with the new namespace added to the list (the namespace must already exist):

```bash
kubectl create namespace team-b
helm upgrade --install falcon-container-injector crowdstrike/falcon-sensor \
  --namespace falcon-container-injector --reuse-values \
  --set container.image.pullSecrets.namespaces="$APP_NAMESPACE\,team-b"
```

Then restart the stuck pods (`kubectl rollout restart deploy -n team-b <name>`). Alternatively, set `container.image.pullSecrets.allNamespaces=true` so the secret is seeded everywhere — but scoping to named namespaces is tighter. Either way, the rule is the same: the secret must exist in a namespace **before** an injected ACI pod tries to pull.

</details>

---

## Azure Government

Only two changes are required to run this lab in Azure Government against a Falcon GovCloud tenant — nothing else differs:

- [ ] Point the CLI at the Gov cloud **before** `az login`:

```bash
az cloud set --name AzureUSGovernment
```

- [ ] Pin IAR's region to your Falcon GovCloud region (it defaults to autodiscovery, which won't resolve for Gov). Add to the Section 6 install:

```bash
  --set crowdstrikeConfig.agentRegion=gov1   # or gov2
```

Use Gov API credentials with the pull script; it resolves the Gov source registry automatically. The injector and sidecar derive their region from the CID, so no extra flag is needed there.

---

## Quick Reference

| Action                       | Command / Value                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Sidecar image type           | `--type falcon-container` (NOT `falcon-sensor`)                                                                 |
| ACR repo names               | `falcon-container`, `falcon-kac`, `falcon-imageanalyzer` (from `--copy`)                                        |
| Copy image to ACR            | `... --type <t> --copy $ACR_LOGIN_SERVER`                                                                       |
| Docker login to ACR          | `az acr login --name $ACR_NAME`                                                                                 |
| System-pool image pull auth  | Kubelet managed identity via `az aks update --attach-acr`                                                       |
| Virtual-node (ACI) pull auth | `imagePullSecret` replicated by the injector (`container.image.pullSecrets.*`)                                 |
| Disable DaemonSet            | `--set node.enabled=false`                                                                                      |
| Enable injector              | `--set container.enabled=true`                                                                                  |
| Seed ACI pull secret         | `--set container.image.pullSecrets.{enable=true,namespaces=<ns>,registryConfigJSON=<b64>}`                     |
| Opt-in injection             | `--set container.disableNSInjection=true` + namespace label                                                     |
| IAR mode                     | `--set deployment.enabled=true` (Watcher, never DaemonSet)                                                      |
| Injected container name      | `crowdstrike-falcon-container`                                                                                  |
| Schedule pod to virtual node | nodeSelector `type=virtual-kubelet` + tolerations `virtual-kubelet.io/provider`, `azure.com/aci`               |
| Virtual node name            | `virtual-node-aci-linux`                                                                                        |
| Azure Government             | `az cloud set --name AzureUSGovernment`; IAR `--set crowdstrikeConfig.agentRegion=gov1`                         |

</div>

---
*Created: 2026-07-07 | Topics: cloud-security, kubernetes, aks, virtual-nodes, aci, sidecar, helm, acr*

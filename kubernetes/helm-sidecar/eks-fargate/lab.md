# Falcon Sidecar Injection on EKS Fargate — Serverless Kubernetes Protection

Deploy CrowdStrike Falcon on an EKS **Fargate-only** cluster (no EC2 nodes) using the sidecar injector for runtime protection, plus KAC for admission control and Image Analyzer for image scanning.

> **Performance note:** Fargate provisions a dedicated micro-VM per pod, so first-pod scheduling is slower than EC2 (expect ~1 min). The injected sidecar adds to each pod's total CPU/memory request, which can push the pod up to the next Fargate size — size `container.sensorResources` deliberately.

> **Prerequisites:**
>
> - AWS account with `eksctl`, `aws` CLI, and `kubectl` installed and configured
> - Helm 3 installed (`helm version` shows v3.x)
> - CrowdStrike Falcon API credentials (Client ID + Secret)
>   - Required API scopes:
>     - **Falcon Images Download** (Read)
>     - **Sensor Download** (Read)
> - CrowdStrike CID (with checksum)
> - ~25 minutes (Quick Deploy) / ~70 minutes (Full Lab)

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
| Image pull auth | Node instance profile / secret | **Pod execution role** or `imagePullSecret` |
| Scheduling a namespace | Any node | Requires a **Fargate profile** |

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
Image Registry (CrowdStrike or ECR): sensor, KAC and IAR images
CrowdStrike Cloud: sidecar telemetry over TLS 443
```

---

## Deployment Steps

<div data-mode="guide">

### 1. Set credentials and pull token

Set your API credentials, CID, and cluster name, then mint the registry pull token:

```bash
export FALCON_CID=<YOUR_FALCON_CID>
export FALCON_CLIENT_ID=<YOUR_CLIENT_ID>
export FALCON_CLIENT_SECRET=<YOUR_CLIENT_SECRET>
export CLUSTER_NAME=falcon-fargate-lab

export FALCON_PULL_TOKEN=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --get-pull-token)
```

### 2. Get image paths

Pull image paths for all three components. Note: `falcon-container` is the **sidecar** sensor (not `falcon-sensor`, which is the kernel/DaemonSet sensor that can't run on Fargate).

```bash
export CONTAINER_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-container --get-image-path)
export KAC_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-kac --get-image-path)
export IAR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-imageanalyzer --get-image-path)

export CONTAINER_REGISTRY=$(echo $CONTAINER_IMAGE_PATH | cut -d: -f1)
export CONTAINER_IMAGE_TAG=$(echo $CONTAINER_IMAGE_PATH | cut -d: -f2)
export KAC_REGISTRY=$(echo $KAC_IMAGE_PATH | cut -d: -f1)
export KAC_IMAGE_TAG=$(echo $KAC_IMAGE_PATH | cut -d: -f2)
export IAR_REGISTRY=$(echo $IAR_IMAGE_PATH | cut -d: -f1)
export IAR_IMAGE_TAG=$(echo $IAR_IMAGE_PATH | cut -d: -f2)
```

### 3. Add Helm repo and deploy the sidecar injector

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update

helm upgrade --install falcon-lumos-injector crowdstrike/falcon-sensor \
  --namespace falcon-lumos-injector \
  --create-namespace \
  --set falcon.tags="eks-fargate" \
  --set falcon.cid=$FALCON_CID \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=$CONTAINER_REGISTRY \
  --set container.image.tag=$CONTAINER_IMAGE_TAG \
  --set container.image.pullSecrets.enable=true \
  --set container.image.pullSecrets.registryConfigJSON=$FALCON_PULL_TOKEN \
  --set container.image.pullSecrets.allNamespaces=true
```

> `node.enabled=false` disables the DaemonSet sensor (no kernel access on Fargate). `container.enabled=true` turns on injector mode. `allNamespaces=true` seeds the pull secret into every namespace so any Fargate pod gets injected without tracking names.

### 4. Deploy KAC and Image Analyzer

```bash
helm upgrade --install falcon-kac crowdstrike/falcon-kac \
  --namespace falcon-kac --create-namespace \
  --set falcon.cid=$FALCON_CID \
  --set clusterName=$CLUSTER_NAME \
  --set image.repository=$KAC_REGISTRY \
  --set image.tag=$KAC_IMAGE_TAG \
  --set image.registryConfigJSON=$FALCON_PULL_TOKEN

helm upgrade --install falcon-image-analyzer crowdstrike/falcon-image-analyzer \
  --namespace falcon-image-analyzer --create-namespace \
  --set deployment.enabled=true \
  --set image.repository=$IAR_REGISTRY \
  --set image.tag=$IAR_IMAGE_TAG \
  --set image.registryConfigJSON=$FALCON_PULL_TOKEN \
  --set crowdstrikeConfig.clusterName=$CLUSTER_NAME \
  --set crowdstrikeConfig.clientID=$FALCON_CLIENT_ID \
  --set crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET \
  --set crowdstrikeConfig.agentRegion=us-1
```

> `deployment.enabled=true` selects IAR **Watcher mode** — the only mode that works on Fargate. Set `agentRegion` to your cloud (`us-1`, `us-2`, `eu-1`, `gov1`, `gov2`).

### 5. Verify injection and trigger a detection

Deploy the CrowdStrike vulnapp into a Fargate-profiled namespace and confirm the sidecar was injected:

```bash
kubectl apply -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
kubectl get pod -l run=vulnerable.example.com -n detection-vulnapp -o jsonpath='{.items[0].spec.containers[*].name}'
# Should show: vulnerable.example.com crowdstrike-falcon-container
```

Port-forward and trigger a simulated attack, then check the console:

```bash
kubectl port-forward -n detection-vulnapp svc/vulnerable-example-com 8060:80
```

Open [http://localhost:8060](http://localhost:8060), click any attack simulation, then check **Falcon Console** > **Next-Gen SIEM** > **Monitor and investigate** > **Detections** (filter **Source product** = **Cloud**). Stop the port-forward (Ctrl+C) when done.

</div>

<div data-mode="lab">

## 1. Provision an EKS Fargate-Only Cluster

> **~15 min | Intermediate**

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

> **What & Why:** With no managed node groups defined, eksctl automatically reconfigures the CoreDNS deployment to run on Fargate (it removes the EC2 compute-type annotation). This takes ~15 minutes.

- [ ] Deploy the cluster:

```bash
eksctl create cluster -f eksctl-fargate.yaml
```

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

## 2. Configure Credentials and Images

> **~5 min | Beginner**

> **What & Why:** The sidecar and supporting components all pull from a private registry. By default this lab pulls directly from CrowdStrike's registry using a pull token; IAR additionally needs API credentials for vulnerability reporting.

### Step 1: Set API credentials

- [ ] Export your Falcon API credentials, CID, and cluster name:

```bash
export FALCON_CID=<YOUR_FALCON_CID>
export FALCON_CLIENT_ID=<YOUR_CLIENT_ID>
export FALCON_CLIENT_SECRET=<YOUR_CLIENT_SECRET>
export CLUSTER_NAME=falcon-fargate-lab
```

### Step 2: Generate the registry pull token

- [ ] Mint a base64 docker config used as the pull secret for all three charts:

```bash
export FALCON_PULL_TOKEN=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --get-pull-token)
```

### Step 3: Get image paths

> **What & Why:** The sidecar sensor is the `falcon-container` image type — this is the user-space Container Sensor, distinct from `falcon-sensor` (the kernel/DaemonSet image, which cannot run on Fargate).

- [ ] Pull the image paths for all three components:

```bash
export CONTAINER_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-container --get-image-path)
export KAC_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-kac --get-image-path)
export IAR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-imageanalyzer --get-image-path)
```

- [ ] Parse each into registry + tag:

```bash
export CONTAINER_REGISTRY=$(echo $CONTAINER_IMAGE_PATH | cut -d: -f1)
export CONTAINER_IMAGE_TAG=$(echo $CONTAINER_IMAGE_PATH | cut -d: -f2)
export KAC_REGISTRY=$(echo $KAC_IMAGE_PATH | cut -d: -f1)
export KAC_IMAGE_TAG=$(echo $KAC_IMAGE_PATH | cut -d: -f2)
export IAR_REGISTRY=$(echo $IAR_IMAGE_PATH | cut -d: -f1)
export IAR_IMAGE_TAG=$(echo $IAR_IMAGE_PATH | cut -d: -f2)
```

- [ ] Validate everything populated:

```bash
echo "CID          : $([ -n "$FALCON_CID" ] && echo SET || echo MISSING)"
echo "Cluster      : $([ -n "$CLUSTER_NAME" ] && echo SET || echo MISSING) ($CLUSTER_NAME)"
echo "Pull Token   : $([ -n "$FALCON_PULL_TOKEN" ] && echo SET || echo MISSING)"
echo "Container    : $([ -n "$CONTAINER_REGISTRY" ] && echo SET || echo MISSING) ($CONTAINER_REGISTRY:$CONTAINER_IMAGE_TAG)"
echo "KAC          : $([ -n "$KAC_REGISTRY" ] && echo SET || echo MISSING) ($KAC_REGISTRY:$KAC_IMAGE_TAG)"
echo "IAR          : $([ -n "$IAR_REGISTRY" ] && echo SET || echo MISSING) ($IAR_REGISTRY:$IAR_IMAGE_TAG)"
```

Every line should read `SET`. A `MISSING` means that command didn't populate — re-check the matching command and your API scopes.

> **Note:** To host images in your own ECR instead of pulling from CrowdStrike, swap `--get-image-path` for `--copy <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com` on each `--type`, point the `*_REGISTRY` / `*_IMAGE_TAG` vars at the ECR paths, and follow the ECR option in Section 4 (Fargate authenticates ECR pulls via the pod execution role — no pull secret needed).

---

## 3. Add the Helm Repository

> **~2 min | Beginner**

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

> **~5 min | Intermediate**

> **What & Why:** Fargate pods have no host to run a DaemonSet on, so runtime protection comes from a mutating admission webhook. When a pod is created in an injectable namespace, the webhook patches the pod spec to add the Falcon Container Sensor as a sidecar. By default the sidecar is pulled from CrowdStrike's registry and the pull token is propagated to app namespaces.

### Step 1: Deploy the injector

- [ ] Install the `falcon-sensor` chart in injector mode:

```bash
helm upgrade --install falcon-lumos-injector crowdstrike/falcon-sensor \
  --namespace falcon-lumos-injector \
  --create-namespace \
  --set falcon.tags="eks-fargate" \
  --set falcon.cid=$FALCON_CID \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=$CONTAINER_REGISTRY \
  --set container.image.tag=$CONTAINER_IMAGE_TAG \
  --set container.image.pullSecrets.enable=true \
  --set container.image.pullSecrets.registryConfigJSON=$FALCON_PULL_TOKEN \
  --set container.image.pullSecrets.allNamespaces=true
```

> `node.enabled=false` disables the DaemonSet (no kernel on Fargate). `container.enabled=true` activates injector mode. `container.image.pullSecrets.allNamespaces=true` creates the pull secret in every namespace (except system ones) so any Fargate-profiled workload gets injected without you tracking namespace names. To scope injection instead, see Challenge 1.

<details>
<summary>ECR option (host the sidecar in your own registry)</summary>

If you staged the sensor image in ECR (via `--type falcon-container --copy ...` in Section 2), you don't need a pull secret at all — on Fargate, image pulls are authenticated by the **Fargate pod execution role**, not by an `imagePullSecret`. Drop the `container.image.pullSecrets.*` flags and point the image at your ECR path:

```bash
helm upgrade --install falcon-lumos-injector crowdstrike/falcon-sensor \
  --namespace falcon-lumos-injector \
  --create-namespace \
  --set falcon.tags="eks-fargate" \
  --set falcon.cid=$FALCON_CID \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=$CONTAINER_REGISTRY \
  --set container.image.tag=$CONTAINER_IMAGE_TAG
```

Ensure the pod execution role for your Fargate profiles has ECR read — the default role `eksctl` creates includes `AmazonEKSFargatePodExecutionRolePolicy`, which grants ECR pulls for same-account repositories. Only for cross-account ECR do you need to attach `AmazonEC2ContainerRegistryReadOnly` explicitly.

> Note: IRSA (`serviceAccount` role annotations) does **not** authenticate image pulls on Fargate — that happens before the pod's service account token is available. Image-pull auth is always the pod execution role's job.

</details>

### Step 2: Verify the injector is running on Fargate

- [ ] Confirm the injector pods are running:

```bash
kubectl get pods -n falcon-lumos-injector -o wide
```

- [ ] Confirm the mutating webhook is registered:

```bash
kubectl get mutatingwebhookconfigurations | grep falcon
```

- [ ] Verify the pull secret was propagated to the test namespace:

```bash
kubectl create namespace detection-vulnapp 2>/dev/null; kubectl get secret -n detection-vulnapp | grep falcon
```

---

## 5. Deploy the Kubernetes Admission Controller (KAC)

> **~5 min | Intermediate**

> **What & Why:** KAC gives you cluster-wide Kubernetes visibility and admission-time policy enforcement. It's a single non-privileged Deployment (three containers, all `readOnlyRootFilesystem`, `runAsNonRoot`), so it's fully Fargate-compatible — its namespace just needs a Fargate profile (already created in Section 1).

### Step 1: Install KAC

- [ ] Deploy the `falcon-kac` chart:

```bash
helm upgrade --install falcon-kac crowdstrike/falcon-kac \
  --namespace falcon-kac \
  --create-namespace \
  --set falcon.cid=$FALCON_CID \
  --set clusterName=$CLUSTER_NAME \
  --set image.repository=$KAC_REGISTRY \
  --set image.tag=$KAC_IMAGE_TAG \
  --set image.registryConfigJSON=$FALCON_PULL_TOKEN
```

> KAC's pod-validating webhook defaults to `failurePolicy: Ignore`, which is the safer setting on Fargate — an admission hiccup won't block pod scheduling. KAC also auto-excludes `kube-system`, `kube-public`, `falcon-system`, and its own namespace.

### Step 2: Verify KAC

- [ ] Confirm the KAC pod is running (one pod, three containers):

```bash
kubectl get pods -n falcon-kac -o wide
kubectl get pod -n falcon-kac -o jsonpath='{.items[0].spec.containers[*].name}'
# Expected: falcon-client falcon-watcher falcon-ac
```

---

## 6. Deploy Falcon Image Analyzer (IAR)

> **~5 min | Intermediate**

> **What & Why:** IAR scans images for vulnerabilities. It has two modes: Socket mode (a privileged DaemonSet that mounts the container runtime socket) and Watcher mode (a non-privileged Deployment that watches the K8s API and pulls images itself). **Only Watcher mode works on Fargate** — there's no node socket to mount and no privileged containers allowed.

### Step 1: Install IAR in Watcher mode

- [ ] Deploy the `falcon-image-analyzer` chart with `deployment.enabled=true`:

```bash
helm upgrade --install falcon-image-analyzer crowdstrike/falcon-image-analyzer \
  --namespace falcon-image-analyzer \
  --create-namespace \
  --set deployment.enabled=true \
  --set image.repository=$IAR_REGISTRY \
  --set image.tag=$IAR_IMAGE_TAG \
  --set image.registryConfigJSON=$FALCON_PULL_TOKEN \
  --set crowdstrikeConfig.clusterName=$CLUSTER_NAME \
  --set crowdstrikeConfig.clientID=$FALCON_CLIENT_ID \
  --set crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET \
  --set crowdstrikeConfig.agentRegion=us-1
```

> `deployment.enabled=true` selects Watcher mode. **Never** set `daemonset.enabled=true` on Fargate. Set `agentRegion` to your cloud (`us-1`, `us-2`, `eu-1`, `gov1`, `gov2`).

> ⚠️ **Sizing caveat:** IAR mounts a `tmp-volume` emptyDir (default 20Gi) sized to ~2× the largest image it scans. On Fargate this consumes the pod's ephemeral storage, so a scan-heavy IAR pod may need a larger Fargate configuration. Watch for `Evicted` pods and raise the volume/ephemeral-storage request if needed.

### Step 2: Verify IAR

- [ ] Confirm the IAR pod is running as a Deployment (not a DaemonSet):

```bash
kubectl get deploy -n falcon-image-analyzer
kubectl get pods -n falcon-image-analyzer -o wide
```

---

## 7. Verify Fargate Coverage and Test a Detection

> **~10 min | Intermediate**

> **What & Why:** Verification means proving the injection path actually works end to end: a new pod in a Fargate-profiled namespace should come up with the Falcon sidecar attached and generate real detections. The CrowdStrike vulnapp doubles as both the injection target and a safe attack simulator.

### Step 1: Check all Falcon components

- [ ] Get a full picture of every Falcon pod:

```bash
kubectl get pods -A | grep falcon
```

Expected namespaces: `falcon-lumos-injector` (injector), `falcon-kac` (KAC), `falcon-image-analyzer` (IAR).

### Step 2: Deploy the vulnapp into a Fargate-profiled namespace

> The `detection-vulnapp` namespace is already covered by the `app-workloads` Fargate profile from Section 1.

- [ ] Deploy the vulnapp:

```bash
kubectl apply -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

- [ ] Give the pod a moment to schedule — Fargate provisions a micro-VM per pod, so the first start is slower than EC2.

### Step 3: Verify sidecar injection

- [ ] Confirm the Falcon sidecar was injected into the pod:

```bash
kubectl get pod -l run=vulnerable.example.com -n detection-vulnapp -o jsonpath='{.items[0].spec.containers[*].name}'
# Expected: vulnerable.example.com crowdstrike-falcon-container
```

> **Look for:** the `crowdstrike-falcon-container` name alongside your app container. If it's missing, the pull secret or webhook didn't reach this namespace — re-check Section 4.

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

> **~5 min | Beginner**

> **What & Why:** Removes all Falcon components and the cluster to avoid ongoing AWS costs.

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

### Step 3: Delete the cluster

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
  --set container.image.repository=$CONTAINER_REGISTRY \
  --set container.image.tag=$CONTAINER_IMAGE_TAG \
  --set container.image.pullSecrets.enable=true \
  --set container.image.pullSecrets.registryConfigJSON=$FALCON_PULL_TOKEN \
  --set container.image.pullSecrets.allNamespaces=true
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

### Challenge 3: Stage the sensor image in ECR

**Scenario:** Your security policy forbids pulling images from external registries at runtime. Mirror the Falcon Container Sensor into ECR and configure the injector to pull from there with no `imagePullSecret`.

<details>
<summary>💡 Hint</summary>

Use `--copy` on the pull script, then rely on the Fargate **pod execution role** for ECR authentication instead of a pull secret. Check which policy the role needs.

</details>

<details>
<summary>✅ Solution</summary>

Copy the sensor image into ECR:

```bash
export ECR=<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com
export CONTAINER_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-container --copy $ECR)
export CONTAINER_REGISTRY=$(echo $CONTAINER_IMAGE_PATH | cut -d: -f1)
export CONTAINER_IMAGE_TAG=$(echo $CONTAINER_IMAGE_PATH | cut -d: -f2)
```

Deploy the injector with no pull secret (see the ECR option in Section 4). Then confirm the Fargate pod execution role can pull from ECR:

```bash
POD_EXEC_ROLE=$(aws eks describe-fargate-profile --cluster-name $CLUSTER_NAME --fargate-profile-name app-workloads \
  --query 'fargateProfile.podExecutionRoleArn' --output text | awk -F/ '{print $NF}')
aws iam list-attached-role-policies --role-name $POD_EXEC_ROLE
```

The default `eksctl` role includes `AmazonEKSFargatePodExecutionRolePolicy` (same-account ECR pulls). Only for cross-account ECR do you attach `AmazonEC2ContainerRegistryReadOnly`. Verify an injected pod pulled successfully with `kubectl describe pod -n detection-vulnapp <pod> | grep -A2 falcon` — look for `Successfully pulled`, no `ImagePullBackOff`.

</details>

---

## Quick Reference

| Action | Command / Value |
|--------|-----------------|
| Sidecar image type | `--type falcon-container` (NOT `falcon-sensor`) |
| Disable DaemonSet | `--set node.enabled=false` |
| Enable injector | `--set container.enabled=true` |
| All-namespaces injection | `--set container.image.pullSecrets.allNamespaces=true` |
| Opt-in injection | `--set container.disableNSInjection=true` + namespace label |
| Sidecar sizing | `--set container.sensorResources.requests.{cpu,memory}` |
| IAR Fargate mode | `--set deployment.enabled=true` (Watcher, never DaemonSet) |
| KAC pull secret | `--set image.registryConfigJSON=$FALCON_PULL_TOKEN` |
| Injected container name | `crowdstrike-falcon-container` |
| Fargate image pull auth | Pod execution role (ECR) or `imagePullSecret` |
| Namespaces needing a profile | Every Falcon ns + `kube-system` + app namespaces |
| List Fargate profiles | `eksctl get fargateprofile --cluster $CLUSTER_NAME` |

</div>

---
*Created: 2026-07-06 | Topics: cloud-security, kubernetes, eks, fargate, sidecar, helm*

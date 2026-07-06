# Falcon Platform on GKE Autopilot — DaemonSet

Deploy the CrowdStrike Falcon Platform (sensor + KAC + Image Analyzer) on a GKE **Autopilot** cluster using the DaemonSet approach, pulling images directly from CrowdStrike's registry. The one Autopilot-specific step is authorizing the privileged sensor pods via a `WorkloadAllowlist`.

> **Autopilot note:** Autopilot's **Warden** admission controller blocks privileged containers by default (`denied by autogke-disallow-privilege`). You must apply an `AllowlistSynchronizer` **before** deploying so GKE fetches CrowdStrike's `WorkloadAllowlists`, which authorize the sensor DaemonSet. The allowlist regex only matches `registry.crowdstrike.com` image URLs, so the **falcon-sensor node image must be pulled from `registry.crowdstrike.com`** — it cannot be hosted in your own registry (KAC and IAR have no such restriction).

> **Prerequisites:**
>
> - GKE **Autopilot** cluster (or permission to create one)
> - `kubectl` configured for the cluster (`kubectl get nodes` returns nodes)
> - `gcloud` CLI authenticated
> - Helm 3 installed (`helm version` shows v3.x)
> - CrowdStrike Falcon API credentials (Client ID + Secret)
>   - Required API scopes:
>     - **Falcon Images Download** (Read)
>     - **Sensor Download** (Read)
>     - **Falcon Container Image** (Read/Write)
>     - **Falcon Container CLI** (Write)
> - CrowdStrike CID (with checksum)
> - ~30 minutes (Quick Deploy) / ~60 minutes (Full Lab)

> **Windows:** These commands are written for bash. Run them from **WSL** or **Git Bash** — CrowdStrike's `falcon-container-sensor-pull` script is bash-only, and tools like `grep`/`cut` aren't available in native PowerShell.

## Reference Docs

| Source | Link |
|--------|------|
| CrowdStrike Docs: GKE Platform-specific config | https://docs.crowdstrike.com/r/en-US/qg0ygdwl/f344b152/me302ce8/ef3a99a0/vaed8b6d/oa491d1f |
| Google Docs: AllowlistSynchronizer | https://cloud.google.com/kubernetes-engine/docs/reference/crds/allowlistsynchronizer |
| falcon-platform Helm chart (GitHub) | https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-platform |
| Falcon Container Image Pull Script | https://github.com/CrowdStrike/falcon-scripts/tree/main/bash/containers/falcon-container-sensor-pull |

---

## Core Concepts

The **falcon-platform** umbrella Helm chart deploys three components in a single `helm install`:

- **Falcon Sensor** (DaemonSet) — Runtime protection on every node, one pod per node in `falcon-system`. On Autopilot it runs in `bpf` backend mode (no kernel module) and requires a WorkloadAllowlist to run privileged.
- **Falcon KAC** (Deployment) — Kubernetes Admission Controller in `falcon-kac`. Not privileged, so it is **not** subject to the allowlist.
- **Falcon Image Analyzer** (Deployment) — Scans running images in `falcon-image-analyzer`. Also not privileged.

By default all three pull from CrowdStrike's private registry (`registry.crowdstrike.com`) using a pull token generated from your API credentials — exactly like a standard Kubernetes deployment.

```
GKE AUTOPILOT — FALCON PLATFORM (ALLOWLIST-GATED DAEMONSET)
AllowlistSynchronizer -> WorkloadAllowlists -> GKE Warden authorizes the privileged DaemonSet
falcon-sensor DaemonSet pulls from registry.crowdstrike.com (required)
Falcon KAC + Falcon Image Analyzer Deployments pull from CrowdStrike by default
CrowdStrike Cloud — Telemetry
```

---

## Deployment Steps

<div data-mode="guide">

### 1. Set credentials and get pull token + image paths

```bash
export FALCON_CLIENT_ID="<YOUR_FALCON_CLIENT_ID>"
export FALCON_CLIENT_SECRET="<YOUR_FALCON_CLIENT_SECRET>"
export FALCON_CID="<YOUR_CID_WITH_CHECKSUM>"
export CLUSTER_NAME="<YOUR_CLUSTER_NAME>"
```

Generate the registry pull token:

```bash
export FALCON_PULL_TOKEN=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --get-pull-token)
```

Get image paths for all three components (they resolve to `registry.crowdstrike.com/...`):

```bash
export SENSOR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-sensor --get-image-path)

export KAC_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-kac --get-image-path)

export IAR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-imageanalyzer --get-image-path)
```

> **Note:** `--get-image-path` returns the image location in CrowdStrike's registry, so Kubernetes pulls all three components directly from CrowdStrike at runtime — the recommended path on Autopilot. The **falcon-sensor image must stay on `registry.crowdstrike.com`**: the WorkloadAllowlist regex only vouches for CrowdStrike's registry, so a relocated sensor image is rejected with `denied by autogke-disallow-privilege`.

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

> Every line should read `SET`. The sensor path must show `registry.crowdstrike.com/...`. Any `MISSING` means that variable didn't populate — re-check the matching command and your API scopes.

### 2. Apply the AllowlistSynchronizer

> Do this **before** deploying the sensor — Warden rejects the DaemonSet until the WorkloadAllowlists exist.

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: auto.gke.io/v1
kind: AllowlistSynchronizer
metadata:
  name: crowdstrike-synchronizer
spec:
  allowlistPaths:
    - CrowdStrike/falcon-sensor/*
EOF
```

Wait for the WorkloadAllowlists to appear (1-2 minutes) and note their versions:

```bash
kubectl get workloadallowlists
```

### 3. Add Helm repo

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update
```

### 4. Deploy the chart (Autopilot settings)

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set falcon-sensor.falcon.tags="gke-autopilot" \
  --set createComponentNamespaces=true \
  --set global.falcon.cid=$FALCON_CID \
  --set global.containerRegistry.configJSON=$FALCON_PULL_TOKEN \
  --set falcon-sensor.node.image.repository=$DAEMONSET_SENSOR_REGISTRY \
  --set falcon-sensor.node.image.tag=$DAEMONSET_SENSOR_IMAGE_TAG \
  --set falcon-sensor.node.backend=bpf \
  --set falcon-sensor.node.gke.autopilot=true \
  --set falcon-sensor.node.gke.deployAllowListVersion=v1.0.5 \
  --set falcon-sensor.node.gke.cleanupAllowListVersion=v1.0.3 \
  --set falcon-kac.image.repository=$KAC_REGISTRY \
  --set falcon-kac.image.tag=$KAC_IMAGE_TAG \
  --set falcon-image-analyzer.deployment.enabled=true \
  --set falcon-image-analyzer.image.repository=$IAR_REGISTRY \
  --set falcon-image-analyzer.image.tag=$IAR_IMAGE_TAG \
  --set falcon-image-analyzer.crowdstrikeConfig.clusterName=$CLUSTER_NAME \
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=$FALCON_CLIENT_ID \
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET
```

> `falcon-sensor.falcon.tags="gke-autopilot"` applies Falcon console grouping tags to the node sensor — change it to any comma-separated tags you want (e.g. `prod,team-a`).

> Set `deployAllowListVersion` / `cleanupAllowListVersion` to the highest versions from `kubectl get workloadallowlists`. If deploy fails with an args mismatch, step down one version.

> **GovCloud (us-gov-1 / us-gov-2):** Running the pull script (step 1) with GovCloud API credentials makes `--get-pull-token` / `--get-image-path` resolve to the GovCloud registry automatically, so your `*_REGISTRY` vars are already correct. Add one flag so Image Analyzer targets the right region: `--set falcon-image-analyzer.crowdstrikeConfig.agentRegion=gov1` (use `gov2` for us-gov-2). Sensor and KAC derive their region from the CID; optionally pin the sensor with `--set falcon-sensor.falcon.cloud=us-gov-1`.

### 5. Verify

```bash
kubectl get ds -n falcon-system
kubectl get pods -n falcon-system
kubectl get pods -n falcon-kac
kubectl get pods -n falcon-image-analyzer
```

The DaemonSet `DESIRED` should equal `CURRENT` and match your node count; all pods `Running`.

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

## 1. Create a GKE Autopilot Cluster

> **~10 min | Beginner**

> **What & Why:** Autopilot manages nodes for you and enforces stricter pod security than Standard GKE. You need a running Autopilot cluster before deploying — the allowlist and `bpf` requirements below only apply here.

### Step 1: Create the cluster

- [ ] **Console:** Navigate to **Kubernetes Engine** → **Clusters** → **Create** → choose **Autopilot** → set name `falcon-autopilot-lab` and a region → **Create**

<details>
<summary>CLI equivalent</summary>

```bash
export GCP_PROJECT_ID=$(gcloud config get-value project)
export GCP_REGION="us-central1"
export CLUSTER_NAME="falcon-autopilot-lab"

gcloud container clusters create-auto $CLUSTER_NAME \
  --project=$GCP_PROJECT_ID \
  --region=$GCP_REGION \
  --release-channel=regular
```

</details>

### Step 2: Get credentials and verify

- [ ] Fetch kubeconfig credentials and confirm connectivity:

```bash
gcloud container clusters get-credentials $CLUSTER_NAME \
  --project=$GCP_PROJECT_ID --region=$GCP_REGION

kubectl get nodes
```

Nodes appear on-demand on Autopilot — an empty list here is fine until you schedule workloads.

---

## 2. Configure API Credentials

> **~5 min | Beginner**

> **What & Why:** The Falcon container images live in CrowdStrike's private registry. API credentials let you generate a pull token and discover the correct image paths for your CID.

### Step 1: Create an API client

- [ ] **Console:** Navigate to **Falcon Console** → **Support and resources** → **API clients and keys** → **Create API client**
- [ ] Set these OAuth 2.0 scopes:
  - Falcon Images Download: **Read**
  - Sensor Download: **Read**
  - Falcon Container Image: **Read/Write**
  - Falcon Container CLI: **Write**

<details>
<summary>CLI equivalent</summary>

There is no CLI for creating API clients — this must be done in the console.

</details>

### Step 2: Export credentials

- [ ] Set your credentials and cluster identity as environment variables:

```bash
export FALCON_CLIENT_ID="<YOUR_FALCON_CLIENT_ID>"
export FALCON_CLIENT_SECRET="<YOUR_FALCON_CLIENT_SECRET>"
export FALCON_CID="<YOUR_CID_WITH_CHECKSUM>"
export CLUSTER_NAME="falcon-autopilot-lab"
```

---

## 3. Apply the AllowlistSynchronizer

> **~10 min | Intermediate**

> **What & Why:** This is the Autopilot-specific step. The `AllowlistSynchronizer` CRD tells GKE to fetch CrowdStrike's `WorkloadAllowlists`, which authorize the privileged sensor DaemonSet. Without them, Warden rejects the sensor pods with `denied by autogke-disallow-privilege`.

### Step 1: Apply the synchronizer

- [ ] Apply the CRD (also available in the workspace repo as `allowlist-synchronizer.yaml`):

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: auto.gke.io/v1
kind: AllowlistSynchronizer
metadata:
  name: crowdstrike-synchronizer
spec:
  allowlistPaths:
    - CrowdStrike/falcon-sensor/*
EOF
```

- [ ] Confirm the synchronizer is running:

```bash
kubectl get allowlistsynchronizers
```

### Step 2: Wait for the WorkloadAllowlists

- [ ] Poll until the allowlists appear (may take 1-2 minutes):

```bash
kubectl get workloadallowlists
```

Expected output:

```
NAME                                                  AGE
crowdstrike-falconsensor-cleanup-allowlist-v1.0.0     1m
crowdstrike-falconsensor-deploy-allowlist-v1.0.0      1m
crowdstrike-falconsensor-falconctl-allowlist-v1.0.0   1m
```

> **Important:** Do NOT proceed until WorkloadAllowlists appear. Note the highest `deploy` and `cleanup` version numbers — you'll pass them to Helm in section 6.

---

## 4. Get Pull Token and Image Paths

> **~5 min | Beginner**

> **What & Why:** The pull token authenticates Kubernetes to CrowdStrike's registry. The image paths tell Helm exactly which sensor, KAC, and IAR images to pull for your CID's assigned cloud region.

### Step 1: Generate the pull token

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

> **Note:** `--get-image-path` returns the CrowdStrike registry location so Kubernetes pulls all three components directly from CrowdStrike at runtime — the recommended path on Autopilot.
>
> **Autopilot constraint:** The **falcon-sensor** image must stay on `registry.crowdstrike.com`. The WorkloadAllowlist regex only vouches for CrowdStrike's registry, so a relocated sensor image is rejected with `denied by autogke-disallow-privilege`.

### Step 3: Parse and set all variables

- [ ] Split each image path into registry and tag:

```bash
export DAEMONSET_SENSOR_REGISTRY=$(echo $SENSOR_IMAGE_PATH | cut -d: -f1)
export DAEMONSET_SENSOR_IMAGE_TAG=$(echo $SENSOR_IMAGE_PATH | cut -d: -f2)

export KAC_REGISTRY=$(echo $KAC_IMAGE_PATH | cut -d: -f1)
export KAC_IMAGE_TAG=$(echo $KAC_IMAGE_PATH | cut -d: -f2)

export IAR_REGISTRY=$(echo $IAR_IMAGE_PATH | cut -d: -f1)
export IAR_IMAGE_TAG=$(echo $IAR_IMAGE_PATH | cut -d: -f2)
```

### Step 4: Validate the saved variables

> **What & Why:** Each command above can fail silently — an expired token or a missing API scope returns an empty string, and the `cut` parsing happily produces empty registry/tag values. Echoing every variable the Helm install consumes confirms they're all saved before you build a large `--set` command on top of them.

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

Every line should read `SET`, and each image path must show a full value — the sensor path must resolve to `registry.crowdstrike.com/...`. A line printing `MISSING` means that variable is empty — re-check the matching command, your API scopes, and the values you exported.

---

## 5. Add Helm Repository

> **~2 min | Beginner**

> **What & Why:** The CrowdStrike Helm charts are published to a public Helm repository. Adding it lets you install charts by name.

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

## 6. Deploy the Falcon Platform (Autopilot settings)

> **~10 min | Intermediate**

> **What & Why:** The `falcon-platform` umbrella chart installs all three components in one release. The extra `--set` flags below (`backend=bpf`, `gke.autopilot=true`, and the allowlist versions) are what make the privileged sensor schedulable on Autopilot.

### Step 1: Install the chart

- [ ] Run the Helm install:

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set falcon-sensor.falcon.tags="gke-autopilot" \
  --set createComponentNamespaces=true \
  --set global.falcon.cid=$FALCON_CID \
  --set global.containerRegistry.configJSON=$FALCON_PULL_TOKEN \
  --set falcon-sensor.node.image.repository=$DAEMONSET_SENSOR_REGISTRY \
  --set falcon-sensor.node.image.tag=$DAEMONSET_SENSOR_IMAGE_TAG \
  --set falcon-sensor.node.backend=bpf \
  --set falcon-sensor.node.gke.autopilot=true \
  --set falcon-sensor.node.gke.deployAllowListVersion=v1.0.5 \
  --set falcon-sensor.node.gke.cleanupAllowListVersion=v1.0.3 \
  --set falcon-kac.image.repository=$KAC_REGISTRY \
  --set falcon-kac.image.tag=$KAC_IMAGE_TAG \
  --set falcon-image-analyzer.deployment.enabled=true \
  --set falcon-image-analyzer.image.repository=$IAR_REGISTRY \
  --set falcon-image-analyzer.image.tag=$IAR_IMAGE_TAG \
  --set falcon-image-analyzer.crowdstrikeConfig.clusterName=$CLUSTER_NAME \
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=$FALCON_CLIENT_ID \
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FALCON_CLIENT_SECRET
```

> `falcon-sensor.falcon.tags="gke-autopilot"` applies Falcon console grouping tags to the node sensor — change it to any comma-separated tags you want (e.g. `prod,team-a`).

#### Key Autopilot-specific settings

| Setting                                | Why                                                          |
| -------------------------------------- | ------------------------------------------------------------ |
| `falcon-sensor.node.backend=bpf`       | Required — Autopilot doesn't allow kernel module loading     |
| `falcon-sensor.node.gke.autopilot=true`| Configures the DaemonSet for Autopilot constraints           |
| `node.gke.deployAllowListVersion`      | Must match a WorkloadAllowlist version (`kubectl get workloadallowlists`) |
| `node.gke.cleanupAllowListVersion`     | Must match a cleanup WorkloadAllowlist version               |
| `falcon-sensor.node.image.repository`  | Must resolve to `registry.crowdstrike.com/...` (allowlist regex validates this) |
| `global.containerRegistry.configJSON`  | Pull token auth for CrowdStrike's registry                   |

> **Finding the correct allowlist versions:** Use the highest `deploy` and `cleanup` versions from `kubectl get workloadallowlists`. If deploy fails with an args mismatch, step down one version (e.g. `v1.0.6` → `v1.0.5`).

> **GovCloud (us-gov-1 / us-gov-2):** When you generate the pull token and image paths (section 4) with GovCloud API credentials, `--get-pull-token` / `--get-image-path` resolve to the GovCloud registry (`registry.laggar.gcw.crowdstrike.com` for gov-1, `registry.us-gov-2.crowdstrike.mil` for gov-2) automatically — the `*_REGISTRY` variables need no changes. Add one flag to the Helm install so Image Analyzer talks to the right region:
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

## 7. Verify Deployment

> **~5 min | Beginner**

> **What & Why:** Verification confirms the sensor DaemonSet has a pod on every active node, the sensors are registering with CrowdStrike, and a test workload is observed.

### Step 1: Check DaemonSet coverage

- [ ] Verify the sensor DaemonSet matches node count:

```bash
kubectl get ds -n falcon-system
```

`DESIRED` should equal `CURRENT` and match your active node count.

### Step 2: Check sensor connectivity

- [ ] Confirm sensors are communicating with the CrowdStrike cloud (no `ERROR` lines):

```bash
kubectl logs -n falcon-system -l app.kubernetes.io/name=falcon-sensor --tail=20
```

### Step 3: Test with a workload

- [ ] Deploy a sample workload and confirm the sensor observes it:

```bash
kubectl create namespace test-workload
kubectl run nginx --image=nginx -n test-workload
kubectl wait --for=condition=Ready pod/nginx -n test-workload --timeout=120s
```

### Step 4: Verify in Falcon console

- [ ] **Console:** Navigate to **Falcon Console** → **Host management** → **Hosts**
- [ ] Filter by your cluster name — sensor hosts should appear within 5 minutes of deployment

---

## 8. Test a Detection (Optional)

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

## 9. Troubleshooting

> **~5 min | Intermediate**

**`denied by autogke-disallow-privilege` / `denied by autogke-disallow-hostnamespaces`**
The AllowlistSynchronizer hasn't fetched WorkloadAllowlists yet, or you deployed the sensor before applying it. Confirm `kubectl get workloadallowlists` returns entries, then re-run the Helm install.

**Sensor pods in CrashLoopBackOff**
Resources may be too low. Check `kubectl top pod -n falcon-system` and raise requests:

```bash
--set "falcon-sensor.node.daemonset.resources.requests.cpu=1000m" \
--set "falcon-sensor.node.daemonset.resources.requests.memory=2Gi"
```

**Image pull errors on the sensor**
Confirm `DAEMONSET_SENSOR_REGISTRY` resolves to `registry.crowdstrike.com/...` and that `FALCON_PULL_TOKEN` is set. A GAR/ECR sensor path will be rejected on Autopilot.

**DaemonSet still showing old image after upgrade**

```bash
kubectl rollout restart daemonset -n falcon-system
```

---

## 10. Cleanup

> **~5 min | Beginner**

> **What & Why:** Removes all Falcon components, the allowlist synchronizer, and the cluster to avoid ongoing cloud costs.

- [ ] Uninstall Falcon and delete its namespaces:

```bash
helm uninstall falcon-platform -n falcon-platform
kubectl delete ns falcon-platform falcon-system falcon-kac falcon-image-analyzer
kubectl delete allowlistsynchronizer crowdstrike-synchronizer
```

- [ ] Delete the test workload:

```bash
kubectl delete namespace test-workload
```

- [ ] Delete the Autopilot cluster:

```bash
gcloud container clusters delete $CLUSTER_NAME \
  --project=$GCP_PROJECT_ID --region=$GCP_REGION --quiet
```

---

## Challenges

### Challenge 1: Values file deployment

**Scenario:** Passing 18 `--set` flags is error-prone. Move all configuration into a `values.yaml` and deploy with `helm upgrade --install -f values.yaml`.

<details>
<summary>Hint</summary>

Mirror the `--set` keys as nested YAML under `global:`, `falcon-sensor:`, `falcon-kac:`, and `falcon-image-analyzer:`.

</details>

### Challenge 2: Match allowlist versions dynamically

**Scenario:** Hardcoding `v1.0.5`/`v1.0.3` breaks when CrowdStrike ships new allowlists. Derive the versions from `kubectl get workloadallowlists` output before the Helm install.

<details>
<summary>Hint</summary>

Parse the allowlist names with `kubectl get workloadallowlists -o name`, extract the `-vX.Y.Z` suffix for the `deploy` and `cleanup` allowlists, and feed them into the `--set` flags.

</details>

---

## Quick Reference

| Variable | Value | Where Used |
|----------|-------|------------|
| `FALCON_CLIENT_ID` | Your API client ID | Pull token, image paths, IAR config |
| `FALCON_CLIENT_SECRET` | Your API client secret | Pull token, image paths, IAR config |
| `FALCON_CID` | CID with checksum (e.g., `ABCD1234-AB`) | Helm `global.falcon.cid` |
| `FALCON_PULL_TOKEN` | Base64 registry auth | Helm `global.containerRegistry.configJSON` |
| `CLUSTER_NAME` | Your cluster name | IAR cluster identification |
| `DAEMONSET_SENSOR_REGISTRY` | `registry.crowdstrike.com/falcon-sensor/...` (required) | Helm sensor image repo |
| `DAEMONSET_SENSOR_IMAGE_TAG` | Sensor version tag | Helm sensor image tag |
| `KAC_REGISTRY` | CrowdStrike registry | Helm KAC image repo |
| `KAC_IMAGE_TAG` | KAC version tag | Helm KAC image tag |
| `IAR_REGISTRY` | CrowdStrike registry | Helm IAR image repo |
| `IAR_IMAGE_TAG` | IAR version tag | Helm IAR image tag |
| `deployAllowListVersion` | Highest `deploy` version from `kubectl get workloadallowlists` | Helm sensor Autopilot flag |
| `cleanupAllowListVersion` | Highest `cleanup` version | Helm sensor Autopilot flag |

</div>

---
*Created: 2026-07-06 | Topics: kubernetes, gke-autopilot, helm, daemonset, workload-allowlist*

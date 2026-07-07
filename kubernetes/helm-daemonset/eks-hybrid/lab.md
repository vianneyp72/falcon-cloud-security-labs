# Falcon Helm Deployment — EKS Hybrid (DaemonSet + Sidecar Injector)

Deploy CrowdStrike Falcon on an EKS cluster running both EC2 nodes and Fargate pods using a hybrid approach: DaemonSet sensor for EC2, sidecar injector for Fargate.

> **Prerequisites:**
>
> - EKS cluster with both EC2 managed node groups and Fargate profiles active
> - `kubectl` configured for the cluster (`kubectl get nodes` returns EC2 nodes)
> - Helm 3 installed (`helm version` shows v3.x)
> - CrowdStrike Falcon API credentials (Client ID + Secret)
>   - Required API scopes: **Falcon Images Download** (Read), **Sensor Download** (Read), **Falcon Container Image** (Read/Write), **Falcon Container CLI** (Write)
> - CrowdStrike CID (with checksum)
> - Fargate profile covering `falcon-lumos-injector` namespace
> - _Optional (only to host images in your own registry):_ Falcon images copied to ECR + the Fargate pod execution role granted ECR read (`AmazonEC2ContainerRegistryReadOnly`)
> - ~30 minutes (Quick Deploy) / ~75 minutes (Full Lab)

> **Windows:** These commands are written for bash. Run them from **WSL** or **Git Bash** — CrowdStrike's `falcon-container-sensor-pull` script is bash-only, and tools like `grep`/`cut`/`awk` aren't available in native PowerShell.

## Reference Docs

| Source                               | Link                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| falcon-platform Helm chart (GitHub)  | https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-platform |
| falcon-sensor Helm chart (Injector)  | https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-sensor   |
| EKS Fargate Pod Execution Role       | https://docs.aws.amazon.com/eks/latest/userguide/fargate-pod-configuration.html  |
| Deploy Falcon Sensor via Helm (Docs) | https://docs.crowdstrike.com/r/en-US/qg0ygdwl/l303c850                           |

---

## Core Concepts

EKS hybrid clusters run workloads on two compute types with different constraints:

- **EC2 nodes** — Full Linux hosts. The Falcon sensor runs as a DaemonSet (one pod per node), providing kernel-level protection via eBPF.
- **Fargate pods** — Serverless, no host access. DaemonSets are ignored. Protection requires injecting the Falcon sensor as a sidecar container into each pod at admission time.

This lab deploys four components:

- **Falcon Sensor** (DaemonSet) — Kernel-level protection on every EC2 node. Namespace: `falcon-system`.
- **Falcon Sidecar Injector** (Deployment) — Mutating webhook that injects the Falcon sensor container into Fargate pods at creation. Namespace: `falcon-lumos-injector`.
- **Falcon KAC** (Deployment) — Kubernetes Admission Controller for policy enforcement. Namespace: `falcon-kac`.
- **Falcon Image Analyzer** (Deployment) — Scans container images for vulnerabilities. Namespace: `falcon-image-analyzer`.

### How hybrid coverage works

| Compute      | Protection method | Mechanism                                          |
| ------------ | ----------------- | -------------------------------------------------- |
| EC2 nodes    | DaemonSet sensor  | 1 pod per node, eBPF kernel probes                 |
| Fargate pods | Sidecar injection | Mutating webhook adds sensor container             |
| KAC/IAR      | Deploy to EC2     | Stateless, land on EC2 (no Fargate profile needed) |

```
EKS HYBRID CLUSTER (EC2 + Fargate)
Falcon Injector: mutating webhook injects the sidecar into Fargate pods
DaemonSet: deploys one sensor pod onto each EC2 node
Fargate Node: app container + falcon-sensor sidecar (user space)
EC2 Node 1: app container + falcon-sensor DaemonSet pod (eBPF)
EC2 Node 2: app container + falcon-sensor DaemonSet pod (eBPF)
Falcon Image Analyzer: Deployment spanning all nodes, lands on EC2
Falcon KAC: Deployment (Admission Controller) spanning all nodes, lands on EC2
Image Registry (CrowdStrike or ECR): LUMOS Sensor Image, DaemonSet Sensor Image
CrowdStrike Cloud: sidecar + DaemonSet telemetry over TLS 443
```

---

## Deployment Steps

<div data-mode="guide">

### 1. Set credentials and pull token

Set your API credentials, CID, and cluster name:

```bash
export FALCON_CID=<YOUR_FALCON_CID>
export FALCON_CLIENT_ID=<YOUR_CLIENT_ID>
export FALCON_CLIENT_SECRET=<YOUR_CLIENT_SECRET>
export CLUSTER_NAME=<YOUR_CLUSTER_NAME>
```

Generate the registry pull token (used as the pull secret for both charts):

```bash
export FALCON_PULL_TOKEN=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --get-pull-token)
```

### 2. Get image paths

Pull the image paths for all four components directly from CrowdStrike's registry. Note the two sensor types: `falcon-sensor` is the DaemonSet (node) sensor for EC2; `falcon-container` is the LUMOS sidecar sensor injected into Fargate pods.

```bash
export SENSOR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-sensor --get-image-path)

export LUMOS_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-container --get-image-path)

export KAC_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-kac --get-image-path)

export IAR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-imageanalyzer --get-image-path)
```

> **Note:** Pulling directly from CrowdStrike (shown here) is the simplest path. To host in your own ECR instead, swap `--get-image-path` for `--copy <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com`. Then for each `--type`, point the `*_REGISTRY` / `*_IMAGE_TAG` vars at the ECR paths, and let the Fargate pod execution role pull the image — see the ECR option under step 4.

Parse into registry + tag:

```bash
export DAEMONSET_SENSOR_REGISTRY=$(echo $SENSOR_IMAGE_PATH | cut -d: -f1)
export DAEMONSET_SENSOR_IMAGE_TAG=$(echo $SENSOR_IMAGE_PATH | cut -d: -f2)
export LUMOS_SENSOR_REGISTRY=$(echo $LUMOS_IMAGE_PATH | cut -d: -f1)
export LUMOS_SENSOR_IMAGE_TAG=$(echo $LUMOS_IMAGE_PATH | cut -d: -f2)
export KAC_REGISTRY=$(echo $KAC_IMAGE_PATH | cut -d: -f1)
export KAC_IMAGE_TAG=$(echo $KAC_IMAGE_PATH | cut -d: -f2)
export IAR_REGISTRY=$(echo $IAR_IMAGE_PATH | cut -d: -f1)
export IAR_IMAGE_TAG=$(echo $IAR_IMAGE_PATH | cut -d: -f2)
```

Validate every variable the Helm installs need was populated:

```bash
echo "CID            : $([ -n "$FALCON_CID" ] && echo SET || echo MISSING) ($FALCON_CID)"
echo "Cluster        : $([ -n "$CLUSTER_NAME" ] && echo SET || echo MISSING) ($CLUSTER_NAME)"
echo "Client ID      : $([ -n "$FALCON_CLIENT_ID" ] && echo SET || echo MISSING) ($FALCON_CLIENT_ID)"
echo "Client Secret  : $([ -n "$FALCON_CLIENT_SECRET" ] && echo SET || echo MISSING) ($FALCON_CLIENT_SECRET)"
echo "Pull Token     : $([ -n "$FALCON_PULL_TOKEN" ] && echo SET || echo MISSING) ($FALCON_PULL_TOKEN)"
echo "DaemonSet      : $([ -n "$DAEMONSET_SENSOR_REGISTRY" ] && echo SET || echo MISSING) ($DAEMONSET_SENSOR_REGISTRY:$DAEMONSET_SENSOR_IMAGE_TAG)"
echo "LUMOS Sidecar  : $([ -n "$LUMOS_SENSOR_REGISTRY" ] && echo SET || echo MISSING) ($LUMOS_SENSOR_REGISTRY:$LUMOS_SENSOR_IMAGE_TAG)"
echo "KAC            : $([ -n "$KAC_REGISTRY" ] && echo SET || echo MISSING) ($KAC_REGISTRY:$KAC_IMAGE_TAG)"
echo "IAR            : $([ -n "$IAR_REGISTRY" ] && echo SET || echo MISSING) ($IAR_REGISTRY:$IAR_IMAGE_TAG)"
```

Every line should read `SET`. Any `MISSING` means that variable didn't populate — re-check the matching command and your API scopes.

### 3. Add Helm repo

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update
```

### 4. deploy DaemonSet + KAC + IAR

> Change `falcon-sensor.falcon.tags` to any custom value to group the EC2 node sensor in the Falcon console.

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set falcon-sensor.falcon.tags="eks-ec2-node" \
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

### 5. Deploy sidecar injector (Fargate pods)

Pulls the LUMOS sidecar from CrowdStrike's registry and propagates the pull token to all app namespaces, so any Fargate pod gets injected without tracking namespace names:

> Change `falcon.tags` to any custom value to group the Fargate sidecars in the Falcon console.

```bash
helm upgrade --install falcon-lumos-injector crowdstrike/falcon-sensor \
  --namespace falcon-lumos-injector \
  --create-namespace \
  --set falcon.tags="eks-fargate" \
  --set falcon.cid=$FALCON_CID \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=$LUMOS_SENSOR_REGISTRY \
  --set container.image.tag=$LUMOS_SENSOR_IMAGE_TAG \
  --set container.image.pullSecrets.enable=true \
  --set container.image.pullSecrets.registryConfigJSON=$FALCON_PULL_TOKEN \
  --set container.image.pullSecrets.allNamespaces=true
```

> `allNamespaces=true` creates the pull secret in every namespace (except system ones) so you don't have to enumerate them. To scope it to specific namespaces instead, swap in `--set container.image.pullSecrets.namespaces="ns1\,ns2"`.

<details><summary>ECR option (host the sidecar in your own registry)</summary>

If you staged the LUMOS image in ECR (via `--type falcon-container --copy ...` in step 2), you don't need a pull secret — on Fargate, image pulls are authenticated by the **Fargate pod execution role**, not an `imagePullSecret`. Drop the `container.image.pullSecrets.*` flags and point the image at your ECR path. The default pod execution role `eksctl` creates already includes `AmazonEKSFargatePodExecutionRolePolicy`, which grants ECR pulls for same-account repositories:

```bash
helm upgrade --install falcon-lumos-injector crowdstrike/falcon-sensor \
  --namespace falcon-lumos-injector \
  --create-namespace \
  --set falcon.tags="eks-fargate" \
  --set falcon.cid=$FALCON_CID \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=$LUMOS_SENSOR_REGISTRY \
  --set container.image.tag=$LUMOS_SENSOR_IMAGE_TAG
```

</details>

### 6. Verify Falcon components

```bash
kubectl get pods -A | grep falcon
```

Expected namespaces: `falcon-system` (DaemonSet), `falcon-kac`, `falcon-image-analyzer`, `falcon-lumos-injector` (sidecar injector).

### 7. Test sidecar injection

Deploy the CrowdStrike vulnapp into the Fargate-profiled namespace (`detection-vulnapp` is already covered by the `app-workloads` Fargate profile — no new profile needed) and confirm the sidecar is injected:

```bash
kubectl apply -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
kubectl get pod -l run=vulnerable.example.com -n detection-vulnapp -o jsonpath='{.items[0].spec.containers[*].name}'
# Should show: vulnerable.example.com crowdstrike-falcon-container
```

### 8. Test a detection (optional)

The vulnapp from the previous step also generates real detections. Port-forward to it and trigger a simulated attack:

```bash
kubectl port-forward -n detection-vulnapp svc/vulnerable-example-com 8060:80
```

`port-forward` blocks the terminal — leave it running and open [http://localhost:8060](http://localhost:8060) in your browser. Click any attack simulation (e.g. **Access sensitive files**, **Kill process**). Since this pod runs on Fargate, the injected sidecar sensor reports the detection.

Check **Falcon Console** > **Next-Gen SIEM** > **Monitor and investigate** > **Detections**, then filter **Source product** = **Cloud** — a new detection should appear within a few minutes, then stop the port-forward (Ctrl+C).

### 9. Clean up the vulnapp

```bash
kubectl delete -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

</div>

<div data-mode="lab">

## 1. Provision EKS Hybrid Cluster

> **~15 min | Intermediate**

> **What & Why:** A hybrid EKS cluster uses both EC2 managed node groups (for DaemonSet workloads) and Fargate profiles (for serverless pods). This mirrors production environments where teams run a mix of compute types. The Falcon deployment must cover both.

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
      - namespace: falcon-lumos-injector
  - name: app-workloads
    selectors:
      - namespace: detection-vulnapp
EOF
```

### Step 2: Create the cluster

- [ ] Deploy the cluster (takes ~15 minutes):

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

## 2. Configure Credentials and Images

> **~5 min | Beginner**

> **What & Why:** The Falcon sensor images must be accessible to the cluster. By default this lab pulls all components directly from CrowdStrike's registry using a pull token. You also need API credentials for IAR's vulnerability reporting.

### Step 1: Set API credentials

- [ ] Export your Falcon API credentials, CID, and cluster name:

```bash
export FALCON_CID=<YOUR_FALCON_CID>
export FALCON_CLIENT_ID=<YOUR_CLIENT_ID>
export FALCON_CLIENT_SECRET=<YOUR_CLIENT_SECRET>
export CLUSTER_NAME=falcon-hybrid-lab
```

### Step 2: Generate the registry pull token

- [ ] Use the pull script to mint a base64 docker config used as the pull secret for both charts:

```bash
export FALCON_PULL_TOKEN=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --get-pull-token)
```

### Step 3: Get image paths

- [ ] Pull the image paths for all four components from CrowdStrike (`falcon-sensor` = DaemonSet node sensor; `falcon-container` = LUMOS sidecar):

```bash
export SENSOR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-sensor --get-image-path)

export LUMOS_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-container --get-image-path)

export KAC_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-kac --get-image-path)

export IAR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id $FALCON_CLIENT_ID --client-secret $FALCON_CLIENT_SECRET --type falcon-imageanalyzer --get-image-path)
```

- [ ] Parse into registry + tag:

```bash
export DAEMONSET_SENSOR_REGISTRY=$(echo $SENSOR_IMAGE_PATH | cut -d: -f1)
export DAEMONSET_SENSOR_IMAGE_TAG=$(echo $SENSOR_IMAGE_PATH | cut -d: -f2)
export LUMOS_SENSOR_REGISTRY=$(echo $LUMOS_IMAGE_PATH | cut -d: -f1)
export LUMOS_SENSOR_IMAGE_TAG=$(echo $LUMOS_IMAGE_PATH | cut -d: -f2)
export KAC_REGISTRY=$(echo $KAC_IMAGE_PATH | cut -d: -f1)
export KAC_IMAGE_TAG=$(echo $KAC_IMAGE_PATH | cut -d: -f2)
export IAR_REGISTRY=$(echo $IAR_IMAGE_PATH | cut -d: -f1)
export IAR_IMAGE_TAG=$(echo $IAR_IMAGE_PATH | cut -d: -f2)
```

> **Note:** Does the LUMOS sidecar have to live in your own registry? No. Unlike GKE Autopilot (whose WorkloadAllowlist regex locks the node sensor to `registry.crowdstrike.com`), the injected sidecar has no registry restriction. To host images in your own ECR instead, swap `--get-image-path` for `--copy <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com` on each `--type` and set the `*_REGISTRY` / `*_IMAGE_TAG` vars to the ECR paths, then follow the ECR option in Section 5.

### Step 4 (ECR option only): Confirm the Fargate pod execution role can pull from ECR

- [ ] Skip unless you staged images in ECR. On Fargate, images are pulled by the **Fargate pod execution role** (not IRSA and not an `imagePullSecret`), so no per-service-account role is required. Confirm the pod execution role attached to your Fargate profiles has ECR read access:

```bash
# Find the pod execution role for your Fargate profiles
aws eks describe-fargate-profile --cluster-name $CLUSTER_NAME --fargate-profile-name app-workloads \
  --query 'fargateProfile.podExecutionRoleArn' --output text
```

- [ ] The default role `eksctl` creates already has `AmazonEKSFargatePodExecutionRolePolicy`, which grants ECR pulls for same-account repositories. Only if your ECR is in another account or the policy is missing, attach ECR read:

```bash
POD_EXEC_ROLE=$(aws eks describe-fargate-profile --cluster-name $CLUSTER_NAME --fargate-profile-name app-workloads --query 'fargateProfile.podExecutionRoleArn' --output text | awk -F/ '{print $NF}')
aws iam attach-role-policy --role-name $POD_EXEC_ROLE --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
```

---

## 3. Add Helm Repository

> **~2 min | Beginner**

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

> **~5 min | Intermediate**

> **What & Why:** The `falcon-platform` umbrella chart installs the DaemonSet sensor (EC2 nodes), KAC (admission control), and IAR (image scanning) in one release. On a hybrid cluster, DaemonSet pods only schedule on EC2 nodes — Fargate ignores them automatically.

### Step 1: Install the platform chart

> Change `falcon-sensor.falcon.tags` to any custom value to group the EC2 node sensor in the Falcon console.

- [ ] Deploy with all component configurations:

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set falcon-sensor.falcon.tags="eks-ec2-node" \
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

### Step 2: Verify EC2 sensor pods

- [ ] Confirm the DaemonSet sensor is running on EC2 nodes only:

```bash
kubectl get pods -n falcon-system -o wide
kubectl get ds -n falcon-system
```

`DESIRED` should match your EC2 node count (not total nodes including Fargate).

---

## 5. Deploy Sidecar Injector (Fargate Coverage)

> **~5 min | Intermediate**

> **What & Why:** Fargate pods have no host to run a DaemonSet on. The sidecar injector is a mutating admission webhook — when a pod is created in a Fargate-profiled namespace, the webhook intercepts the request and injects the Falcon sensor as an additional container in the pod spec. By default the sidecar is pulled from CrowdStrike's registry and the pull token is propagated to the injected namespaces (`container.image.pullSecrets.*`).

### Step 1: Deploy the injector

> Change `falcon.tags` to any custom value to group the Fargate sidecars in the Falcon console.

- [ ] Install the `falcon-sensor` chart in injector mode (pulls the sidecar from CrowdStrike):

```bash
helm upgrade --install falcon-lumos-injector crowdstrike/falcon-sensor \
  --namespace falcon-lumos-injector \
  --create-namespace \
  --set falcon.tags="eks-fargate" \
  --set falcon.cid=$FALCON_CID \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=$LUMOS_SENSOR_REGISTRY \
  --set container.image.tag=$LUMOS_SENSOR_IMAGE_TAG \
  --set container.image.pullSecrets.enable=true \
  --set container.image.pullSecrets.registryConfigJSON=$FALCON_PULL_TOKEN \
  --set container.image.pullSecrets.allNamespaces=true
```

> `node.enabled=false` disables the DaemonSet (already covered by falcon-platform). `container.enabled=true` activates the sidecar injector mode. `container.image.pullSecrets.allNamespaces=true` creates the pull secret in every namespace (except system ones), so any Fargate-profiled workload gets injected without you tracking namespace names. To scope it to specific namespaces instead, swap in `--set container.image.pullSecrets.namespaces="ns1\,ns2"`.

<details><summary>ECR option (host the sidecar in your own registry)</summary>

If you staged the LUMOS image in ECR (via `--type falcon-container --copy ...`), you don't need a pull secret at all — on Fargate, image pulls are authenticated by the **Fargate pod execution role**, not by an `imagePullSecret`. Just drop the `container.image.pullSecrets.*` flags and point the image at your ECR path. Ensure the pod execution role for your Fargate profiles has ECR read access — the default role `eksctl` creates includes `AmazonEKSFargatePodExecutionRolePolicy`, which already grants ECR pulls for same-account repositories:

```bash
helm upgrade --install falcon-lumos-injector crowdstrike/falcon-sensor \
  --namespace falcon-lumos-injector \
  --create-namespace \
  --set falcon.tags="eks-fargate" \
  --set falcon.cid=$FALCON_CID \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=$LUMOS_SENSOR_REGISTRY \
  --set container.image.tag=$LUMOS_SENSOR_IMAGE_TAG
```

> Note: IRSA (`serviceAccount` role annotations) does **not** authenticate image pulls on Fargate — that happens before the pod's service account token is available. Image-pull auth is always the pod execution role's job. IRSA is only for a running workload's AWS API calls.

</details>

### Step 2: Verify the injector is running on Fargate

- [ ] Confirm the injector pods are running (they should be on Fargate nodes):

```bash
kubectl get pods -n falcon-lumos-injector -o wide
```

- [ ] Verify the pull secret was propagated to the injected namespace (default path):

```bash
kubectl get secret -n detection-vulnapp | grep falcon
```

> ECR option: there's no pull secret to check — instead confirm an injected pod's sidecar image pulled successfully with `kubectl describe pod -n detection-vulnapp <pod> | grep -A2 falcon` (look for `Successfully pulled` and no `ImagePullBackOff`), which proves the Fargate pod execution role has ECR read.

- [ ] Confirm the mutating webhook is registered:

```bash
kubectl get mutatingwebhookconfigurations | grep falcon
```

---

## 6. Verify Full Hybrid Coverage

> **~10 min | Intermediate**

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
- `falcon-lumos-injector` — Sidecar injector pods (on Fargate)

### Step 2: Deploy the CrowdStrike vulnapp

> The `detection-vulnapp` namespace is already covered by the `app-workloads` Fargate profile created in Section 1 — no new profile is needed.

- [ ] Deploy the vulnapp into the Fargate-profiled namespace:

```bash
kubectl apply -n detection-vulnapp -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

- [ ] Give the pod a moment to schedule on Fargate (Fargate provisions a micro-VM per pod, so first start takes a bit longer than EC2).

### Step 3: Verify sidecar injection

- [ ] Confirm the Falcon sidecar was injected into the pod:

```bash
kubectl get pod -l run=vulnerable.example.com -n detection-vulnapp -o jsonpath='{.items[0].spec.containers[*].name}'
# Expected: vulnerable.example.com crowdstrike-falcon-container
```

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

> **~5 min | Beginner**

> **What & Why:** Removes all Falcon components and the test cluster to avoid ongoing AWS costs.

### Step 1: Uninstall Helm releases

- [ ] Remove both Falcon Helm releases:

```bash
helm uninstall falcon-lumos-injector -n falcon-lumos-injector
helm uninstall falcon-platform -n falcon-platform
```

### Step 2: Delete namespaces

- [ ] Clean up all Falcon namespaces:

```bash
kubectl delete namespace falcon-platform falcon-system falcon-kac falcon-image-analyzer falcon-lumos-injector
```

### Step 3: Delete the EKS cluster

- [ ] Remove the cluster:

```bash
eksctl delete cluster --name $CLUSTER_NAME --region $AWS_REGION
```

---

## Challenges

### Challenge 1: Namespace-scoped injection

Configure the sidecar injector to only inject into specific namespaces (not all Fargate pods). Hint: look at the `container.image.pullSecretName` and namespace selector annotations in the falcon-sensor chart values.

### Challenge 2: Verify coverage gaps

Deploy a pod into a namespace that has a Fargate profile but is NOT covered by the injector webhook. Confirm it runs without Falcon protection and identify how you'd detect this gap in the Falcon console.

### Challenge 3: ECR image rotation

Set up a CronJob that pulls the latest Falcon sensor images from CrowdStrike's registry and pushes them to your ECR repo, keeping your images up to date without manual intervention.

---

## Quick Reference

| Variable                    | Value                                          | Where Used                                                                                            |
| --------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `FALCON_CID`                | CID with checksum                              | Both Helm charts `falcon.cid` / `global.falcon.cid`                                                   |
| `FALCON_CLIENT_ID`          | API client ID                                  | IAR config                                                                                            |
| `FALCON_CLIENT_SECRET`      | API client secret                              | IAR config                                                                                            |
| `DAEMONSET_SENSOR_REGISTRY` | CrowdStrike (or ECR) repo for DaemonSet sensor | falcon-platform chart                                                                                 |
| `LUMOS_SENSOR_REGISTRY`     | CrowdStrike (or ECR) repo for sidecar sensor   | falcon-sensor chart (injector)                                                                        |
| `KAC_REGISTRY`              | CrowdStrike (or ECR) repo for KAC image        | falcon-platform chart                                                                                 |
| `IAR_REGISTRY`              | CrowdStrike (or ECR) repo for IAR image        | falcon-platform chart                                                                                 |
| `FALCON_PULL_TOKEN`         | Base64 registry pull token                     | Both charts: `global.containerRegistry.configJSON` / `container.image.pullSecrets.registryConfigJSON` |
| `CLUSTER_NAME`              | EKS cluster name                               | IAR cluster identification                                                                            |

</div>

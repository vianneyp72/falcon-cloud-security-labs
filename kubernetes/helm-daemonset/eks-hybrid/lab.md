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
> - Falcon sensor images pushed to your ECR repository (or pull token for CrowdStrike registry)
> - IRSA role for the sidecar injector (Terraform `enable_falcon_injector = true`)
> - Fargate profile covering `falcon-lumos-injector` namespace
> - ~30 minutes (Quick Deploy) / ~75 minutes (Full Lab)

## Reference Docs

| Source | Link |
|--------|------|
| falcon-platform Helm chart (GitHub) | https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-platform |
| falcon-sensor Helm chart (Injector) | https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-sensor |
| EKS Fargate Pod Execution Role | https://docs.aws.amazon.com/eks/latest/userguide/fargate-pod-configuration.html |
| IRSA (IAM Roles for Service Accounts) | https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html |
| Deploy Falcon Sensor via Helm (Docs) | https://docs.crowdstrike.com/r/en-US/qg0ygdwl/l303c850 |

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

| Compute | Protection method | Mechanism |
|---------|------------------|-----------|
| EC2 nodes | DaemonSet sensor | 1 pod per node, eBPF kernel probes |
| Fargate pods | Sidecar injection | Mutating webhook adds sensor container |
| KAC/IAR | Deploy to EC2 | Stateless, land on EC2 (no Fargate profile needed) |

### IRSA for the injector

The sidecar injector needs to pull the Falcon sensor image from ECR at injection time. Instead of storing AWS credentials as secrets, IRSA (IAM Roles for Service Accounts) maps a Kubernetes service account to an IAM role via OIDC federation. The Terraform workspace creates this role automatically when `enable_falcon_injector = true`.

```
EKS HYBRID CLUSTER (EC2 + Fargate)
Image Registry (CRWD or Customer): LUMOS Sensor Image, DaemonSet Sensor Image
Fargate-Node-1: App-Pod-1 (LUMOS sidecar), App-Pod-2 (LUMOS sidecar), sensor injector
EC2-Node-1: App-Pod-3, App-Pod-4, Falcon DaemonSet Sensor
EC2-Node-2: App-Pod-5, App-Pod-6, Falcon DaemonSet Sensor
DaemonSet: deploys sensor pod to each EC2 node
Notes: 2 Helm charts, 2 sensor images, Fargate profiles needed, IRSA role needed
```

---

## Deployment Steps

<div data-mode="guide">

### 1. Set credentials and image variables

```bash
export FALCON_CID=<YOUR_FALCON_CID>
export FCS_SENSOR_API_CLIENT_ID=<YOUR_CLIENT_ID>
export FCS_SENSOR_API_CLIENT_SECRET=<YOUR_CLIENT_SECRET>
export CLUSTER_NAME=<YOUR_CLUSTER_NAME>

export DAEMONSET_SENSOR_REGISTRY=<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/<REPO>
export DAEMONSET_SENSOR_IMAGE_TAG=falcon-daemonset-sensor-latest
export LUMOS_SENSOR_REGISTRY=<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/<REPO>
export LUMOS_SENSOR_IMAGE_TAG=falcon-lumos-sensor-latest
export KAC_REGISTRY=<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/<REPO>
export KAC_IMAGE_TAG=falcon-kac-latest
export IAR_REGISTRY=<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/<REPO>
export IAR_IMAGE_TAG=falcon-iar-latest
export IAM_ROLE_ARN=<YOUR_FALCON_INJECTOR_ROLE_ARN>
export ENCODED_DOCKER_CONFIG=<your-base64-encoded-docker-config>
```

### 2. Add Helm repo

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update
```

### 3. Deploy DaemonSet sensor with KAC and IAR

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set createComponentNamespaces=true \
  --set global.falcon.cid=$FALCON_CID \
  --set global.containerRegistry.configJSON=$ENCODED_DOCKER_CONFIG \
  --set falcon-sensor.node.image.repository=$DAEMONSET_SENSOR_REGISTRY \
  --set falcon-sensor.node.image.tag=$DAEMONSET_SENSOR_IMAGE_TAG \
  --set falcon-kac.image.repository=$KAC_REGISTRY \
  --set falcon-kac.image.tag=$KAC_IMAGE_TAG \
  --set falcon-image-analyzer.deployment.enabled=true \
  --set falcon-image-analyzer.image.repository=$IAR_REGISTRY \
  --set falcon-image-analyzer.image.tag=$IAR_IMAGE_TAG \
  --set falcon-image-analyzer.crowdstrikeConfig.clusterName=$CLUSTER_NAME \
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=$FCS_SENSOR_API_CLIENT_ID \
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FCS_SENSOR_API_CLIENT_SECRET
```

### 4. Deploy sidecar injector (Fargate pods)

```bash
helm upgrade --install falcon-lumos-injector crowdstrike/falcon-sensor \
  --namespace falcon-lumos-injector \
  --create-namespace \
  --set falcon.cid=$FALCON_CID \
  --set falcon.tags="eks-fargate" \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=$LUMOS_SENSOR_REGISTRY \
  --set container.image.tag=$LUMOS_SENSOR_IMAGE_TAG \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$IAM_ROLE_ARN
```

### 5. Verify

```bash
kubectl get pods -A | grep falcon
```

Expected namespaces: `falcon-system` (DaemonSet), `falcon-kac`, `falcon-image-analyzer`, `falcon-lumos-injector` (sidecar injector).

Test sidecar injection on a Fargate pod:

```bash
kubectl run test-nginx --image=nginx -n detection-vulnapp
kubectl wait --for=condition=Ready pod/test-nginx -n detection-vulnapp --timeout=120s
kubectl get pod test-nginx -n detection-vulnapp -o jsonpath='{.spec.containers[*].name}'
# Should show: test-nginx crowdstrike-falcon-container
kubectl delete pod test-nginx -n detection-vulnapp
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

> **What & Why:** The Falcon sensor images must be accessible to the cluster. In EKS, images are typically staged in ECR. You also need API credentials for IAR's vulnerability reporting and a pull token (or ECR auth) for the DaemonSet sensor.

### Step 1: Set API credentials

- [ ] Export your Falcon API credentials:

```bash
export FALCON_CID=<YOUR_FALCON_CID>
export FCS_SENSOR_API_CLIENT_ID=<YOUR_CLIENT_ID>
export FCS_SENSOR_API_CLIENT_SECRET=<YOUR_CLIENT_SECRET>
```

### Step 2: Set image references

- [ ] Set image registries and tags for all components:

```bash
export DAEMONSET_SENSOR_REGISTRY=<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/<REPO>
export DAEMONSET_SENSOR_IMAGE_TAG=falcon-daemonset-sensor-latest
export LUMOS_SENSOR_REGISTRY=<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/<REPO>
export LUMOS_SENSOR_IMAGE_TAG=falcon-lumos-sensor-latest
export KAC_REGISTRY=<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/<REPO>
export KAC_IMAGE_TAG=falcon-kac-latest
export IAR_REGISTRY=<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/<REPO>
export IAR_IMAGE_TAG=falcon-iar-latest
export CLUSTER_NAME=falcon-hybrid-lab
```

### Step 3: Get the IRSA role ARN

- [ ] Retrieve the IAM role ARN for the sidecar injector service account:

```bash
export IAM_ROLE_ARN=$(cd ~/projects/falcon-cloud-security-labs-workspace/kubernetes/helm-daemonset/eks-hybrid && terraform output -raw falcon_injector_role_arn)
echo "IAM Role ARN: $IAM_ROLE_ARN"
```

### Step 4: Set registry auth (if pulling from CrowdStrike)

- [ ] If pulling images from CrowdStrike's registry (not ECR), set the pull token:

```bash
export ENCODED_DOCKER_CONFIG=<your-base64-encoded-docker-config>
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

- [ ] Deploy with all component configurations:

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform \
  --namespace falcon-platform \
  --create-namespace \
  --set createComponentNamespaces=true \
  --set global.falcon.cid=$FALCON_CID \
  --set global.containerRegistry.configJSON=$ENCODED_DOCKER_CONFIG \
  --set falcon-sensor.node.image.repository=$DAEMONSET_SENSOR_REGISTRY \
  --set falcon-sensor.node.image.tag=$DAEMONSET_SENSOR_IMAGE_TAG \
  --set falcon-kac.image.repository=$KAC_REGISTRY \
  --set falcon-kac.image.tag=$KAC_IMAGE_TAG \
  --set falcon-image-analyzer.deployment.enabled=true \
  --set falcon-image-analyzer.image.repository=$IAR_REGISTRY \
  --set falcon-image-analyzer.image.tag=$IAR_IMAGE_TAG \
  --set falcon-image-analyzer.crowdstrikeConfig.clusterName=$CLUSTER_NAME \
  --set falcon-image-analyzer.crowdstrikeConfig.clientID=$FCS_SENSOR_API_CLIENT_ID \
  --set falcon-image-analyzer.crowdstrikeConfig.clientSecret=$FCS_SENSOR_API_CLIENT_SECRET
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

> **What & Why:** Fargate pods have no host to run a DaemonSet on. The sidecar injector is a mutating admission webhook — when a pod is created in a Fargate-profiled namespace, the webhook intercepts the request and injects the Falcon sensor as an additional container in the pod spec. IRSA provides ECR pull credentials without storing secrets.

### Step 1: Deploy the injector

- [ ] Install the `falcon-sensor` chart in injector mode:

```bash
helm upgrade --install falcon-lumos-injector crowdstrike/falcon-sensor \
  --namespace falcon-lumos-injector \
  --create-namespace \
  --set falcon.cid=$FALCON_CID \
  --set falcon.tags="eks-fargate" \
  --set node.enabled=false \
  --set container.enabled=true \
  --set container.image.repository=$LUMOS_SENSOR_REGISTRY \
  --set container.image.tag=$LUMOS_SENSOR_IMAGE_TAG \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$IAM_ROLE_ARN
```

> `node.enabled=false` disables the DaemonSet (already covered by falcon-platform). `container.enabled=true` activates the sidecar injector mode.

### Step 2: Verify the injector is running on Fargate

- [ ] Confirm the injector pods are running (they should be on Fargate nodes):

```bash
kubectl get pods -n falcon-lumos-injector -o wide
```

- [ ] Verify the IRSA annotation is set:

```bash
kubectl get sa crowdstrike-falcon-sa -n falcon-lumos-injector -o jsonpath='{.metadata.annotations.eks\.amazonaws\.com/role-arn}'
```

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

### Step 2: Test sidecar injection

- [ ] Deploy a test pod into a Fargate-profiled namespace:

```bash
kubectl run test-nginx --image=nginx -n detection-vulnapp
kubectl wait --for=condition=Ready pod/test-nginx -n detection-vulnapp --timeout=120s
```

- [ ] Verify the Falcon sidecar was injected:

```bash
kubectl get pod test-nginx -n detection-vulnapp -o jsonpath='{.spec.containers[*].name}'
# Expected: test-nginx crowdstrike-falcon-container
```

- [ ] Check the DaemonSet sensor logs on EC2:

```bash
kubectl logs -n falcon-system -l app.kubernetes.io/name=falcon-sensor --tail=20
```

### Step 3: Verify in Falcon console

- [ ] Navigate to **Falcon Console** > **Host management** > **Hosts**
- [ ] Filter by cluster name — you should see both EC2 node hosts and Fargate pod hosts

### Step 4: Clean up the test pod

- [ ] Remove the test pod:

```bash
kubectl delete pod test-nginx -n detection-vulnapp
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

| Variable | Value | Where Used |
|----------|-------|------------|
| `FALCON_CID` | CID with checksum | Both Helm charts `falcon.cid` / `global.falcon.cid` |
| `FCS_SENSOR_API_CLIENT_ID` | API client ID | IAR config |
| `FCS_SENSOR_API_CLIENT_SECRET` | API client secret | IAR config |
| `DAEMONSET_SENSOR_REGISTRY` | ECR repo for DaemonSet sensor | falcon-platform chart |
| `LUMOS_SENSOR_REGISTRY` | ECR repo for sidecar sensor | falcon-sensor chart (injector) |
| `KAC_REGISTRY` | ECR repo for KAC image | falcon-platform chart |
| `IAR_REGISTRY` | ECR repo for IAR image | falcon-platform chart |
| `IAM_ROLE_ARN` | IRSA role for ECR pull | falcon-sensor chart service account annotation |
| `ENCODED_DOCKER_CONFIG` | Base64 registry auth | falcon-platform `global.containerRegistry.configJSON` |
| `CLUSTER_NAME` | EKS cluster name | IAR cluster identification |

</div>

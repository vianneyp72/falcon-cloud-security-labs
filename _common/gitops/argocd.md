# Falcon Deployment - Method 4: ArgoCD GitOps (Helm)

Deploy the full CrowdStrike Falcon Platform via ArgoCD using the app-of-apps pattern. ArgoCD pulls the `falcon-platform` Helm chart directly from the CrowdStrike registry and auto-syncs on Git push.

https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-platform

## Components Deployed

✅ **Falcon Sensor** (DaemonSet) - Runs on all EC2 nodes
✅ **Falcon KAC** (Deployment) - Kubernetes Admission Controller
✅ **Falcon Image Analyzer** (Deployment) - Container image scanning

## How It Works

- **ArgoCD Application CRD** (`apps/falcon-platform.yaml`) points directly at the `crowdstrike/falcon-platform` Helm chart v1.0.0 — no chart files stored in Git.
- **Non-sensitive values** (image repos, tags, cluster name, feature flags) live in `valuesObject` inline in the Application CRD.
- **Sensitive values** (CID, API credentials) are read by the chart at runtime via `global.falconSecret` from a K8s Secret named `falcon-credentials`.
- **App-of-apps** auto-discovers `falcon-platform.yaml` when it lands in the `apps/` directory — no manual `kubectl apply` needed after initial setup.
- **Auto-sync** with prune and selfHeal ensures the cluster always matches Git. Manual drift is corrected automatically.

## Prerequisites

- EKS cluster running in `compute_mode = "pure-ec2"`
- ArgoCD installed on the cluster (see ArgoCD setup below)
- CrowdStrike Falcon credentials (CID, API keys)
- kubectl configured for the cluster
- Falcon container images pulled to ECR (run `./falcon-container-sensor-pull.sh`)

## ArgoCD Setup (One-Time)

If ArgoCD is not yet installed on the cluster, follow these steps first.

### 1. Clone the GitOps repo

```bash
cd ~/projects
git clone git@github.com:vianneyp72/cs-demo-argocd.git
cd cs-demo-argocd
```

### 2. Install ArgoCD via Helm

```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
kubectl create namespace argocd
helm install argocd argo/argo-cd \
  --namespace argocd \
  -f argocd-install/values.yaml \
  --wait
```

The values file configures a non-HA lab install: Dex/notifications disabled, `--insecure` for port-forward access, resource limits sized for t3.medium nodes.

### 3. Configure private repo access (SSH deploy key)

```bash
# Generate deploy key
ssh-keygen -t ed25519 -C "argocd-deploy-key" -f ~/.ssh/argocd-deploy-key -N ""

# Add public key to GitHub (read-only)
# Go to https://github.com/vianneyp72/cs-demo-argocd/settings/keys
cat ~/.ssh/argocd-deploy-key.pub

# Register repo in ArgoCD
kubectl create secret generic repo-cs-demo-argocd \
  --namespace argocd \
  --from-file=sshPrivateKey=$HOME/.ssh/argocd-deploy-key \
  --from-literal=type=git \
  --from-literal=url=git@github.com:vianneyp72/cs-demo-argocd.git
kubectl label secret repo-cs-demo-argocd -n argocd \
  argocd.argoproj.io/secret-type=repository
```

### 4. Bootstrap the app-of-apps

```bash
kubectl apply -f apps/app-of-apps.yaml
```

### 5. Access ArgoCD UI

```bash
# Get admin password
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d; echo

# Port-forward
kubectl port-forward svc/argocd-server -n argocd 8080:443
```

Open http://localhost:8080, login as `admin`.

## Falcon Platform Deployment Steps

### 1. Register the CrowdStrike Helm repo in ArgoCD

```bash
cd ~/projects/cs-demo-argocd
kubectl apply -f manifests/falcon-platform/crowdstrike-helm-repo.yaml
```

This creates a Secret in the `argocd` namespace that tells ArgoCD where to find the CrowdStrike Helm charts.

### 2. Create the namespaces

The umbrella chart deploys sub-charts to separate namespaces. Create them so the secrets have somewhere to land:

```bash
kubectl create namespace falcon-platform
kubectl create namespace falcon-system
kubectl create namespace falcon-kac
kubectl create namespace falcon-image-analyzer
```

### 3. Create the Falcon credentials secret

Edit `manifests/falcon-platform/falcon-credentials.yaml` and replace the placeholders with your real values:

- `<YOUR_FALCON_CID>` — CrowdStrike Customer ID (e.g. `AAAABBBBCCCCDDDDEEEEFFFFGGGGHHH1-00`)
- `<YOUR_API_CLIENT_ID>` — Falcon API client ID (for Image Analyzer)
- `<YOUR_API_CLIENT_SECRET>` — Falcon API client secret

Then apply:

```bash
kubectl apply -f manifests/falcon-platform/falcon-credentials.yaml
```

This creates the `falcon-credentials` Secret in all four namespaces:

| Namespace | Purpose |
|-----------|---------|
| `falcon-platform` | CID + API creds for the umbrella chart |
| `falcon-system` | CID for the DaemonSet sensor |
| `falcon-kac` | CID for the admission controller |
| `falcon-image-analyzer` | CID + API creds for image scanning |

> **Note:** `falcon-credentials.yaml` is gitignored — it contains secrets and should never be committed.

### 4. Push to Git (if not already pushed)

If `apps/falcon-platform.yaml` is not yet in the repo:

```bash
cd ~/projects/cs-demo-argocd
git add apps/falcon-platform.yaml
git commit -m "Add Falcon Platform ArgoCD Application"
git push origin main
```

The app-of-apps will auto-discover and sync the Falcon Platform. To force an immediate sync:

```bash
kubectl annotate application app-of-apps -n argocd argocd.argoproj.io/refresh=hard --overwrite
```

### 4. Verify Deployment

Check ArgoCD sync status:

```bash
kubectl get applications -n argocd
```

Expected:

```
NAME              SYNC STATUS   HEALTH STATUS
app-of-apps       Synced        Healthy
falcon-platform   Synced        Healthy
sample-nginx      Synced        Healthy
```

Check all Falcon pods:

```bash
kubectl get pods -A | grep falcon
```

Expected:
- `falcon-system` — DaemonSet sensor pods (one per EC2 node)
- `falcon-kac` — KAC deployment pod (3 containers)
- `falcon-image-analyzer` — IAR deployment pod

## GitOps Repo Structure

```
cs-demo-argocd/                          # https://github.com/vianneyp72/cs-demo-argocd
├── argocd-install/
│   └── values.yaml                      # ArgoCD Helm values (non-HA, lab-sized)
├── apps/
│   ├── app-of-apps.yaml                 # Root Application (watches this directory)
│   ├── falcon-platform.yaml             # Falcon Platform Helm Application
│   └── sample-nginx.yaml                # Sample app for testing GitOps loop
└── manifests/
    ├── falcon-platform/
    │   ├── crowdstrike-helm-repo.yaml   # Registers CrowdStrike Helm repo in ArgoCD
    │   └── falcon-credentials.yaml      # Falcon secrets (gitignored, fill in and kubectl apply)
    └── sample-nginx/
        ├── namespace.yaml
        ├── deployment.yaml
        └── service.yaml
```

## Key Details

- **Chart**: `crowdstrike/falcon-platform` v1.0.0 from `https://crowdstrike.github.io/falcon-helm`
- **Secret mechanism**: `global.falconSecret.enabled=true` with `secretName: falcon-credentials` — the chart reads CID and API creds from K8s Secret keys (`FALCONCTL_OPT_CID`, `AGENT_CLIENT_ID`, `AGENT_CLIENT_SECRET`)
- **IAR schema requirement**: `falcon-image-analyzer.crowdstrikeConfig.cid` must be set in the Application CRD even when using `falconSecret` — the sub-chart's JSON schema validates it at template time
- **Sync options**: `ServerSideApply=true` is needed for the Falcon chart's CRDs and large manifests
- **Namespaces**: `createComponentNamespaces=true` spreads components into `falcon-system`, `falcon-kac`, `falcon-image-analyzer`

## Teardown

Remove the Falcon deployment by deleting the Application file from Git:

```bash
cd ~/projects/cs-demo-argocd
git rm apps/falcon-platform.yaml
git commit -m "Remove Falcon Platform"
git push origin main
```

ArgoCD's prune policy will delete all Falcon resources from the cluster. To also clean up the secrets:

```bash
for NS in falcon-platform falcon-system falcon-kac falcon-image-analyzer; do
  kubectl delete secret falcon-credentials -n $NS --ignore-not-found
  kubectl delete namespace $NS --ignore-not-found
done
kubectl delete secret crowdstrike-helm-repo -n argocd --ignore-not-found
```

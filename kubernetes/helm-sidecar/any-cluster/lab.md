# Falcon Deployment - GKE DaemonSet on GCE Nodes

Deploy the full CrowdStrike Falcon Platform on GKE using DaemonSet approach with images stored in Google Artifact Registry.

https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-platform
falcon docs portal https://docs.crowdstrike.com/r/en-US/qg0ygdwl/l303c850

## Components Deployed

- **Falcon Sensor** (DaemonSet) - Runs on all GCE nodes
- **Falcon KAC** (Deployment) - Kubernetes Admission Controller
- **Falcon Image Analyzer** (Deployment) - Container image scanning

## Prerequisites

- GKE cluster running with GCE node pools
- CrowdStrike Falcon API credentials (CID, Client ID + Secret)
  - Required API scopes: **Falcon Images Download** (Read), **Sensor Download** (Read), **Falcon Container Image** (Read/Write)
- Helm 3 installed
- kubectl configured for the cluster
- `gcloud auth configure-docker <YOUR_GCP_REGION>-docker.pkg.dev` (Artifact Registry auth)

```bash
export FALCON_CLIENT_ID="<YOUR_FALCON_CLIENT_ID>"
export FALCON_CLIENT_SECRET="<YOUR_FALCON_CLIENT_SECRET>"
```

## Deployment Steps

### 1. Pull Falcon sensor images to Artifact Registry

> **Note:** Do NOT use `--copy-omit-image-name`. GAR requires an image name in the path:
> `REGION-docker.pkg.dev/PROJECT/REPO/IMAGE:TAG`

```bash
./falcon-container-sensor-pull.sh \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --copy <YOUR_GCP_REGION>-docker.pkg.dev/<YOUR_GCP_PROJECT_ID>/<YOUR_GAR_REPO> \
  --copy-custom-tag "falcon-daemonset-sensor-latest"
```

```bash
./falcon-container-sensor-pull.sh \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-kac \
  --copy <YOUR_GCP_REGION>-docker.pkg.dev/<YOUR_GCP_PROJECT_ID>/<YOUR_GAR_REPO> \
  --copy-custom-tag "falcon-kac-latest"
```

```bash
./falcon-container-sensor-pull.sh \
  --client-id $FALCON_CLIENT_ID \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-imageanalyzer \
  --copy <YOUR_GCP_REGION>-docker.pkg.dev/<YOUR_GCP_PROJECT_ID>/<YOUR_GAR_REPO> \
  --copy-custom-tag "falcon-iar-latest"
```

### 2. Set environment variables

> **Important:** The `*_REGISTRY` vars must include the image name in the path (e.g. `.../falcon-sensor`).
> The helm chart constructs `{repository}:{tag}` — it does NOT append an image name automatically.

```bash
export FALCON_CID=<YOUR_FALCON_CID>
export CLUSTER_NAME=<YOUR_CLUSTER_NAME>

export DAEMONSET_SENSOR_REGISTRY=<YOUR_GCP_REGION>-docker.pkg.dev/<YOUR_GCP_PROJECT_ID>/<YOUR_GAR_REPO>/falcon-sensor
export DAEMONSET_SENSOR_IMAGE_TAG=falcon-daemonset-sensor-latest
export KAC_REGISTRY=<YOUR_GCP_REGION>-docker.pkg.dev/<YOUR_GCP_PROJECT_ID>/<YOUR_GAR_REPO>/falcon-kac
export KAC_IMAGE_TAG=falcon-kac-latest
export IAR_REGISTRY=<YOUR_GCP_REGION>-docker.pkg.dev/<YOUR_GCP_PROJECT_ID>/<YOUR_GAR_REPO>/falcon-imageanalyzer
export IAR_IMAGE_TAG=falcon-iar-latest
```

### 3. Add Falcon Helm repository

```bash
helm repo add crowdstrike https://crowdstrike.github.io/falcon-helm
helm repo update
```

### 4. Deploy the Helm chart

```bash
helm upgrade --install falcon-platform crowdstrike/falcon-platform --version 1.0.0 \
  --namespace falcon-platform \
  --create-namespace \
  --set createComponentNamespaces=true \
  --set global.falcon.cid=$FALCON_CID \
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

> `createComponentNamespaces=true` places KAC in `falcon-kac` and IAR in `falcon-image-analyzer` namespaces.

### 5. Verify deployment

```bash
kubectl get pods -n falcon-system
kubectl get pods -n falcon-kac
kubectl get pods -n falcon-image-analyzer
```

## GAR vs ECR — Key Difference

|                          | ECR                                             | GAR                                            |
| ------------------------ | ----------------------------------------------- | ---------------------------------------------- |
| Image path               | `account.dkr.ecr.region.amazonaws.com/repo:tag` | `region-docker.pkg.dev/project/repo/image:tag` |
| Repo = image?            | Yes — repo name IS the image                    | No — repo contains multiple images             |
| `--copy-omit-image-name` | Works                                           | Do NOT use                                     |
| `*_REGISTRY` var         | `account.dkr.ecr.region.amazonaws.com/repo`     | `region-docker.pkg.dev/project/repo/image`     |

# CrowdStrike Falcon Sensor for Kubernetes

Download the CrowdStrike Falcon sensor images to customer image repository and deploy using one of the following methods:

- **1-daemonset-ec2**: DaemonSet deployment for EC2 nodes
- **2-daemonset&injector-hybrid**: Hybrid deployment with DaemonSet and Sidecar Injector
- **3-injector-fargate**: Sidecar Injector deployment for Fargate

## Download Falcon Images

### Prerequisites

Set your CrowdStrike API credentials:

Required Scopes:

- Falcon Container Image: Read & Write
- Falcon Images Download: Read
- Sensor Download: Read

```bash
export FCS_SENSOR_API_CLIENT_ID="INSERT_API_CLIENT_ID"
export FCS_SENSOR_API_CLIENT_SECRET="INSERT_API_CLIENT_SECRET"
export AWS_ECR_URI="INSERT_AWS_ECR_URI"
```

Authenticate to image repository

### 1. Pull Falcon Sensor Image ("falcon-sensor" for daemonset, "falcon-container" for injector sidecar)

#### Falcon Sensor Image For Daemonset Into ECR

```bash
./falcon-container-sensor-pull.sh \
  --client-id $FCS_SENSOR_API_CLIENT_ID \
  --client-secret $FCS_SENSOR_API_CLIENT_SECRET \
  --type falcon-sensor \
  --copy $AWS_ECR_URI \
  --copy-omit-image-name \
  --copy-custom-tag "falcon-daemonset-sensor-latest"
```

#### Falcon Sensor Image For Injector Sidecar Into ECR

```bash
./falcon-container-sensor-pull.sh \
  --client-id $FCS_SENSOR_API_CLIENT_ID \
  --client-secret $FCS_SENSOR_API_CLIENT_SECRET \
  --type falcon-container \
  --copy $AWS_ECR_URI \
  --copy-omit-image-name \
  --copy-custom-tag "falcon-lumos-sensor-latest"
```

### 2. Pull Falcon Kubernetes Admission Controller (KAC) Image Into ECR

```bash
./falcon-container-sensor-pull.sh \
  --client-id $FCS_SENSOR_API_CLIENT_ID \
  --client-secret $FCS_SENSOR_API_CLIENT_SECRET \
  --type falcon-kac \
  --copy $AWS_ECR_URI \
  --copy-omit-image-name \
  --copy-custom-tag "falcon-kac-latest"
```

### 3. Pull Falcon Image Analyzer (IAR) Image Into ECR

```bash
./falcon-container-sensor-pull.sh \
  --client-id $FCS_SENSOR_API_CLIENT_ID \
  --client-secret $FCS_SENSOR_API_CLIENT_SECRET \
  --type falcon-imageanalyzer \
  --copy $AWS_ECR_URI \
  --copy-omit-image-name \
  --copy-custom-tag "falcon-iar-latest"
```

## Optional: Pull Directly from CrowdStrike Registry instead of into ECR

Skip the ECR copy and pull images straight from `registry.crowdstrike.com` at deploy time.

### 1. Get your pull token (JWT)

```bash
./falcon-container-sensor-pull.sh \
  --client-id ${FCS_SENSOR_API_CLIENT_ID} \
  --client-secret ${FCS_SENSOR_API_CLIENT_SECRET} \
  --type falcon-sensor \
  --get-pull-token
```

### 2. Save pull token (JWT) to env

```bash
export FALCON_IMAGE_PULL_TOKEN="INSERT_PULL_TOKEN_JWT"
```

### 3. Get the image path

```bash
./falcon-container-sensor-pull.sh \
  --client-id ${FCS_SENSOR_API_CLIENT_ID} \
  --client-secret ${FCS_SENSOR_API_CLIENT_SECRET} \
  --type falcon-sensor \
  --get-image-path
```

```bash
export FALCON_IMAGE_REPO="INSERT_CS_REGISTRY_URI"
export FALCON_IMAGE_TAG="INSERT_CS_IMAGE_TAG"
export CLUSTER_NAME="INSERT_CLUSTER_NAME"
```

### 4. Pass into helm install

```bash
helm install falcon-sensor crowdstrike/falcon-sensor \
  -n falcon-platform \
  --set falcon.cid=$FALCON_CID \
  --set node.image.repository=$FALCON_IMAGE_REPO \
  --set node.image.tag=$FALCON_IMAGE_TAG \
  --set node.image.registryConfigJSON=$FALCON_IMAGE_PULL_TOKEN \
  --set node.clusterName=$CLUSTER_NAME
```

## Deployment Methods

After downloading the images, refer to the specific deployment method directories for installation instructions:

- [1-helm-daemon-ec2](./1-helm-daemon-ec2.md) - Full platform deployment on EC2 nodes
- [2-daemonset&injector-hybrid](./2-daemonset&injector-hybrid.md) - Hybrid approach for mixed workloads
- [3-helm-sidecar-fargate](./3-helm-sidecar-fargate.md) - Sidecar injection for Fargate workloads

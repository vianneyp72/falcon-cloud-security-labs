# Falcon Container Sensor Deployment — ECS Fargate (Task Definition Patching)

Deploy the CrowdStrike Falcon Container Sensor for Linux on AWS ECS Fargate using the task definition patching utility.

Official Docs: https://docs.crowdstrike.com/r/en-US/iopiipqy/ba83eb6c

Official GH: https://github.com/CrowdStrike/falcon-scripts/tree/main/bash/containers/falcon-container-sensor-pull

Igor GH: https://github.com/igorschultz/container-sensor-ecs-fargate/tree/main

## How It Works

The patching utility modifies your ECS task definition to inject the Falcon sensor:

- **Init container** (`crowdstrike-falcon-init-container`) copies sensor binaries to a shared volume
- **Entrypoint override** on each app container starts the Falcon sensor before the app
- **Shared volume** (`crowdstrike-falcon-volume`) mounted at `/tmp/CrowdStrike`
- **`SYS_PTRACE`** capability added to monitored containers

## Image Architecture

There are **two images** involved in ECS task definition patching:

| Image                   | What it is                             | Role in patched task                                                         |
| ----------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| **Falcon sensor image** | CrowdStrike's `falcon-container` image | Becomes the `crowdstrike-falcon-init-container` that injects sensor binaries |
| **App image**           | Your application container             | The container being protected by the sensor                                  |

These images can live in **different registries**. The recommended setup for most customers:

| Component    | Where to store                                             | ECS runtime auth                                    |
| ------------ | ---------------------------------------------------------- | --------------------------------------------------- |
| Sensor image | ECR (same AWS account)                                     | Automatic via task execution role IAM — zero config |
| App image    | Customer's existing repo (JFrog, Quay, Harbor, GHCR, etc.) | `repositoryCredentials` → Secrets Manager           |

> **Why this works well:** Most customers already have their app images in a private registry outside ECR. Putting the sensor image in ECR (same account) means ECS pulls it automatically with no extra auth. The app image stays where it already is.

> **Important:** At **patch time**, the patching utility needs access to BOTH registries — it reads the sensor image and queries your app image for its entrypoint/command metadata. The `-pulltoken` must contain credentials for all registries referenced in the task definition.

## Prerequisites

- AWS CLI configured with ECS permissions
- Docker installed locally (to run the patching utility)
- CrowdStrike Falcon API credentials (CID, Client ID + Secret)
  - Required API scopes: **Falcon Images Download** (Read), **Sensor Download** (Read)
- Existing ECS Fargate task definition JSON file
- A container registry for hosting the sensor image (ECR recommended, or any OCI-compliant registry)
- **ECS task execution role** with permissions to pull images at runtime (see below)

### ECS Task Execution Role

Your ECS task definition must reference an execution role that allows ECS to pull container images on your behalf. If you already have tasks pulling from ECR, this is likely already set up.

**Minimum permissions for ECR (sensor image):**

Attach the AWS managed policy `AmazonECSTaskExecutionRolePolicy`, or add these permissions:

```json
{
  "Effect": "Allow",
  "Action": [
    "ecr:GetAuthorizationToken",
    "ecr:BatchCheckLayerAvailability",
    "ecr:GetDownloadUrlForLayer",
    "ecr:BatchGetImage"
  ],
  "Resource": "*"
}
```

**Additional permissions if app images are in a private registry (JFrog, Quay, etc.):**

```json
{
  "Effect": "Allow",
  "Action": "secretsmanager:GetSecretValue",
  "Resource": "arn:aws:secretsmanager:<region>:<account-id>:secret:<your-registry-creds-secret>"
}
```

**Verify the role is referenced in your task definition:**

```json
{
  "executionRoleArn": "arn:aws:iam::<account-id>:role/ecsTaskExecutionRole",
  ...
}
```

> **Note:** If your task definition doesn't have `executionRoleArn`, ECS won't be able to pull from ECR or access Secrets Manager. This is the most common cause of "CannotPullContainerError" at task launch.

```bash
export FALCON_CLIENT_ID="<YOUR_FALCON_CLIENT_ID>"
export FALCON_CLIENT_SECRET="<YOUR_FALCON_CLIENT_SECRET>"
export AWS_REGION=<your_aws_region>
export FALCON_CID=<your_cid_with_checksum>
export TASK_FAMILY=<your_task_family_name>
```

## Deployment Steps

### 1. Get your CrowdStrike CID with checksum

In the Falcon console: **Host setup and management > Deploy > Sensor downloads**. Copy the CID with checksum (already exported above as `$FALCON_CID`).

### 2. Pull the Falcon Container sensor image

```bash
export LATESTSENSOR=$(bash <(curl -Ls https://github.com/CrowdStrike/falcon-scripts/releases/latest/download/falcon-container-sensor-pull.sh) \
  -t falcon-container \
  --platform x86_64 | tail -1) && echo $LATESTSENSOR
```

### 3. Push the sensor image to your registry

Choose **one** of the following options based on your image registry.

---

#### Option A: Push to AWS ECR

```bash
aws ecr create-repository \
  --repository-name falcon-sensor/falcon-container \
  --region $AWS_REGION

export SENSOR_IMAGE_REPO=$(aws ecr describe-repositories \
  --repository-name falcon-sensor/falcon-container | \
  jq -r '.repositories[].repositoryUri' | tail -1) && echo $SENSOR_IMAGE_REPO

docker tag "$LATESTSENSOR" "$SENSOR_IMAGE_REPO":latest
docker push "$SENSOR_IMAGE_REPO":latest
```

---

#### Option B: Push to a private registry (Quay, JFrog Artifactory, Harbor, etc.)

This method works with any OCI-compliant container registry. You can either:

1. Pull locally first, then tag and push (shown below)
2. Use the pull script's `--copy` flag to copy directly to the registry (shown in the alternative at the end)

**Log in to your registry:**

```bash
# Quay.io example:
docker login quay.io

# JFrog Artifactory example:
docker login <your-artifactory-instance>.jfrog.io

# Harbor example:
docker login harbor.example.com
```

**Tag and push:**

```bash
export SENSOR_IMAGE_REPO=<your-registry>/<namespace>/falcon-container
# Examples:
#   quay.io/myorg/falcon-container
#   mycompany.jfrog.io/docker-local/falcon-container
#   harbor.example.com/crowdstrike/falcon-container

docker tag "$LATESTSENSOR" "$SENSOR_IMAGE_REPO":latest
docker push "$SENSOR_IMAGE_REPO":latest
```

**Alternative — use the pull script's `--copy` flag to skip the local pull entirely:**

```bash
bash <(curl -Ls https://github.com/CrowdStrike/falcon-scripts/releases/latest/download/falcon-container-sensor-pull.sh) \
  -t falcon-container \
  --platform x86_64 \
  --copy <your-registry>/<namespace>

# Examples:
#   --copy quay.io/myorg
#   --copy mycompany.jfrog.io/docker-local
#   --copy harbor.example.com/crowdstrike
```

The `--copy` flag pulls from the CrowdStrike registry and pushes directly to your destination. By default, the image name and tag are appended (e.g., `quay.io/myorg/falcon-container:7.x.x`).

Additional `--copy` options:

- `--copy-omit-image-name` — don't append the sensor image name to the destination path
- `--copy-custom-tag <TAG>` — use a custom tag instead of the version tag
- `--runtime skopeo` — use Skopeo instead of Docker (recommended for multi-arch images)

```bash
# Example: copy to exact path with custom tag using skopeo
bash <(curl -Ls https://github.com/CrowdStrike/falcon-scripts/releases/latest/download/falcon-container-sensor-pull.sh) \
  -t falcon-container \
  --copy mycompany.jfrog.io/docker-local/crowdstrike-falcon \
  --copy-omit-image-name \
  --copy-custom-tag latest \
  --runtime skopeo
```

After copying, set the repo variable for subsequent steps:

```bash
export SENSOR_IMAGE_REPO=<your-registry>/<namespace>/falcon-container
```

---

### 4. Create a pull token for registry authentication

The patching utility needs a pull token to access **all images** referenced in the task definition — both the sensor image and your app images. If your app images are in a private registry (JFrog, Quay, etc.), the pull token must include creds for that registry too.

> **Warning: Docker Desktop credential helpers.** If you're on macOS or using Docker Desktop, your `~/.docker/config.json` likely uses a credential helper (`"credsStore": "desktop"`) and stores no actual credentials in the file. In that case, `cat ~/.docker/config.json | base64` produces a **useless empty token**. You must construct the token explicitly (see options below).
>
> Check with: `cat ~/.docker/config.json` — if you see `"credsStore"` or empty `{}` auth entries, use the explicit method.

**Option A: Everything in ECR (recommended for most setups)**

Constructs the token directly from `aws ecr get-login-password` — works regardless of Docker credential helpers:

```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

export IMAGE_PULL_TOKEN=$(echo "{\"auths\":{\"$ECR_REGISTRY\":{\"auth\":\"$(echo -n AWS:$(aws ecr get-login-password --region $AWS_REGION) | base64)\"}}}" | base64)
```

> **Important:** The registry key in the token must **exactly match** the registry hostname in your task definition images. Don't leave `<AWSACCOUNTID>` or `<AWSREGION>` as literal placeholders — use the variables or substitute your actual values.

> **Note:** AWS ECR credentials are short-lived (12 hours). Regenerate this token if your pipeline takes longer.

**Option B: Mixed registries — sensor in ECR, app images in a private registry**

You need creds for BOTH registries. Construct them explicitly:

```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

# Get ECR auth
ECR_AUTH=$(echo -n AWS:$(aws ecr get-login-password --region $AWS_REGION) | base64)

# Get your private registry auth (username:password base64-encoded)
PRIVATE_REGISTRY_AUTH=$(echo -n "<username>:<password-or-token>" | base64)

# Combine into a single pull token
export IMAGE_PULL_TOKEN=$(echo "{\"auths\":{\"$ECR_REGISTRY\":{\"auth\":\"$ECR_AUTH\"},\"mycompany.jfrog.io\":{\"auth\":\"$PRIVATE_REGISTRY_AUTH\"}}}" | base64)
```

**Option C: Docker config (only works WITHOUT credential helpers)**

This only works if your `~/.docker/config.json` has actual credentials inline (typical on Linux CI runners without Docker Desktop):

```bash
export IMAGE_PULL_TOKEN=$(cat ~/.docker/config.json | base64 -w 0)
```

> **Note:** If you see `"credsStore": "desktop"` or empty `{}` auth entries in your config, this method will NOT work. Use Option A or B instead.

### 5. Export your task definition (remove managed fields)

```bash
aws ecs describe-task-definition \
  --task-definition $TASK_FAMILY \
  --region $AWS_REGION \
  --query 'taskDefinition' | \
  jq 'del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy, .tags)' \
  > taskdefinition.json
```

> **Important:** Remove these managed fields before patching: `requiresAttributes`, `status`, `revision`, `compatibilities`, `registeredAt`, `registeredBy`, `taskDefinitionArn`, `tags` (if empty). Otherwise you'll see `parameter validation failed` errors.

### 6. Run the patching utility

```bash
docker run -v $(pwd):/var/run/spec \
  --rm "$SENSOR_IMAGE_REPO" \
  -cid $FALCON_CID \
  -image "$SENSOR_IMAGE_REPO" \
  -pulltoken $IMAGE_PULL_TOKEN \
  -ecs-spec-file /var/run/spec/taskdefinition.json > taskdefinitionwithfalcon.json
```

> **Tip:** Use `--falconctl-opts` to pass sensor configuration options. Example: `--falconctl-opts "--tags='production,web-server'"`

> **Tip:** To exclude a container from sensor injection, add this label to its container definition:
>
> ```json
> "dockerLabels": { "sensor.falcon-system.crowdstrike.com/injection": "disabled" }
> ```

### 7. Register and deploy the patched task definition

```bash
aws ecs register-task-definition \
  --region $AWS_REGION \
  --cli-input-json file://taskdefinitionwithfalcon.json

aws ecs update-service \
  --region $AWS_REGION \
  --cluster <CLUSTER_NAME> \
  --service <SERVICE_NAME> \
  --task-definition $TASK_FAMILY \
  --force-new-deployment
```

### 8. Verify the sensor deployment

**Option 1: Exec into the container**

```bash
aws ecs execute-command \
  --region $AWS_REGION \
  --cluster <CLUSTER_NAME> \
  --task <TASK_ARN> \
  --container <CONTAINER_NAME> \
  --interactive \
  --command "/tmp/CrowdStrike/rootfs/bin/falconctl -g --aid"
```

A valid AID in the output confirms the sensor is connected to the CrowdStrike cloud.

**Option 2: Falcon Console**

1. Go to **Host setup and management > Manage endpoints > Host management**
2. Add a **Pod ID** filter
3. Set the value to your **ECS Task ID** (e.g., `40f250e409ec4da1afee7acbcf7123cd`)
4. Verify the Host ID field has a value

> **Note:** For ECS Fargate, the Host ID = AID for event verification.

## What the Patched Task Definition Looks Like

Per-container changes applied by the patching utility:

```json
{
  "dependsOn": [
    {
      "condition": "COMPLETE",
      "containerName": "crowdstrike-falcon-init-container"
    }
  ],
  "entryPoint": [
    "/tmp/CrowdStrike/rootfs/lib64/ld-linux-x86-64.so.2",
    "--library-path",
    "/tmp/CrowdStrike/rootfs/lib64",
    "/tmp/CrowdStrike/rootfs/bin/bash",
    "/tmp/CrowdStrike/rootfs/entrypoint-ecs.sh",
    "// ORIGINAL CONTAINER ENTRYPOINT"
  ],
  "environment": [
    { "name": "FALCONCTL_OPTS", "value": "--cid=CID_WITH_CHECKSUM" }
  ],
  "linuxParameters": { "capabilities": { "add": ["SYS_PTRACE"] } },
  "mountPoints": [
    {
      "containerPath": "/tmp/CrowdStrike",
      "readOnly": true,
      "sourceVolume": "crowdstrike-falcon-volume"
    }
  ]
}
```

## ECS Runtime Auth for Mixed Registries

When your sensor image and app image are in different registries, ECS handles authentication differently for each:

**Sensor image in ECR (same account):** No extra config — the task execution role pulls it automatically via IAM. Just ensure the role has `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, and `ecr:GetAuthorizationToken`.

**App image in a private registry (JFrog, Quay, Harbor, etc.):** Add `repositoryCredentials` to the app container definition in your task definition **before** running the patching utility:

```json
{
  "name": "my-app",
  "image": "mycompany.jfrog.io/docker-local/my-app:v1.2.3",
  "repositoryCredentials": {
    "credentialsParameter": "arn:aws:secretsmanager:<region>:<account-id>:secret:jfrog-registry-creds"
  }
}
```

The Secrets Manager secret should contain:

```json
{
  "username": "<registry-username>",
  "password": "<registry-password-or-api-token>"
}
```

The task execution role also needs `secretsmanager:GetSecretValue` permission for this secret.

> **Note:** If your task definition already has `repositoryCredentials` (i.e., you're already pulling app images from a private registry today), the patching utility preserves it. Nothing extra to configure on the ECS side.

## Notes

- The `--copy` flag on the pull script supports Docker, Podman, and Skopeo runtimes. Skopeo is recommended for multi-arch images.
- The `-pulltoken` is for **patch time** only (so the utility can read image metadata). ECS runtime auth is handled separately via IAM (ECR) or `repositoryCredentials` (other registries).
- If your app containers are in a private registry that requires auth, the patching utility needs access to those registries to read the entrypoint/command metadata. The `-pulltoken` covers this.

## Gotchas

- **`parameter validation failed`:** You forgot to strip managed fields from the task definition before patching. See step 5.
- **Docker Desktop credential helper (`"credsStore": "desktop"`):** On macOS/Docker Desktop, `~/.docker/config.json` doesn't contain actual credentials — it delegates to the macOS Keychain. `cat ~/.docker/config.json | base64` gives the patching utility an empty/useless token. Symptom: `Failed to retrieve image details` with "credentials tried: 2". Fix: use the explicit `echo "{\"auths\":...}" | base64` method in step 4 to construct a self-contained token.
- **ECR token expiry:** ECR pull tokens expire after 12 hours. If your CI/CD pipeline takes longer or you deploy later, regenerate the token.
- **macOS `base64` difference:** On macOS, use `base64` without `-w 0` (macOS base64 doesn't wrap by default). On Linux, `-w 0` prevents line wrapping.
- **Pull token must cover ALL registries:** If the patching utility fails reading an image, it's usually because the pull token doesn't have creds for that image's registry. The token is a Docker config JSON — it can have auth entries for multiple registries.
- **App image entrypoint extraction:** The patching utility needs to query your app image to get its entrypoint. If your app image is in JFrog/Quay/etc. and the pull token is ECR-only, patching will fail. Use Option B in step 4 to cover both.
- **`repositoryCredentials` vs `-pulltoken`:** These serve different purposes. `-pulltoken` is for the patching utility at build/patch time. `repositoryCredentials` is for ECS at task launch time. You need both if your app images are in a non-ECR registry.

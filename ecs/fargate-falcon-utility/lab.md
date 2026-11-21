# Falcon Container Sensor on ECS Fargate — Image Patching

Protect an ECS Fargate service by building the Falcon Container Sensor into your application image. You run CrowdStrike's `falconutil patch-image` once per image, push the result to ECR, and point the task definition at it. No init container, no shared volume: the sensor ships inside the image your task already runs.

> **Note:** This is the second Fargate method. [Task Patching](#/aws/ecs/fargate/task-patching) leaves your image alone and patches the task definition instead. Pick this one when you own the image build and want the sensor baked into it.

> **Prerequisites:**
>
> - An ECS cluster with a <span data-tip="Fargate runs containers without servers you manage. falconutil here builds x86_64 images, so the service must use the X86_64 CPU architecture.">Fargate service</span> running
> - Your application image <span data-tip="Fargate pulls from ECR with the task execution role, so no pull secret is needed in the same account. Other registries need extra setup not covered here.">in ECR</span>
> - AWS account with the `aws` CLI <span data-tip="aws sts get-caller-identity should print your account.">configured</span>
> - <span data-tip="Runs falconutil and pushes the patched image. It must be running: docker info should print server details, not an error. Start Docker Desktop if it fails.">Docker</span> installed **and running**, plus `jq` and `curl`
> - Permission to <span data-tip="ECR: GetAuthorizationToken, CreateRepository, BatchGetImage, GetDownloadUrlForLayer, BatchCheckLayerAvailability, InitiateLayerUpload, UploadLayerPart, CompleteLayerUpload, PutImage. ECS: DescribeServices, DescribeTaskDefinition, RegisterTaskDefinition, UpdateService. IAM: iam:PassRole on the task and execution roles.">push to ECR and change the ECS service</span>
> - Tasks can reach the Falcon cloud: a <span data-tip="The sensor sends telemetry to CrowdStrike over TLS 443. Tasks in private subnets with no NAT gateway or VPC egress start fine but never register a sensor.">public IP or NAT route</span>
> - Task <span data-tip="The IAM role ECS uses to pull images and write logs. For same-account ECR the AWS managed policy AmazonECSTaskExecutionRolePolicy is enough.">execution role</span> that can pull from ECR
> - CrowdStrike Falcon API <span data-tip="Only used once to copy the sensor image into your ECR. Create the client with Falcon Images Download (Read) and Sensor Download (Read).">credentials</span> (Client ID + Secret)
> - CrowdStrike <span data-tip="Use the full Customer ID including the checksum suffix. The tip below shows where to find it.">CID</span> (with checksum)

> **Tip:** Where to find your Falcon credentials:
>
> - **CID (with checksum):** in the Falcon console, go to **Host setup and management** > **Deploy** > **Sensor downloads** and copy the **Customer ID** from the right panel. Direct link: [US-1](https://falcon.crowdstrike.com/sensor-downloads/all) | [US-2](https://falcon.us-2.crowdstrike.com/sensor-downloads/all) | [EU-1](https://falcon.eu-1.crowdstrike.com/sensor-downloads/all). On GovCloud, open the same page on your GovCloud console host.
> - **API client:** go to **Support and resources** > **Client Management** > **API Clients** > **Create API client**. Copy the client secret right away; the console shows it only once.

> **Warning:** **Is the task definition managed by Terraform, CDK, or CloudFormation?** The next apply will overwrite a revision registered by this lab and the service goes back to the unpatched image. If you use Terraform, follow the [Terraform Module lab](#/aws/ecs/fargate/terraform-module) instead. For CDK, CloudFormation, or a task definition JSON in Git, change the image in the source: in Quick Deploy, set **Run it from** to **CI pipeline**.

## Reference Docs

| Source | Link |
| ------ | ---- |
| Deploy Falcon Container Sensor for Linux on ECS Fargate | https://docs.crowdstrike.com/r/en-US/iopiipqy/ba83eb6c |
| falcon-container-sensor-pull script | https://github.com/CrowdStrike/falcon-scripts/tree/main/bash/containers/falcon-container-sensor-pull |
| ECS task definitions | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html |

---

## Core Concepts

On Fargate there is no host to install an agent on, so the sensor has to travel with your workload. In ECS, a **task definition** is the blueprint for the containers a task runs, and a **service** keeps the desired number of tasks running from it. Every change registers a new **revision** (`my-app:1`, `my-app:2`), and the service points at one revision at a time.

The **Falcon utility**, `falconutil`, ships inside the `falcon-container` image. `falconutil patch-image` reads your application image and writes a new one:

- **Sensor layers** are added to the image.
- **The entrypoint** is rewritten to `/opt/CrowdStrike/rootfs/bin/falcon-entrypoint`, which starts the sensor and then your original command.

The patched image is a new tag (this lab uses a `-falcon` suffix), so the original stays untouched. Fargate still needs two task-definition changes, which you make in a new revision: point the container at the `-falcon` image, and add the `SYS_PTRACE` Linux capability the sensor needs.

| | Image Patching (this lab) | Task Patching |
|---|---|---|
| What changes | Your application image | The task definition |
| Containers per task | One (sensor inside your app) | App + init container |
| Run `falconutil` | Once per image build | Once per task definition |
| Best when | You own the image pipeline | You do not want to rebuild images |

```
ECS FARGATE FALCON UTILITY — FLOW
Your terminal or CI runner (Docker) | Falcon Container Image | docker pull | falconutil patch-image | docker push
Amazon ECR — app:1.0-falcon
New task definition revision — SYS_PTRACE | Your ECS service | Rolling replacement of tasks
ECS Fargate task — falcon-entrypoint
CrowdStrike Cloud — Telemetry
```

---

## Deployment Steps

<div data-mode="guide">

Steps 1 to 4 are one-time setup from your terminal. Then choose where the patching runs:

<div data-choice-picker="runfrom"></div>

### 1. Set your values

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,AWS_ACCOUNT_ID:AWS account ID,AWS_REGION:AWS region,CLUSTER_NAME:ECS cluster name,SERVICE_NAME:ECS service name,APP_IMAGE:App ECR repository name,APP_TAG:App image tag" data-fill-derive="REGISTRY=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com"></div>

The secret goes through the environment only, never a flag, so it stays out of process lists and logs:

```bash
export FALCON_CLIENT_ID="<FALCON_CLIENT_ID>"
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

<div data-choice="runfrom:pipeline">

> **Tip:** The secret is only used in this one-time setup from your terminal. The pipeline reads the sensor from your ECR, so it never needs the API client.

</div>

### 2. Log Docker in to ECR

Lets your Docker CLI push and pull in your ECR registry:

```bash
aws ecr get-login-password --region <AWS_REGION> | docker login --username AWS --password-stdin <REGISTRY>
```

> **Verify:** It prints `Login Succeeded`.

### 3. Copy the sensor image into ECR

Fargate pulls images with the task execution role, so the sensor image has to live in your ECR. First create the repository; the repository name must be `falcon-container` because the copy keeps the image name. The output says whether it already existed or was just created:

```bash
if aws ecr describe-repositories --repository-names falcon-container --region <AWS_REGION> >/dev/null 2>&1; then
  echo "✅ falcon-container already exists"
else
  aws ecr create-repository --repository-name falcon-container --region <AWS_REGION> --query repository.repositoryUri --output text \
    && echo "🆕 Created falcon-container"
fi
```

Pick the Falcon cloud your CID belongs to. `--platform x86_64` copies a single-architecture image, which is what Fargate X86_64 runs:

<div data-choice-picker="falconcloud"></div>

<div data-choice="falconcloud:commercial">

```bash
bash <(curl -Ls https://github.com/CrowdStrike/falcon-scripts/releases/latest/download/falcon-container-sensor-pull.sh) \
  -t falcon-container --platform x86_64 --copy <REGISTRY>
```

</div>

<div data-choice="falconcloud:govcloud-1">

```bash
bash <(curl -Ls https://github.com/CrowdStrike/falcon-scripts/releases/latest/download/falcon-container-sensor-pull.sh) \
  -t falcon-container --platform x86_64 --region us-gov-1 --copy <REGISTRY>
```

</div>

<div data-choice="falconcloud:govcloud-2">

```bash
bash <(curl -Ls https://github.com/CrowdStrike/falcon-scripts/releases/latest/download/falcon-container-sensor-pull.sh) \
  -t falcon-container --platform x86_64 --region us-gov-2 --copy <REGISTRY>
```

</div>

> **Verify:** The last lines say `Image copied to: <REGISTRY>/falcon-container:<tag>`.

### 4. Read the sensor tag

`--copy` keeps the sensor's tag, so read it back from ECR. It is not known in advance, so you export it:

```bash
export SENSOR_TAG=$(aws ecr describe-images --repository-name falcon-container --region <AWS_REGION> --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
echo $SENSOR_TAG
```

> **Verify:** It prints a tag like `8.12.0-8207`, not `None`.

<div data-choice="runfrom:local">

### 5. Pull both images as amd64

`falconutil` patches from your local Docker cache. `IfNotPresent` only matches a single-architecture local image, so replace any multi-arch alias with a concrete amd64 copy of the sensor, then pull your application image the same way:

```bash
docker rmi <REGISTRY>/falcon-container:$SENSOR_TAG 2>/dev/null
docker pull --platform linux/amd64 <REGISTRY>/falcon-container:$SENSOR_TAG
```

```bash
docker pull --platform linux/amd64 <REGISTRY>/<APP_IMAGE>:<APP_TAG>
```

### 6. Patch your application image

`falconutil` runs inside the sensor container and reads and writes your images through the mounted Docker socket. Both images are already local, so `IfNotPresent` patches without any registry login inside the container. `--falconctl-opts` bakes in sensor tags so you can group these hosts in the Falcon console:

```bash
docker run --user 0:0 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --rm <REGISTRY>/falcon-container:$SENSOR_TAG \
  falconutil patch-image \
  --source-image-uri <REGISTRY>/<APP_IMAGE>:<APP_TAG> \
  --target-image-uri <REGISTRY>/<APP_IMAGE>:<APP_TAG>-falcon \
  --falcon-image-uri <REGISTRY>/falcon-container:$SENSOR_TAG \
  --cid <FALCON_CID> \
  --image-pull-policy IfNotPresent \
  --platform linux/amd64 \
  --falconctl-opts "--tags=ecs-fargate,falconutil" \
  --cloud-service ECS_FARGATE
```

> **Heads-up:** Tags allow letters, numbers, `-`, `_`, and `/` only. A space in a tag breaks the sensor, and the container then exits before your app starts. `--cloud-service ECS_FARGATE` needs sensor 7.22 or later; older sensors use `falconutil patch-image ecsfargate` instead.

> **Verify:** The command ends without an error and `docker images <REGISTRY>/<APP_IMAGE>` lists the `<APP_TAG>-falcon` tag.

### 7. Push the patched image

Your Docker CLI, logged in at step 2, handles the push:

```bash
docker push <REGISTRY>/<APP_IMAGE>:<APP_TAG>-falcon
```

### 8. Register a new task definition revision and deploy

Look up the task definition the service runs now:

```bash
export TASK_DEF=$(aws ecs describe-services --cluster <CLUSTER_NAME> --services <SERVICE_NAME> --region <AWS_REGION> --query 'services[0].taskDefinition' --output text)
echo $TASK_DEF
```

Write a copy that uses the `-falcon` image and adds `SYS_PTRACE`. The `del(...)` removes fields ECS manages itself, which `register-task-definition` rejects. If your container sets its own `entryPoint`, it is kept behind the Falcon entrypoint:

```bash
aws ecs describe-task-definition --task-definition $TASK_DEF --region <AWS_REGION> --query taskDefinition \
  | jq --arg old "<REGISTRY>/<APP_IMAGE>:<APP_TAG>" --arg new "<REGISTRY>/<APP_IMAGE>:<APP_TAG>-falcon" '
      del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy,.deregisteredAt)
      | .containerDefinitions |= map(
          if .image == $old then
            .image = $new
            | .linuxParameters.capabilities.add = (((.linuxParameters.capabilities.add // []) + ["SYS_PTRACE"]) | unique)
            | (if .entryPoint then .entryPoint = ["/opt/CrowdStrike/rootfs/bin/falcon-entrypoint"] + .entryPoint else . end)
          else . end)' > taskdef-falcon.json
```

> **Verify:** `jq '.containerDefinitions[] | {name, image}' taskdef-falcon.json` shows your container on the `-falcon` tag. If it still shows the old tag, the image in the task definition does not match `<APP_TAG>` exactly.

Register it, then point the service at the new revision:

```bash
export NEW_TASK_DEF=$(aws ecs register-task-definition --cli-input-json file://taskdef-falcon.json --region <AWS_REGION> --query taskDefinition.taskDefinitionArn --output text)
echo $NEW_TASK_DEF
```

```bash
aws ecs update-service --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --task-definition $NEW_TASK_DEF --region <AWS_REGION> --query 'service.deployments[].{Status:status,Desired:desiredCount,Running:runningCount}' --output table
```

> **Why this matters:** If the new tasks keep failing to start, a service with the deployment circuit breaker enabled stops the rollout and redeploys the last working revision. Turn it on first:
> `aws ecs update-service --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true}" --region <AWS_REGION>`

> **Verify:** The table shows a `PRIMARY` deployment with the new tasks. Wait for the old ones to drain: `aws ecs wait services-stable --cluster <CLUSTER_NAME> --services <SERVICE_NAME> --region <AWS_REGION>` returns with no output when the rollout is done.

</div>

<div data-choice="runfrom:pipeline">

### 5. Give the pipeline access

The pipeline needs your CID and an AWS role it can assume. These steps use GitHub Actions; any CI follows the same flow. In your repository, go to **Settings** > **Secrets and variables** > **Actions** and add:

- `FALCON_CID`: your CID with checksum.
- `AWS_ROLE_ARN`: the ARN of an <span data-tip="An IAM role is an AWS identity with permissions but no password or keys. A pipeline assumes it for a short time instead of storing access keys. In IAM, create the role with Web identity as the trusted entity and token.actions.githubusercontent.com as the provider, and limit the trust relationship to your repository.">IAM role</span> the workflow assumes with OIDC. Give it ECR push and pull on your repositories, plus the ECS and `iam:PassRole` permissions your deploy step uses.

> **Why this matters:** OIDC gives the workflow short-lived AWS credentials, so no access keys sit in your repository. Setup is in the [configure-aws-credentials README](https://github.com/aws-actions/configure-aws-credentials).

### 6. Patch and push the image in the workflow

Keep your task definition JSON in Git. The workflow pulls the sensor from your ECR (copied in step 3), patches the application image, and pushes the `-falcon` tag. Save this as `.github/workflows/falconutil-ecs.yml`, replacing the `<PLACEHOLDERS>` with yours:

```yaml
name: falconutil-ecs
on:
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  patch-and-deploy:
    runs-on: ubuntu-latest
    env:
      AWS_REGION: <AWS_REGION>
      APP_IMAGE: <APP_IMAGE>
      APP_TAG: <APP_TAG>
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}
      - name: Log in to ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2
      - name: Find the newest sensor tag
        run: |
          tag=$(aws ecr describe-images --repository-name falcon-container \
            --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
          echo "SENSOR_TAG=$tag" >> "$GITHUB_ENV"
          echo "REGISTRY=${{ steps.login-ecr.outputs.registry }}" >> "$GITHUB_ENV"
      - name: Pull the sensor and app images as amd64
        run: |
          docker pull --platform linux/amd64 $REGISTRY/falcon-container:$SENSOR_TAG
          docker pull --platform linux/amd64 $REGISTRY/$APP_IMAGE:$APP_TAG
      - name: Patch the application image
        run: |
          docker run --user 0:0 \
            -v /var/run/docker.sock:/var/run/docker.sock \
            --rm $REGISTRY/falcon-container:$SENSOR_TAG \
            falconutil patch-image \
            --source-image-uri $REGISTRY/$APP_IMAGE:$APP_TAG \
            --target-image-uri $REGISTRY/$APP_IMAGE:$APP_TAG-falcon \
            --falcon-image-uri $REGISTRY/falcon-container:$SENSOR_TAG \
            --cid ${{ secrets.FALCON_CID }} \
            --image-pull-policy IfNotPresent \
            --platform linux/amd64 \
            --falconctl-opts "--tags=ecs-fargate,falconutil" \
            --cloud-service ECS_FARGATE
      - name: Push the patched image
        run: docker push $REGISTRY/$APP_IMAGE:$APP_TAG-falcon
```

> **Tip:** The workflow patches the image from the unpatched tag every run, so a new application build or a newer sensor is picked up by re-running it. Your Git task definition keeps the original image.

### 7. Deploy the patched image in the workflow

Append these steps to the same job, below the push step, with the same indentation. They point a copy of your task definition at the `-falcon` image, add `SYS_PTRACE`, and register and deploy it. Replace `ecs/task-definition.json`, `<SERVICE_NAME>`, and `<CLUSTER_NAME>` with yours:

```yaml
      - name: Point the task definition at the patched image
        run: |
          jq --arg old "$REGISTRY/$APP_IMAGE:$APP_TAG" --arg new "$REGISTRY/$APP_IMAGE:$APP_TAG-falcon" '
            .containerDefinitions |= map(
              if .image == $old then
                .image = $new
                | .linuxParameters.capabilities.add = (((.linuxParameters.capabilities.add // []) + ["SYS_PTRACE"]) | unique)
                | (if .entryPoint then .entryPoint = ["/opt/CrowdStrike/rootfs/bin/falcon-entrypoint"] + .entryPoint else . end)
              else . end)' ecs/task-definition.json > ecs/task-definition.falcon.json
      - name: Register and deploy
        uses: aws-actions/amazon-ecs-deploy-task-definition@v2
        with:
          task-definition: ecs/task-definition.falcon.json
          service: <SERVICE_NAME>
          cluster: <CLUSTER_NAME>
          wait-for-service-stability: true
```

> **Warning:** The `image` in `ecs/task-definition.json` must read `<REGISTRY>/<APP_IMAGE>:<APP_TAG>` exactly, or the `jq` step changes nothing and the service redeploys the unpatched image.

### 8. Run the workflow

In your repository open the **Actions** tab, select **falconutil-ecs**, then **Run workflow**.

> **Verify:** The patch step ends without an error, the push step uploads the `-falcon` tag, and the deploy step finishes with the service stable.

</div>

### 9. Verify

Capture a running task's ID and list its containers. During a rollout the service briefly runs old and new tasks side by side, so if you see the old container set, run it again in a minute:

```bash
export TASK_ID=$(aws ecs list-tasks --cluster <CLUSTER_NAME> --service-name <SERVICE_NAME> --region <AWS_REGION> --desired-status RUNNING --query 'taskArns[0]' --output text | awk -F/ '{print $NF}')
aws ecs describe-tasks --cluster <CLUSTER_NAME> --tasks $TASK_ID --region <AWS_REGION> --query 'tasks[0].containers[].{Name:name,Image:image,Status:lastStatus}' --output table
```

> **Verify:** Your container is `RUNNING` and its `Image` ends in `-falcon`. There is no separate init container; the sensor lives inside your image.

The Falcon console identifies the sensor by the task ID, with no dashes. Print it:

```bash
echo $TASK_ID
```

In the Falcon console go to **Host setup and management** > **Host management**, add a **Pod ID** filter, and paste that value.

> **Look for:** A host entry with a populated **Host ID**. The sensor registers about two minutes after the task starts and the console can lag a few minutes beyond that, so an empty result right after the deploy is normal; refresh and wait. No entry after ten minutes usually means the task cannot reach the Falcon cloud; check that the service has a public IP or a NAT route.

> **Heads-up:** If the task stops right away, check its **Stopped reason** in the ECS console. `CannotPullContainerError` means the execution role cannot pull from your ECR. A container that exits immediately after the deploy usually means a bad sensor tag (a space in `--falconctl-opts`) or a custom `entryPoint` that was not wrapped.

<div data-choice="runfrom:local">

### 10. Roll back (optional)

Point the service back at the revision it ran before step 8, which `$TASK_DEF` still holds in this shell. Otherwise copy the previous revision's ARN from **Task definitions** in the ECS console:

```bash
aws ecs update-service --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --task-definition $TASK_DEF --region <AWS_REGION>
```

> **Note:** Rolling back does not delete the `-falcon` image or the new revision. Re-register the revision any time to protect the service again.

### 11. Upgrade the sensor later

A patched image keeps the sensor version it was built with. To move to a newer sensor, repeat steps 3 to 8: copy the new sensor, patch your original `<APP_TAG>` image again, push, and register a new revision.

</div>

<div data-choice="runfrom:pipeline">

### 10. Roll back (optional)

Copy the ARN of the revision before the patched one from **Task definitions** in the ECS console, then point the service at it:

```bash
aws ecs update-service --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --task-definition <PREVIOUS_REVISION_ARN> --region <AWS_REGION>
```

> **Note:** Your Git task definition is still unpatched, so the next workflow run protects the service again. Disable the workflow first to stop that.

</div>

</div>

<div data-mode="lab">

## 1. Your Environment

> **What & Why:** `falconutil` patches an image, so you need an application image in ECR and a Fargate service that runs it. This section collects your values and gives you a sample app if you lack one.

### Step 1: Set your values

- [ ] Fill in the values below once. Every command in this lab uses them.

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,AWS_ACCOUNT_ID:AWS account ID,AWS_REGION:AWS region,CLUSTER_NAME:ECS cluster name,SERVICE_NAME:ECS service name,APP_IMAGE:App ECR repository name,APP_TAG:App image tag" data-fill-derive="REGISTRY=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com"></div>

- [ ] Export the secret. It travels only through the environment, never a flag, and the field above is masked and never saved in your browser:

```bash
export FALCON_CLIENT_ID="<FALCON_CLIENT_ID>"
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

### Step 2: Find your service and image

> **What & Why:** The patch changes the image a **service** runs, so you need the service name and the exact image reference in its task definition.

- [ ] In the AWS console, open **Amazon ECS** > **Clusters**, select your cluster, and open the **Services** tab. Note the service name and the **Task definition** column (for example `acme-web:1`, which is family and revision).
- [ ] Open **Task definitions** > your family > the latest revision > **JSON** and find `containerDefinitions[].image`. That value is `<REGISTRY>/<APP_IMAGE>:<APP_TAG>`.

<details>
<summary>CLI equivalent</summary>

```bash
aws ecs list-services --cluster <CLUSTER_NAME> --region <AWS_REGION> --output table
```

</details>

> **Note:** **Don't have an app image?** Push a small one to ECR. In **Amazon ECR** > **Private registry** > **Repositories** > **Create repository** make `<APP_IMAGE>`, then use **View push commands** on that repository to push `nginx:1.27-alpine` as `<APP_TAG>`. Build with `--platform linux/amd64`, since `falconutil` here targets X86_64. Then create a Fargate service on it in the console with **Public IP** turned on; a public IP (or a NAT route) is what lets the sensor reach the Falcon cloud.

### Step 3: Log Docker in to ECR

- [ ] Authenticate your Docker CLI so it can push and pull in your registry:

```bash
aws ecr get-login-password --region <AWS_REGION> | docker login --username AWS --password-stdin <REGISTRY>
```

> **Verify:** It prints `Login Succeeded`.

## 2. Copy the Sensor Image into ECR

> **What & Why:** The `falcon-container` image holds both the sensor and `falconutil`. You copy it into your own ECR so the patching step and, later, your pipeline can pull it without CrowdStrike credentials.

> **Why this matters:** An **ECR repository** is a named bucket of image tags in your account. The repository name must be `falcon-container`, because the copy keeps the image name. Fargate pulls from ECR with the task **execution role**, so same-account images need no pull secret.

### Step 1: Create the repository

- [ ] In the console, open **Amazon ECR** > **Private registry** > **Repositories** > **Create repository**, name it `falcon-container`, and leave the other settings at their defaults.

<details>
<summary>CLI equivalent</summary>

```bash
if aws ecr describe-repositories --repository-names falcon-container --region <AWS_REGION> >/dev/null 2>&1; then
  echo "✅ falcon-container already exists"
else
  aws ecr create-repository --repository-name falcon-container --region <AWS_REGION> --query repository.repositoryUri --output text \
    && echo "🆕 Created falcon-container"
fi
```

</details>

### Step 2: Copy the sensor

- [ ] Pick the Falcon cloud your CID belongs to. `--platform x86_64` copies a single-architecture image, which is what Fargate X86_64 runs:

<div data-choice-picker="falconcloud"></div>

<div data-choice="falconcloud:commercial">

```bash
bash <(curl -Ls https://github.com/CrowdStrike/falcon-scripts/releases/latest/download/falcon-container-sensor-pull.sh) \
  -t falcon-container --platform x86_64 --copy <REGISTRY>
```

</div>

<div data-choice="falconcloud:govcloud-1">

```bash
bash <(curl -Ls https://github.com/CrowdStrike/falcon-scripts/releases/latest/download/falcon-container-sensor-pull.sh) \
  -t falcon-container --platform x86_64 --region us-gov-1 --copy <REGISTRY>
```

</div>

<div data-choice="falconcloud:govcloud-2">

```bash
bash <(curl -Ls https://github.com/CrowdStrike/falcon-scripts/releases/latest/download/falcon-container-sensor-pull.sh) \
  -t falcon-container --platform x86_64 --region us-gov-2 --copy <REGISTRY>
```

</div>

- [ ] In the console, open **Amazon ECR** > **Repositories** > `falcon-container` and confirm a tag like `8.12.0-8207` is listed.

> **Verify:** The script's last lines say `Image copied to: <REGISTRY>/falcon-container:<tag>`, and the repository lists that tag.

> **Heads-up:** If you see `no basic auth credentials`, the Docker login in section 1 expired (ECR tokens last 12 hours); run it again.

### Step 3: Read the sensor tag

- [ ] The tag is not known in advance, so capture it:

```bash
export SENSOR_TAG=$(aws ecr describe-images --repository-name falcon-container --region <AWS_REGION> --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
echo $SENSOR_TAG
```

> **Verify:** A tag like `8.12.0-8207`, not `None`.

## 3. Patch the Application Image

> **What & Why:** `falconutil patch-image` produces a new image that contains the sensor and starts it before your app. It is a pure image operation: nothing in ECS changes until section 4.

> **How this works:** `falconutil` runs inside the sensor container and talks to your host Docker through the mounted socket (`/var/run/docker.sock`). It reads the source image, adds the sensor layers, rewrites the entrypoint to `/opt/CrowdStrike/rootfs/bin/falcon-entrypoint`, and writes the target image.

| Flag | Meaning |
|------|---------|
| `--source-image-uri` | The image to patch (your unpatched app) |
| `--target-image-uri` | The new image. This lab appends `-falcon` to the tag |
| `--falcon-image-uri` | The sensor image you copied |
| `--cid` | Your CID with checksum |
| `--cloud-service` | `ECS_FARGATE` (sensor 7.22 or later) |
| `--image-pull-policy` | `IfNotPresent` uses local images; `Always` pulls from a registry |
| `--falconctl-opts` | Sensor options, for example `--tags=a,b` |

### Step 1: Pull both images as amd64

> **Why this matters:** With `IfNotPresent`, `falconutil` only matches a single-architecture local image. A multi-arch alias would make it re-resolve against your private registry and fail on auth. Pulling a concrete amd64 copy avoids any registry login inside the container.

- [ ] Replace any local sensor alias with a concrete amd64 image:

```bash
docker rmi <REGISTRY>/falcon-container:$SENSOR_TAG 2>/dev/null
docker pull --platform linux/amd64 <REGISTRY>/falcon-container:$SENSOR_TAG
```

- [ ] Pull your application image the same way:

```bash
docker pull --platform linux/amd64 <REGISTRY>/<APP_IMAGE>:<APP_TAG>
```

### Step 2: Run falconutil

- [ ] Patch the image. `--falconctl-opts` bakes in sensor tags so you can group these hosts in the Falcon console:

```bash
docker run --user 0:0 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --rm <REGISTRY>/falcon-container:$SENSOR_TAG \
  falconutil patch-image \
  --source-image-uri <REGISTRY>/<APP_IMAGE>:<APP_TAG> \
  --target-image-uri <REGISTRY>/<APP_IMAGE>:<APP_TAG>-falcon \
  --falcon-image-uri <REGISTRY>/falcon-container:$SENSOR_TAG \
  --cid <FALCON_CID> \
  --image-pull-policy IfNotPresent \
  --platform linux/amd64 \
  --falconctl-opts "--tags=ecs-fargate,falconutil" \
  --cloud-service ECS_FARGATE
```

> **Verify:** The command ends without an error and `docker images <REGISTRY>/<APP_IMAGE>` lists the `<APP_TAG>-falcon` tag.

> **Heads-up:** Tags allow letters, numbers, `-`, `_`, and `/` only. A space breaks the sensor and the container exits before your app starts. On sensors older than 7.22, use `falconutil patch-image ecsfargate` and drop `--cloud-service`.

### Step 3: Push the patched image

- [ ] Push it to ECR. Your host Docker CLI, logged in earlier, handles this:

```bash
docker push <REGISTRY>/<APP_IMAGE>:<APP_TAG>-falcon
```

- [ ] In the console, open **Amazon ECR** > **Repositories** > `<APP_IMAGE>` and confirm both `<APP_TAG>` and `<APP_TAG>-falcon` are listed.

> **Verify:** Two tags, and the `-falcon` image is larger than the original by the size of the sensor layers.

## 4. Deploy the Patched Image

> **What & Why:** The service still runs the old revision. You register a new revision that uses the `-falcon` image and adds the `SYS_PTRACE` capability, then point the service at it. ECS replaces the tasks one by one.

> **Why this matters:** A Linux **capability** is a single privilege a container can be granted without running as root. The sensor uses `SYS_PTRACE` to observe processes in the task. Fargate allows only this one added capability, which is why it is the one the sensor asks for.

> **Heads-up:** If your container sets its own `entryPoint`, the task definition value overrides the one `falconutil` baked into the image. Keep the sensor first: `["/opt/CrowdStrike/rootfs/bin/falcon-entrypoint", "<your original entrypoint>", ...]`. If it sets only `command`, leave it alone.

### Step 1: Create the new revision

- [ ] In the console, open **Amazon ECS** > **Task definitions** > your family, select the revision your service runs, then choose **Create new revision** > **Create new revision with JSON**.
- [ ] In the container definition, change `image` to `<REGISTRY>/<APP_IMAGE>:<APP_TAG>-falcon`, and add this inside the same container:

```json
"linuxParameters": {
  "capabilities": { "add": ["SYS_PTRACE"] }
}
```

- [ ] Choose **Create**.

> **Verify:** A new revision (for example `acme-web:2`) appears with status `ACTIVE`.

<details>
<summary>CLI equivalent</summary>

```bash
export TASK_DEF=$(aws ecs describe-services --cluster <CLUSTER_NAME> --services <SERVICE_NAME> --region <AWS_REGION> --query 'services[0].taskDefinition' --output text)
aws ecs describe-task-definition --task-definition $TASK_DEF --region <AWS_REGION> --query taskDefinition \
  | jq --arg old "<REGISTRY>/<APP_IMAGE>:<APP_TAG>" --arg new "<REGISTRY>/<APP_IMAGE>:<APP_TAG>-falcon" '
      del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy,.deregisteredAt)
      | .containerDefinitions |= map(
          if .image == $old then
            .image = $new
            | .linuxParameters.capabilities.add = (((.linuxParameters.capabilities.add // []) + ["SYS_PTRACE"]) | unique)
            | (if .entryPoint then .entryPoint = ["/opt/CrowdStrike/rootfs/bin/falcon-entrypoint"] + .entryPoint else . end)
          else . end)' > taskdef-falcon.json
export NEW_TASK_DEF=$(aws ecs register-task-definition --cli-input-json file://taskdef-falcon.json --region <AWS_REGION> --query taskDefinition.taskDefinitionArn --output text)
echo $NEW_TASK_DEF
```

</details>

### Step 2: Turn on the circuit breaker

> **Why this matters:** The deployment circuit breaker is an ECS service setting. If the new revision's tasks keep failing to start, it stops the rollout and redeploys your last working revision, so a bad patch never takes the service down.

- [ ] In the console, open your service, choose **Update service**, expand **Deployment options**, and under **Deployment failure detection** select **Use the Amazon ECS deployment circuit breaker** and **Rollback on failures**. Do not save yet; the next step does that.

<details>
<summary>CLI equivalent</summary>

```bash
aws ecs update-service --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true}" --region <AWS_REGION>
```

</details>

### Step 3: Roll the service

- [ ] In the same **Update service** page, set **Revision** to the new one and choose **Update**.

<details>
<summary>CLI equivalent</summary>

```bash
aws ecs update-service --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --task-definition $NEW_TASK_DEF --region <AWS_REGION> --query 'service.deployments[].{Status:status,Desired:desiredCount,Running:runningCount}' --output table
```

</details>

- [ ] Open the service's **Deployments** tab and wait until the new deployment is the only one, with **Running** equal to **Desired**.

> **Verify:** One `PRIMARY` deployment at the new revision. If the circuit breaker triggers, the **Events** tab says `rolled back`; open a stopped task to read its **Stopped reason**.

## 5. Verify

> **What & Why:** Two independent checks: ECS shows the task runs your patched image, and the Falcon console shows the sensor reached the cloud.

### Step 1: Check the task in ECS

- [ ] In the console, open your service > **Tasks**, open the newest task, and look at the **Containers** table.

> **Verify:** Your container is `Running` and its **Image URI** ends in `-falcon`. There is no separate init container: the sensor is inside your image.

<details>
<summary>CLI equivalent</summary>

```bash
export TASK_ID=$(aws ecs list-tasks --cluster <CLUSTER_NAME> --service-name <SERVICE_NAME> --region <AWS_REGION> --desired-status RUNNING --query 'taskArns[0]' --output text | awk -F/ '{print $NF}')
aws ecs describe-tasks --cluster <CLUSTER_NAME> --tasks $TASK_ID --region <AWS_REGION> --query 'tasks[0].containers[].{Name:name,Image:image,Status:lastStatus}' --output table
```

</details>

> **Heads-up:** `CannotPullContainerError` means the execution role cannot pull from your ECR; attach `AmazonECSTaskExecutionRolePolicy` to it. A container that exits straight away usually means a space in `--falconctl-opts` or a custom `entryPoint` that was not wrapped.

### Step 2: Check the Falcon console

- [ ] Go to **Host setup and management** > **Host management**, add a **Pod ID** filter, and enter your task ID exactly as printed, with no dashes. Print it:

```bash
echo $TASK_ID
```

> **Look for:** A host entry with a populated **Host ID** (the sensor's AID). The sensor registers about two minutes after the task starts and the console can lag a few minutes beyond that, so an empty result right after the deploy is normal. No entry after ten minutes usually means the task cannot reach the Falcon cloud: it needs a public IP or a NAT route.

> **Note:** ECS Exec is off by default, so this lab does not exec into the container. If you enabled it, `/tmp/CrowdStrike/rootfs/bin/falconctl -g --aid` prints the AID.

## 6. Clean Up

> **Destructive:** These steps delete the sensor image and the patched image. Only run them for a lab you created; do not delete a repository your production tasks pull from.

- [ ] Roll the service back to the unpatched revision. In the console choose **Update service** and pick the original revision, or:

```bash
aws ecs update-service --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --task-definition $TASK_DEF --region <AWS_REGION>
```

- [ ] Delete the patched image tag and the sensor repository, and remove the local files:

```bash
aws ecr batch-delete-image --repository-name <APP_IMAGE> --image-ids imageTag=<APP_TAG>-falcon --region <AWS_REGION>
aws ecr delete-repository --repository-name falcon-container --force --region <AWS_REGION>
rm -f taskdef-falcon.json
```

> **Note:** Host entries stay in the Falcon console for a while after the tasks are gone. The new task definition revision remains in ECS; deregister it from **Task definitions** if you want it gone.

## Challenges

1. **Run it from your pipeline.** Quick Deploy has a **CI pipeline** path; build it end to end. Add the workflow, run it, and confirm the service rolls to the `-falcon` image.
2. **Add sensor tags.** Rebuild the image with `--falconctl-opts "--tags=ecs-fargate,<YOUR_TEAM>"`, redeploy, and find the host in **Host management** filtered by that tag. Try a tag with a space and watch the container exit before your app starts.
3. **Keep a custom entrypoint.** Add an `entryPoint` to the container, register the revision without wrapping it, and watch the Falcon sensor never start. Then fix it by putting `/opt/CrowdStrike/rootfs/bin/falcon-entrypoint` first.
4. **Practice the rollback.** Deploy, then roll back with only the previous revision's ARN, and confirm the host stops appearing for new tasks. Rolling back by revision is what makes this change low risk for a customer.

## Quick Reference

| Task | Command |
|------|---------|
| Log Docker in to ECR | `aws ecr get-login-password --region <AWS_REGION> \| docker login --username AWS --password-stdin <REGISTRY>` |
| Copy sensor to ECR | `falcon-container-sensor-pull.sh -t falcon-container --platform x86_64 --copy <REGISTRY>` |
| Patch an image | `docker run ... falcon-container:<SENSOR_TAG> falconutil patch-image --cloud-service ECS_FARGATE ...` |
| Push the patched image | `docker push <REGISTRY>/<APP_IMAGE>:<APP_TAG>-falcon` |
| Required task definition change | `image` to the `-falcon` tag, add `SYS_PTRACE`, wrap any `entryPoint` |
| Roll the service | `aws ecs update-service --task-definition <NEW_REVISION_ARN>` |
| Roll back | `aws ecs update-service --task-definition <PREVIOUS_REVISION_ARN>` |
| Find the sensor in Falcon | Host management > **Pod ID** = task ID, no dashes |

</div>

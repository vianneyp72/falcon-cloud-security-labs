# Falcon Container Sensor on ECS Fargate — Task Definition Patching

Protect an existing ECS Fargate service by patching its task definition with the Falcon Container Sensor. You use `falcon-ecs-patch`, a small community-maintained bash script that wraps CrowdStrike's official patching utility. It finds unprotected services, shows you a diff of exactly what changes, deploys, and prints the rollback command. The same script runs unchanged in CI/CD once the proof of value is done.

> **Note:** The script is a helper, not a CrowdStrike product, and is not covered by CrowdStrike support. It only automates the officially documented utility, which you can always run directly: Full Lab section 4 does exactly that by hand. Read the script (one file, `--help` lists everything) before you run it against production.

> **Prerequisites:**
>
> - An ECS cluster with a <span data-tip="Fargate runs containers without servers you manage. The script supports X86_64 tasks with images in ECR. ARM64 (Graviton) and EC2 launch type are not covered.">Fargate service</span> running
> - AWS account with the `aws` CLI <span data-tip="aws sts get-caller-identity should print your account.">configured</span>
> - <span data-tip="Runs the official patching utility. It must be running: docker info should print server details, not an error. Start Docker Desktop if it fails.">Docker</span> installed **and running**, plus `jq` and `curl`
> - Permission to <span data-tip="ECS: ListServices, DescribeServices, DescribeTaskDefinition, RegisterTaskDefinition, UpdateService. ECR: GetAuthorizationToken, DescribeImages, BatchGetImage, GetDownloadUrlForLayer, BatchCheckLayerAvailability, plus CreateRepository and the layer upload and PutImage actions for setup. IAM: iam:PassRole on the task and execution roles.">change the ECS service</span>
> - Tasks can reach the Falcon cloud: a <span data-tip="The sensor sends telemetry to CrowdStrike over TLS 443. Tasks in private subnets with no NAT gateway or VPC egress start fine but never register a sensor. The preview step warns if the service has no public IP.">public IP or NAT route</span>
> - Task <span data-tip="The IAM role ECS uses to pull images and write logs. For same-account ECR the AWS managed policy AmazonECSTaskExecutionRolePolicy is enough. The script warns if it cannot confirm pull access.">execution role</span> that can pull from ECR
> - CrowdStrike Falcon API <span data-tip="Only used once to copy the sensor image into your ECR. Create the client with Falcon Images Download (Read) and Sensor Download (Read).">credentials</span> (Client ID + Secret)
> - CrowdStrike <span data-tip="Use the full Customer ID including the two-character suffix after the dash. The tip below shows where to find it.">CID</span> (full value, with suffix)

> **Tip:** Where to find your Falcon credentials:
>
> - **CID (with checksum):** in the Falcon console, go to **Host setup and management** > **Deploy** > **Sensor downloads** and copy the **Customer ID** from the right panel. Direct link: [US-1](https://falcon.crowdstrike.com/sensor-downloads/all) | [US-2](https://falcon.us-2.crowdstrike.com/sensor-downloads/all) | [EU-1](https://falcon.eu-1.crowdstrike.com/sensor-downloads/all). On GovCloud, open the same page on your GovCloud console host.
> - **API client:** go to **Support and resources** > **Client Management** > **API Clients** > **Create API client**. Copy the client secret right away; the console shows it only once.

> **Warning:** **Is the task definition managed by Terraform, CDK, or CloudFormation?** The next apply will overwrite a revision registered by this lab and the sensor silently disappears. If you use Terraform, follow the [Terraform Module lab](#/aws/ecs/fargate/terraform-module) instead. For CDK, CloudFormation, or a task definition JSON in Git, patch the source in your pipeline: in Quick Deploy, set **Run it from** to **CI pipeline**. To try this lab hands-on, use a service you manage by hand, or a sample.

## Reference Docs

| Source | Link |
| ------ | ---- |
| Deploy Falcon Container Sensor for Linux on ECS Fargate | https://docs.crowdstrike.com/r/en-US/iopiipqy/ba83eb6c |
| falcon-ecs-patch (script, README, CI examples) | https://github.com/vianneyp72/falcon-ecs-patch |
| falcon-container-sensor-pull script | https://github.com/CrowdStrike/falcon-scripts/tree/main/bash/containers/falcon-container-sensor-pull |
| ECS task definitions | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html |

---

## Core Concepts

On Fargate there is no host to install an agent on, so the sensor travels inside the task. In ECS, a **task definition** is the blueprint for the containers a task runs, and a **service** keeps the desired number of tasks running from it. Task definitions are versioned: every change registers a new **revision** (`my-app:1`, `my-app:2`), and the service points at one revision at a time. That makes rollout and rollback a one-line change.

CrowdStrike ships a **patching utility** inside the `falcon-container` image. It reads a task definition and writes a new one with the sensor added:

- **Init container** (`crowdstrike-falcon-init-container`) runs first, copies the sensor files into a shared volume, then exits.
- **Your app containers** start through the Falcon entrypoint, so the sensor launches before your app. The utility adds the `SYS_PTRACE` capability the sensor needs.

You never edit the application image. The utility is a one-shot tool, and `falcon-ecs-patch` wraps it with the operational pieces around it:

| Step | Raw utility | With `falcon-ecs-patch` |
|------|-------------|-------------------------|
| Find what is unprotected | Manual | `audit` |
| Export and clean the task definition | `aws` + `jq` by hand | Automatic |
| Build the registry pull token | By hand | Automatic |
| Review the change | Compare files yourself | Diff printed |
| Register and roll the service | Two more commands | `--deploy`, waits until stable |
| Undo | Look up the old revision | Rollback command printed |

You copy the sensor image into your own ECR because Fargate pulls images with the **execution role**. Same-account ECR needs no pull secret.

```
ECS FARGATE TASK PATCHING — FLOW
Your task definition (revision 1) | falcon-ecs-patch | Patching utility (in the falcon-container image)
Patched task definition (revision 2) | Your ECS service | Rolling replacement of tasks
ECS Fargate Task — crowdstrike-falcon-init-container | Shared volume | Application container
Execution role pulls the image from ECR
CrowdStrike Cloud — Telemetry
```

---

## Deployment Steps

<div data-mode="guide">

Steps 1 to 3 are the same either way: a one-time setup from your own terminal. After that, choose where the patching runs:

<div data-choice-picker="runfrom"></div>

> **Note:** **My terminal** suits a proof of value or a service you manage by hand. **CI pipeline** suits a task definition JSON kept in Git: every new revision gets patched before it deploys, so nothing ships unprotected.

### 1. Set your values

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,AWS_REGION:AWS region,CLUSTER_NAME:ECS cluster name,SERVICE_NAME:ECS service name"></div>

Copy this to export the values the script reads. The API client secret is only ever passed through the environment, never a flag, so it does not show up in process lists or CI logs. You type the secret at the prompt, so it is not in the form above:

```bash
export AWS_REGION="<AWS_REGION>"
export FALCON_CID="<FALCON_CID>"
export FALCON_CLIENT_ID="<FALCON_CLIENT_ID>"
read -rs -p "Falcon API client secret: " FALCON_CLIENT_SECRET && export FALCON_CLIENT_SECRET
```

> **Tip:** `read -s` keeps the secret out of your shell history and the screen. In CI, store it in your secret manager and expose it as an environment variable.

### 2. Download the script and verify it

Download a pinned release and its checksum, then verify before running anything:

```bash
VERSION=v0.2.2
BASE=https://github.com/vianneyp72/falcon-ecs-patch/releases/download/$VERSION
curl -fsSLO $BASE/falcon-ecs-patch.sh
curl -fsSLO $BASE/falcon-ecs-patch.sh.sha256
```

Check the file matches its published checksum, then make it executable:

```bash
(sha256sum -c falcon-ecs-patch.sh.sha256 2>/dev/null || shasum -a 256 -c falcon-ecs-patch.sh.sha256) && chmod +x falcon-ecs-patch.sh
```

> **Verify:** The output is `falcon-ecs-patch.sh: OK`. Anything else means the download is corrupt or was changed; stop and download it again.

### 3. Copy the sensor image into your ECR

Pick the Falcon cloud your CID belongs to. `setup` creates the `falcon-container` ECR repository if needed, copies the image from CrowdStrike's registry, and prints the image URI:

<div data-choice-picker="falconcloud"></div>

<div data-choice="falconcloud:commercial">

```bash
./falcon-ecs-patch.sh setup
```

</div>

<div data-choice="falconcloud:govcloud-1">

```bash
./falcon-ecs-patch.sh setup --falcon-cloud us-gov-1
```

</div>

<div data-choice="falconcloud:govcloud-2">

```bash
./falcon-ecs-patch.sh setup --falcon-cloud us-gov-2
```

</div>

> **Verify:** The last line is an image URI like `<account>.dkr.ecr.<region>.amazonaws.com/falcon-container:8.12.0-8207`. You can skip copying it; later steps find the newest tag automatically.

<div data-choice="runfrom:local">

### 4. See what is unprotected

`audit` only reads. It lists every service in the cluster and whether its task definition already has the Falcon init container:

```bash
./falcon-ecs-patch.sh audit --cluster <CLUSTER_NAME>
```

> **Verify:** Your service shows `FARGATE` and `X86_64`, with status `UNPROTECTED` and `-` in the `SENSOR` column. `EC2` launch type and `ARM64` services are listed but not patched.

### 5. Preview the patch

This is a dry run by default. It exports the task definition, runs the patching utility, and prints a diff. Nothing in ECS changes:

```bash
./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <SERVICE_NAME>
```

> **Verify:** The summary lists `+ added init container: crowdstrike-falcon-init-container` and one `~ wrapped entrypoint` line per app container. The original and patched JSON are saved under `./falcon-ecs-patch-out/`.
>
> **Look for:** The `Rollout:` line shows the service's minimum and maximum healthy percent, the circuit breaker, and the task size. The sensor shares the task's CPU and memory, so check there is headroom. A `NOTE` says the circuit breaker is off: enable it on the service so a failed rollout rolls back by itself (command below). A `WARN` about no public IP means the tasks need a NAT route before this will work. A `NOTE` about the `CODE_DEPLOY` or `EXTERNAL` deployment controller means the script registers the revision but leaves the service alone; deploy the revision with your own process.

> **Tip:** The diff below the summary is long. To review it, confirm three things: one added `crowdstrike-falcon-init-container`, a rewritten `entryPoint` on each of your app containers, and only your own `entryPoint` and empty `volumes` lines replaced. Full Lab section 4 explains every changed field.

To turn the circuit breaker on before you deploy:

```bash
aws ecs update-service --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true}" --region $AWS_REGION
```

### 6. Deploy

Try a non-production service first. `--deploy` registers the patched revision, points the service at it, and waits until the service is stable. It prints the diff, then asks `[y/N]`; type `y` to continue:

```bash
./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --deploy
```

> **Warning:** If Terraform, CDK, or CloudFormation owns this task definition, its next apply overwrites the revision registered here and the sensor disappears. See the warning at the top of this lab.

> **Heads-up:** If you see `--deploy needs a terminal to confirm`, the command is not running in an interactive terminal (a CI job, a script, a piped shell). Add `--yes` to skip the prompt. Any answer other than `y` prints `Aborted.` and changes nothing.

> **Verify:** It prints `Registered: <family>:<N+1>`, waits for the rollout, then ends with `Done.` and a `Roll back with:` command. Copy that command somewhere safe. The service is protected as soon as the rollout finishes, but the sensor takes about two minutes after the new task starts to register, and the Falcon console can lag a few minutes beyond that.

</div>

<div data-choice="runfrom:pipeline">

### 4. Give the pipeline access

The pipeline needs two things: your CID and an AWS role it can assume. These steps use GitHub Actions; any CI works the same way (download, verify, patch, deploy).

In your repository, go to **Settings** > **Secrets and variables** > **Actions** and add:

- `FALCON_CID`: your CID with checksum.
- `AWS_ROLE_ARN`: the ARN of an <span data-tip="An IAM role is an AWS identity with permissions but no password or keys. A pipeline assumes it for a short time instead of storing access keys. In IAM, create the role with Web identity as the trusted entity and token.actions.githubusercontent.com as the provider, and limit the trust relationship to your repository.">IAM role</span> the workflow can assume with OIDC. Give it ECR read access (`ecr:GetAuthorizationToken`, `DescribeImages`, `BatchGetImage`, `GetDownloadUrlForLayer`, `BatchCheckLayerAvailability`), plus the ECS and `iam:PassRole` permissions your deploy step already uses.

> **Why this matters:** OIDC lets GitHub prove its identity to AWS and receive credentials that expire in about an hour, so no long-lived access keys sit in your repository. Setup steps are in the [configure-aws-credentials README](https://github.com/aws-actions/configure-aws-credentials). The Falcon API client secret is not needed here; only `setup` in step 3 uses it.

### 5. Patch the task definition in the workflow

Keep your task definition JSON in Git as it is today, unpatched. Add a patch step before your register-and-deploy step. `patch --file` never touches ECS, so it fits any deploy tool: it reads your JSON and writes a patched copy. Save this as `.github/workflows/patch-ecs-task.yml` and replace `ecs/task-definition.json`, `<SERVICE_NAME>`, and `<CLUSTER_NAME>` with yours:

```yaml
name: patch-ecs-task
on:
  workflow_dispatch:
  pull_request:
    paths: ["ecs/task-definition.json"]

permissions:
  id-token: write
  contents: read

jobs:
  patch:
    runs-on: ubuntu-latest
    env:
      AWS_REGION: <AWS_REGION>
      FALCON_CID: ${{ secrets.FALCON_CID }}
      VERSION: v0.2.2
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}
      - name: Download falcon-ecs-patch
        run: |
          base=https://github.com/vianneyp72/falcon-ecs-patch/releases/download/$VERSION
          curl -fsSLO $base/falcon-ecs-patch.sh
          curl -fsSLO $base/falcon-ecs-patch.sh.sha256
          sha256sum -c falcon-ecs-patch.sh.sha256
          chmod +x falcon-ecs-patch.sh
      - name: Patch the task definition file
        run: ./falcon-ecs-patch.sh patch --file ecs/task-definition.json --output ecs/task-definition.patched.json
      - name: Register and deploy the patched file
        uses: aws-actions/amazon-ecs-deploy-task-definition@v2
        with:
          task-definition: ecs/task-definition.patched.json
          service: <SERVICE_NAME>
          cluster: <CLUSTER_NAME>
          wait-for-service-stability: true
```

Run it from the repository's **Actions** tab: select **patch-ecs-task**, then **Run workflow**.

> **Verify:** The patch step log lists `+ added init container: crowdstrike-falcon-init-container`, and the deploy step ends with the service stable. A task definition that already has the init container is skipped, so re-runs are safe.

> **Tip:** Your file in Git stays unpatched, so every run uses the newest sensor image in your ECR. To upgrade the sensor, run `setup` again (step 3) and re-run the workflow.

If the revision is already registered in ECS and no file in Git defines it, patch it by family instead. This registers a new revision, prints its ARN on stdout, and updates no service; point your service at that ARN:

```bash
./falcon-ecs-patch.sh patch --family <FAMILY> --deploy --yes
```

### 6. Catch unprotected services

A new service someone launches later will not be patched. A scheduled audit fails the job when one appears, and the log names it. Save this as `.github/workflows/audit-ecs-protection.yml`:

```yaml
name: audit-ecs-protection
on:
  schedule:
    - cron: "0 7 * * *"
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    env:
      AWS_REGION: <AWS_REGION>
      VERSION: v0.2.2
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}
      - name: Download falcon-ecs-patch
        run: |
          base=https://github.com/vianneyp72/falcon-ecs-patch/releases/download/$VERSION
          curl -fsSLO $base/falcon-ecs-patch.sh
          curl -fsSLO $base/falcon-ecs-patch.sh.sha256
          sha256sum -c falcon-ecs-patch.sh.sha256
          chmod +x falcon-ecs-patch.sh
      - name: Audit
        run: ./falcon-ecs-patch.sh audit --cluster <CLUSTER_NAME> --fail-on-unprotected
```

> **Look for:** With every Fargate service protected the job passes. An unprotected one exits 3 and the job fails with that service listed. EC2 launch type services show `OUT-OF-SCOPE` and never fail the job. An ARM64 Fargate service counts as unprotected but cannot be patched yet, so point the audit at a cluster without one.

</div>

### 7. Verify

Capture a running task's ID and list its containers. During a rollout the service briefly runs old and new tasks side by side; if the init container is missing, you picked an old task, so run it again in a minute:

```bash
export TASK_ID=$(aws ecs list-tasks --cluster <CLUSTER_NAME> --service-name <SERVICE_NAME> --region $AWS_REGION --desired-status RUNNING --query 'taskArns[0]' --output text | awk -F/ '{print $NF}')
aws ecs describe-tasks --cluster <CLUSTER_NAME> --tasks $TASK_ID --region $AWS_REGION --query 'tasks[0].containers[].{Name:name,Status:lastStatus,Exit:exitCode}' --output table
```

> **Verify:** `crowdstrike-falcon-init-container` is `STOPPED` with `Exit` `0`, and your app container is `RUNNING`.

The Falcon console shows the task ID as a dashed UUID. Print yours in that form:

```bash
echo $TASK_ID | sed -E 's/^(.{8})(.{4})(.{4})(.{4})(.{12})$/\1-\2-\3-\4-\5/'
```

In the Falcon console go to **Host setup and management** > **Host management**, add a **Pod ID** filter, and paste that value.

> **Look for:** A host entry with a populated **Host ID**. The sensor registers about two minutes after the task starts and the console can lag a few minutes beyond that, so an empty result right after the deploy is normal; refresh and wait. No entry after ten minutes usually means the task cannot reach the Falcon cloud; check that the service has a public IP or a NAT route.

Run the audit again to see the service protected:

```bash
./falcon-ecs-patch.sh audit --cluster <CLUSTER_NAME> --fail-on-unprotected
```

> **Verify:** Status is `PROTECTED` and the command exits 0. With any unprotected service it exits 3, which is what makes it useful as a CI gate.

<div data-choice="runfrom:local">

### 8. Roll back (optional)

Paste the `Roll back with:` command that `--deploy` printed. It points the service back at the revision it ran before that deploy. After step 6 that is your original revision, which has no sensor:

```bash
aws ecs update-service --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --task-definition <PREVIOUS_REVISION_ARN> --region $AWS_REGION
```

> **Note:** Rolling back does not delete the patched revision. Re-running `patch` later protects the service again.

### 9. Upgrade the sensor later

Already-protected task definitions are skipped, so re-running `patch` never changes the sensor version. To move to a newer sensor, copy the new image with `setup`, then patch the original, unpatched revision again. Use the revision number your service ran before step 6 (the rollback command from step 6 shows it). The `SENSOR` column in `audit` shows what each service runs:

```bash
./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --from-revision <UNPATCHED_REVISION> --deploy
```

</div>

<div data-choice="runfrom:pipeline">

### 8. Roll back (optional)

Point the service back at the revision it ran before the pipeline deployed. In the ECS console, open **Task definitions**, pick your family, and copy the ARN of the revision before the patched one. Then point the service at it:

```bash
aws ecs update-service --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --task-definition <PREVIOUS_REVISION_ARN> --region $AWS_REGION
```

> **Note:** Your task definition file in Git is still unpatched, so the next pipeline run protects the service again. To stop that, revert or pause the workflow first.

</div>

</div>

<div data-mode="lab">

## 1. Your Environment

> **What & Why:** The script works against a cluster and service that already exist. This section gets the values in one place, and gives you a sample service if you lack one.

### Step 1: Set your values

- [ ] Fill in the values below once. Every command in this lab uses them.

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,AWS_REGION:AWS region,CLUSTER_NAME:ECS cluster name,SERVICE_NAME:ECS service name"></div>

- [ ] Export the values the script reads. The secret travels only through the environment, never a flag, and you type it at the prompt:

```bash
export AWS_REGION="<AWS_REGION>"
export FALCON_CID="<FALCON_CID>"
export FALCON_CLIENT_ID="<FALCON_CLIENT_ID>"
read -rs -p "Falcon API client secret: " FALCON_CLIENT_SECRET && export FALCON_CLIENT_SECRET
```

> **Tip:** `read -s` keeps the secret out of your shell history and the screen. In CI, store it in your secret manager and expose it as an environment variable.

### Step 2: Find your service (or create a sample)

> **What & Why:** The patch targets a **service**, which keeps tasks running from a task definition. You need its cluster name and service name.

- [ ] In the AWS console, open **Amazon ECS** > **Clusters**, select your cluster, and open the **Services** tab. Note the service name and the **Task definition** column (for example `acme-web:1`, which is family and revision).

<details>
<summary>CLI equivalent</summary>

```bash
aws ecs list-services --cluster <CLUSTER_NAME> --region $AWS_REGION --output table
```

</details>

> **Note:** **Don't have a Fargate service?** In the console choose **Clusters** > **Create cluster**, then a task definition with launch type **AWS Fargate** running `public.ecr.aws/nginx/nginx:stable`, then a **service** on the cluster with **Public IP** turned on. A public IP (or a NAT route) is what lets the sensor reach the Falcon cloud.

## 2. Install the Script

> **What & Why:** You run a pinned release, not whatever is on `main`. The checksum proves the file you downloaded is the file that was published.

### Step 1: Download and verify

- [ ] Download the pinned release and its checksum:

```bash
VERSION=v0.2.2
BASE=https://github.com/vianneyp72/falcon-ecs-patch/releases/download/$VERSION
curl -fsSLO $BASE/falcon-ecs-patch.sh
curl -fsSLO $BASE/falcon-ecs-patch.sh.sha256
```

- [ ] Verify the checksum, then make the script executable:

```bash
(sha256sum -c falcon-ecs-patch.sh.sha256 2>/dev/null || shasum -a 256 -c falcon-ecs-patch.sh.sha256) && chmod +x falcon-ecs-patch.sh
```

> **Verify:** The output is `falcon-ecs-patch.sh: OK`.

- [ ] Read what you are about to run. It is one bash file:

```bash
./falcon-ecs-patch.sh --help
```

## 3. Copy the Sensor Image into ECR

> **What & Why:** The patched task pulls the sensor from your own ECR using the task **execution role**, so no pull secret is needed at runtime. `setup` wraps CrowdStrike's `falcon-container-sensor-pull.sh --copy`.

> **Why this matters:** The ECR repository name must be `falcon-container`, because the copy keeps the image name. If a `falcon-container` repo already holds an ARM64-only image, `patch` stops with a clear message and `setup --sensor-repo <name>/falcon-container` copies into a fresh repo.

### Step 1: Run setup

- [ ] Pick the Falcon cloud your CID belongs to, then run `setup`:

<div data-choice-picker="falconcloud"></div>

<div data-choice="falconcloud:commercial">

```bash
./falcon-ecs-patch.sh setup
```

</div>

<div data-choice="falconcloud:govcloud-1">

```bash
./falcon-ecs-patch.sh setup --falcon-cloud us-gov-1
```

</div>

<div data-choice="falconcloud:govcloud-2">

```bash
./falcon-ecs-patch.sh setup --falcon-cloud us-gov-2
```

</div>

- [ ] In the console, open **Amazon ECR** > **Private registry** > **Repositories** > `falcon-container` and confirm a tag like `8.12.0-8207` is listed. The untagged rows beneath it are the per-architecture images the tag points to; ignore them.

> **Verify:** The script's last line is the image URI, and the repository shows a tag like `8.12.0-8207`.

<details>
<summary>CLI equivalent</summary>

```bash
aws ecr describe-images --repository-name falcon-container --region $AWS_REGION --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text
```

</details>

### Step 2: Capture the image URI

- [ ] Build the URI the manual steps below use:

```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export SENSOR_TAG=$(aws ecr describe-images --repository-name falcon-container --region $AWS_REGION --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
export SENSOR_IMAGE=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/falcon-container:$SENSOR_TAG
echo $SENSOR_IMAGE
```

## 4. Patch by Hand Once

> **What & Why:** The script automates five steps. Run them once manually so you see what it does for you, and so you can still patch if the script is ever unavailable. Everything here uses only `aws`, `jq`, and `docker`.

### Step 1: Export the task definition

> **Why this matters:** `describe-task-definition` returns fields that ECS manages itself (the ARN, revision, status, and so on). If you feed them back into `register-task-definition`, it fails with `parameter validation failed`. They must be removed first.

- [ ] In the console, open **Amazon ECS** > **Task definitions**, select your family, open the latest revision, and choose the **JSON** tab. This is the file you are about to export.

- [ ] Look up which task definition your service runs and keep it in a variable:

```bash
export TASK_DEF=$(aws ecs describe-services --cluster <CLUSTER_NAME> --services <SERVICE_NAME> --region $AWS_REGION --query 'services[0].taskDefinition' --output text)
echo $TASK_DEF
```

> **Verify:** It prints an ARN ending in `<family>:<revision>`. The revision should match the **Task definition** column you saw on the service.

- [ ] Save the task definition without the managed fields:

```bash
mkdir -p manual && aws ecs describe-task-definition --task-definition $TASK_DEF --region $AWS_REGION --query taskDefinition \
  | jq 'del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy,.tags,.deregisteredAt)' > manual/taskdef.json
```

> **Verify:** `jq -r .family manual/taskdef.json` prints your task family name.

### Step 2: Build the pull token

> **What & Why:** At patch time the utility reads each app image's entrypoint and command, so it needs credentials for your registry. The pull token is a base64-encoded Docker config. It is only for patching; ECS pulls at runtime with the execution role.

> **Warning:** Avoid `cat ~/.docker/config.json | base64`. On Docker Desktop that file holds a credential-helper pointer, not credentials, so the utility fails with `Failed to retrieve image details (credentials tried: 2)`. Build the token explicitly.

- [ ] Create the token for your ECR registry. ECR tokens expire after 12 hours, so build it right before you patch:

```bash
export ECR_REGISTRY=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
export IMAGE_PULL_TOKEN=$(printf '{"auths":{"%s":{"auth":"%s"}}}' "$ECR_REGISTRY" "$(printf 'AWS:%s' "$(aws ecr get-login-password --region $AWS_REGION)" | base64 | tr -d '\n')" | base64 | tr -d '\n')
```

### Step 3: Run the patching utility

> **What & Why:** The utility lives inside the sensor image. You mount the folder holding the task definition into the container, point `-ecs-spec-file` at it, and the patched JSON comes out on stdout.

- [ ] Log Docker in to ECR so it can pull the sensor image:

```bash
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
```

- [ ] Run the utility. `--platform linux/amd64` matters on Apple Silicon: Fargate runs x86_64, and without it Docker picks the ARM build and the patched task would carry the wrong loader:

```bash
docker run --rm --platform linux/amd64 -v $(pwd)/manual:/var/run/spec $SENSOR_IMAGE \
  -cid $FALCON_CID -image $SENSOR_IMAGE -pulltoken $IMAGE_PULL_TOKEN \
  -ecs-spec-file /var/run/spec/taskdef.json > manual/taskdef.patched.json
```

> **Warning:** If you see `Failed to retrieve image details (credentials tried: N)` and your app image is public or in this ECR, the cause is usually a corporate TLS proxy (such as Zscaler) re-signing traffic that the container does not trust. Mount a full CA bundle (system roots plus your proxy CA): add `-e SSL_CERT_FILE=/etc/ssl/custom-ca.pem -v /path/to/full-bundle.pem:/etc/ssl/custom-ca.pem:ro` to the `docker run`. The script does this for you with `--ca-bundle`.

### Step 4: Read the diff

- [ ] Compare original and patched:

```bash
diff -u <(jq -S . manual/taskdef.json) <(jq -S . manual/taskdef.patched.json)
```

> **Look for:** One added container, `crowdstrike-falcon-init-container`, and a new volume `crowdstrike-falcon-volume`. On each of your containers: `dependsOn` the init container, an `entryPoint` that starts the sensor first and then your original command, `FALCONCTL_OPTS` carrying your CID, `SYS_PTRACE`, and a read-only mount at `/tmp/CrowdStrike`.

> **Note:** The patched file contains your CID. It is an identifier, not a secret, but avoid pasting the diff into public places.

That is the whole mechanism. You have not changed anything in ECS yet: the patched file is only on your machine. The only steps left are registering it as a new revision and pointing the service at it, which the script does for you along with everything above.

## 5. Use the Script

> **What & Why:** Same mechanism, with the audit, diff, rollout wait, idempotence, and rollback command built in.

### Step 1: Audit the cluster

- [ ] See what is unprotected (read-only):

```bash
./falcon-ecs-patch.sh audit --cluster <CLUSTER_NAME>
```

> **Verify:** Your service shows `FARGATE`, `X86_64`, and `UNPROTECTED`, with `-` in the `SENSOR` column (the sensor tag once protected). EC2-launch and ARM64 services are reported but not patched.

### Step 2: Preview the patch

- [ ] Dry run. Nothing in ECS changes:

```bash
./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <SERVICE_NAME>
```

> **Verify:** The diff matches what you saw in section 4. The original and patched JSON are saved under `./falcon-ecs-patch-out/<family>/`.

> **Look for:** The `Rollout:` line shows the service's minimum and maximum healthy percent, the circuit breaker, and the task size. The sensor shares the task's CPU and memory, so check there is headroom. A `NOTE` that the circuit breaker is off means a failed rollout will not roll back by itself: enable it on the service (command below). A `WARN` about no public IP means tasks need a NAT route to reach the Falcon cloud (TLS 443) or no sensor will ever register. A `NOTE` about the `CODE_DEPLOY` or `EXTERNAL` deployment controller means the script registers the revision but leaves the service alone; deploy it with your own process.

- [ ] If the circuit breaker is off, turn it on before you deploy. In the console, open the service, choose **Update service**, and under **Deployment options** > **Deployment failure detection** select **Use the Amazon ECS deployment circuit breaker**, then **Rollback on failures**.

<details>
<summary>CLI equivalent</summary>

```bash
aws ecs update-service --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true}" --region $AWS_REGION
```

</details>

### Step 3: Deploy

- [ ] Use a non-production service first. Register the patched revision, update the service, and wait until stable. It prints the diff, then asks `[y/N]`; type `y` to continue:

```bash
./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --deploy
```

> **Warning:** If Terraform, CDK, or CloudFormation owns this task definition, its next apply overwrites the revision registered here and the sensor disappears. See the warning at the top of this lab.

> **Heads-up:** If you see `--deploy needs a terminal to confirm`, the command is not running in an interactive terminal (a CI job, a script, a piped shell). Add `--yes` to skip the prompt. Any answer other than `y` prints `Aborted.` and changes nothing.

> **Verify:** The output ends with `Registered: <family>:<N>` and a `Roll back with:` command. Keep it.

> **Why this matters:** In ECS terms, `--deploy` did two things: it registered the patched JSON as a new task definition revision, then told the service to use it. The service replaces tasks gradually: ECS starts new tasks on the patched revision, waits until they are healthy, then stops the old ones. If a new task fails to start, the old task keeps running.

### Step 4: Run it again

- [ ] Run the same preview again:

```bash
./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <SERVICE_NAME>
```

> **Verify:** It prints `SKIP  already protected` and changes nothing. That idempotence is what makes it safe to run on every deploy in CI.

### Step 5: Upgrade the sensor later

> **What & Why:** Step 4 skipped the service because it was already protected, and that is also why re-running never changes the sensor version. To move to a newer sensor you patch the original, unpatched revision again.

- [ ] Copy the newer image into ECR (it adds a tag; older tags stay), then check which sensor each service runs in the `SENSOR` column:

```bash
./falcon-ecs-patch.sh setup
./falcon-ecs-patch.sh audit --cluster <CLUSTER_NAME>
```

- [ ] Patch the unpatched revision (use the revision you saw before step 3; it is `1` for a brand new service):

```bash
./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --from-revision <UNPATCHED_REVISION>
```

> **Verify:** The `+ added init container` line shows the newer image tag. Add `--deploy` to roll it out.

### Step 6: Optional flags

> **Heads-up:** Tags allow letters, numbers, `-`, `_`, and `/` only. A space in a tag breaks the sensor, and the app container then exits before it starts.

- [ ] When you patch your next service, you can group its hosts in the Falcon console with sensor tags and keep a container out of the patch (for example a log router):

```bash
./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <OTHER_SERVICE_NAME> --falconctl-opts "--tags=ecs-fargate,lab" --skip-container <CONTAINER_TO_SKIP>
```

## 6. Verify

> **What & Why:** Two independent checks: ECS shows the sensor files were copied and the app started, and the Falcon console shows the sensor reached the cloud.

### Step 1: Check the task in ECS

- [ ] In the console, open **Amazon ECS** > **Clusters** > your cluster > your service > **Tasks**, open the newest task, and look at the **Containers** table.

> **Verify:** In the **Containers** table, `crowdstrike-falcon-init-container` has **Status** `Stopped` and `Exit code: 0` (shown under **Health status**), and your app container is `Running`. The init container is expected to stop: it only copies files.

<details>
<summary>CLI equivalent</summary>

```bash
export TASK_ID=$(aws ecs list-tasks --cluster <CLUSTER_NAME> --service-name <SERVICE_NAME> --region $AWS_REGION --desired-status RUNNING --query 'taskArns[0]' --output text | awk -F/ '{print $NF}')
aws ecs describe-tasks --cluster <CLUSTER_NAME> --tasks $TASK_ID --region $AWS_REGION --query 'tasks[0].containers[].{Name:name,Status:lastStatus,Exit:exitCode}' --output table
```

</details>

> **Heads-up:** If the init container fails with `CannotPullContainerError`, the execution role cannot pull from your ECR. Attach `AmazonECSTaskExecutionRolePolicy` to it. If the service never stabilizes, ECS keeps your old task running; check the service **Events** tab.

### Step 2: Check the Falcon console

- [ ] Go to **Host setup and management** > **Host management**, add a **Pod ID** filter, and enter your task ID **with dashes** in the 8-4-4-4-12 pattern. Print it:

```bash
echo $TASK_ID | sed -E 's/^(.{8})(.{4})(.{4})(.{4})(.{12})$/\1-\2-\3-\4-\5/'
```

> **Look for:** A host entry with a populated **Host ID** (the sensor's AID). The sensor registers about two minutes after the task starts and the console can lag a few minutes beyond that, so an empty result right after the deploy is normal; refresh and wait. No entry after ten minutes usually means the task cannot reach the Falcon cloud: it needs a public IP or a NAT route.

> **Note:** ECS Exec is off by default, so this lab does not exec into the container. If you enabled it, `/tmp/CrowdStrike/rootfs/bin/falconctl -g --aid` prints the AID.

### Step 3: Confirm the audit

- [ ] Re-run the audit as a gate:

```bash
./falcon-ecs-patch.sh audit --cluster <CLUSTER_NAME> --fail-on-unprotected
```

> **Verify:** Status `PROTECTED` and exit code 0 (`echo $?`). With any unprotected service it exits 3.

## 7. Clean Up

> **Destructive:** These commands delete the sensor image. Only run them for a lab you created; do not delete a repository your production tasks pull from.

- [ ] Roll the service back to the unpatched revision. Use the command `--deploy` printed, or in the console choose **Update service** and pick the original revision.

```bash
aws ecs update-service --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --task-definition <PREVIOUS_REVISION_ARN> --region $AWS_REGION
```

- [ ] Delete the sensor repository and local files:

```bash
aws ecr delete-repository --repository-name falcon-container --force --region $AWS_REGION
rm -rf manual falcon-ecs-patch-out falcon-ecs-patch.sh falcon-ecs-patch.sh.sha256
```

> **Note:** Host entries stay in the Falcon console for a while after the tasks are gone. Patched task definition revisions remain in ECS; deregister them from **Task definitions** if you want them gone.

## Challenges

1. **Run it from your pipeline.** Quick Deploy has a **CI pipeline** path; build it end to end. Put a sample task definition JSON in a repository, add the two workflows, and open a pull request that changes the file. Confirm the patch step adds the init container and the service rolls.
2. **Catch drift.** Launch a second, unpatched service in the cluster and run `audit --cluster <CLUSTER_NAME> --fail-on-unprotected` (or the scheduled workflow). The job fails and tells you which service.
3. **Practice the rollback.** Deploy, then roll back to the previous revision with only the printed command, and confirm `audit` flips back to `UNPROTECTED`. Rolling back by revision is the safety net that makes this change low-risk for a customer.
4. **Cross-account ECR.** `setup` copies the sensor into one account and region. To share one repository, add an ECR repository policy that allows `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, and `ecr:BatchCheckLayerAvailability` for the other accounts' task execution roles, then pass `--sensor-image <FULL_ECR_IMAGE_URI>` when patching. Run `patch` once per account with that account's credentials.

## Quick Reference

| Task | Command |
|------|---------|
| Copy sensor image to ECR | `./falcon-ecs-patch.sh setup` |
| Find unprotected services | `./falcon-ecs-patch.sh audit --cluster <CLUSTER_NAME>` |
| Preview a patch | `./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <SERVICE_NAME>` |
| Patch and deploy | add `--deploy` (and `--yes` in CI) |
| Patch every unprotected service | `patch --cluster <CLUSTER_NAME> --all --deploy` |
| Patch without touching a service | `patch --family <FAMILY> --deploy` (prints the new task definition ARN) |
| Patch a task definition file from Git | `patch --file <FILE> --output <PATCHED_FILE>` (registers nothing) |
| Upgrade the sensor | `setup`, then `patch --service <SERVICE_NAME> --from-revision <UNPATCHED_REVISION> --deploy` |
| CI gate | `audit --cluster <CLUSTER_NAME> --fail-on-unprotected` (exit 3 on drift) |
| Skip a container | `--skip-container <NAME>` |
| Corporate TLS proxy | `--ca-bundle /path/to/full-bundle.pem` |
| Find the sensor in Falcon | Host management > **Pod ID** = task ID with dashes |

</div>

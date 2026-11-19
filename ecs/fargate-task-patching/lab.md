# Falcon Container Sensor on ECS Fargate — Task Definition Patching

Protect an existing ECS Fargate service by patching its task definition with the Falcon Container Sensor. You use `falcon-ecs-patch`, a small open-source wrapper around CrowdStrike's official patching utility. It finds unprotected services, shows you a diff of exactly what changes, deploys, and prints the rollback command. The same script runs unchanged in CI/CD once the proof of value is done.

> **Prerequisites:**
>
> - An ECS cluster with a <span data-tip="Fargate runs containers without servers you manage. v0.1 of the script supports X86_64 tasks with images in ECR. ARM64 (Graviton) and EC2 launch type are not covered.">Fargate service</span> running
> - AWS account with the `aws` CLI <span data-tip="aws sts get-caller-identity should print your account.">configured</span>
> - <span data-tip="Runs the official patching utility. It must be running: docker info should print server details, not an error. Start Docker Desktop if it fails.">Docker</span> installed **and running**, plus `jq` and `curl`
> - Permission to <span data-tip="Register ECS task definitions, update the service, and create ECR repositories and push images in that account. iam:PassRole on the task and execution roles is also needed to register a task definition.">change the ECS service</span>
> - Task <span data-tip="The IAM role ECS uses to pull images and write logs. For same-account ECR the AWS managed policy AmazonECSTaskExecutionRolePolicy is enough. The script warns if it cannot confirm pull access.">execution role</span> that can pull from ECR
> - CrowdStrike Falcon API <span data-tip="Only used once to copy the sensor image into your ECR. Create the client with Falcon Images Download (Read) and Sensor Download (Read).">credentials</span> (Client ID + Secret)
> - CrowdStrike <span data-tip="Use the full Customer ID including the checksum suffix. The tip below shows where to find it.">CID</span> (with checksum)

> **Tip:** Where to find your Falcon credentials:
>
> - **CID (with checksum):** in the Falcon console, go to **Host setup and management** > **Deploy** > **Sensor downloads** and copy the **Customer ID** from the right panel. Direct link: [US-1](https://falcon.crowdstrike.com/sensor-downloads/all) | [US-2](https://falcon.us-2.crowdstrike.com/sensor-downloads/all) | [EU-1](https://falcon.eu-1.crowdstrike.com/sensor-downloads/all). On GovCloud, open the same page on your GovCloud console host.
> - **API client:** go to **Support and resources** > **Client Management** > **API Clients** > **Create API client**. Copy the client secret right away; the console shows it only once.

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

### 1. Set your values

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,AWS_REGION:AWS region,CLUSTER_NAME:ECS cluster name,SERVICE_NAME:ECS service name"></div>

Copy this to export the values the script reads. The API client secret is only ever passed through the environment, never a flag, so it does not show up in process lists or CI logs:

```bash
export AWS_REGION="<AWS_REGION>"
export FALCON_CID="<FALCON_CID>"
export FALCON_CLIENT_ID="<FALCON_CLIENT_ID>"
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

### 2. Download the script and verify it

Download a pinned release and its checksum, then verify before running anything:

```bash
VERSION=v0.1.0
BASE=https://github.com/vianneyp72/falcon-ecs-patch/releases/download/$VERSION
curl -fsSLO $BASE/falcon-ecs-patch.sh
curl -fsSLO $BASE/falcon-ecs-patch.sh.sha256
```

Check the file matches its published checksum, then make it executable:

```bash
shasum -a 256 -c falcon-ecs-patch.sh.sha256 && chmod +x falcon-ecs-patch.sh
```

> **Verify:** The output is `falcon-ecs-patch.sh: OK`. Anything else means the download is corrupt or was changed; do not run it.

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

> **Verify:** The last line is an image URI like `<account>.dkr.ecr.<region>.amazonaws.com/falcon-container:8.12.0-8207`. You do not need to copy it; later steps find the newest tag automatically.

### 4. See what is unprotected

`audit` only reads. It lists every service in the cluster and whether its task definition already has the Falcon init container:

```bash
./falcon-ecs-patch.sh audit --cluster <CLUSTER_NAME>
```

> **Verify:** Your service shows `FARGATE` and `X86_64`, with status `UNPROTECTED`.

### 5. Preview the patch

This is a dry run by default. It exports the task definition, runs the patching utility, and prints a diff. Nothing in ECS changes:

```bash
./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <SERVICE_NAME>
```

> **Verify:** The summary lists `+ added init container: crowdstrike-falcon-init-container` and one `~ wrapped entrypoint` line per app container. The original and patched JSON are saved under `./falcon-ecs-patch-out/`.

### 6. Deploy

`--deploy` registers the patched revision, points the service at it, and waits until the service is stable. It asks for confirmation first:

```bash
./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --deploy
```

> **Verify:** It ends with `Registered: <family>:<N+1>` and a `Roll back with:` command. Copy that command somewhere safe.

### 7. Verify

Capture the new task's ID and list its containers:

```bash
export TASK_ID=$(aws ecs list-tasks --cluster <CLUSTER_NAME> --service-name <SERVICE_NAME> --region $AWS_REGION --query 'taskArns[0]' --output text | awk -F/ '{print $NF}')
aws ecs describe-tasks --cluster <CLUSTER_NAME> --tasks $TASK_ID --region $AWS_REGION --query 'tasks[0].containers[].{Name:name,Status:lastStatus,Exit:exitCode}' --output table
```

> **Verify:** `crowdstrike-falcon-init-container` is `STOPPED` with `Exit` `0`, and your app container is `RUNNING`.

The Falcon console shows the task ID as a dashed UUID. Print yours in that form:

```bash
echo $TASK_ID | sed -E 's/^(.{8})(.{4})(.{4})(.{4})(.{12})$/\1-\2-\3-\4-\5/'
```

In the Falcon console go to **Host setup and management** > **Host management**, add a **Pod ID** filter, and paste that value.

> **Look for:** A host entry with a populated **Host ID** within a few minutes. No entry after five minutes usually means the task cannot reach the Falcon cloud; check that the service has a public IP or a NAT route.

Run the audit again to see the service protected:

```bash
./falcon-ecs-patch.sh audit --cluster <CLUSTER_NAME> --fail-on-unprotected
```

> **Verify:** Status is `PROTECTED` and the command exits 0. With any unprotected service it exits 3, which is what makes it useful as a CI gate.

### 8. Roll back (optional)

Paste the `Roll back with:` command that `--deploy` printed. It points the service back at the previous revision, which has no sensor:

```bash
aws ecs update-service --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --task-definition <PREVIOUS_REVISION_ARN> --region $AWS_REGION
```

> **Note:** Rolling back does not delete the patched revision. Re-running `patch` later protects the service again.

</div>

<div data-mode="lab">

## 1. Your Environment

> **What & Why:** The script works against a cluster and service that already exist. This section gets the values in one place, and gives you a sample service if you do not have one handy.

### Step 1: Set your values

- [ ] Fill in the values below once. Every command in this lab uses them.

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,AWS_REGION:AWS region,CLUSTER_NAME:ECS cluster name,SERVICE_NAME:ECS service name"></div>

- [ ] Export the values the script reads. The secret travels only through the environment, never a flag:

```bash
export AWS_REGION="<AWS_REGION>"
export FALCON_CID="<FALCON_CID>"
export FALCON_CLIENT_ID="<FALCON_CLIENT_ID>"
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

### Step 2: Find your service (or create a sample)

> **What & Why:** The patch targets a **service**, which keeps tasks running from a task definition. You need its cluster name and service name.

- [ ] In the AWS console, open **Amazon ECS** > **Clusters**, select your cluster, and open the **Services** tab. Note the service name and the **Task definition: revision** column.

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
VERSION=v0.1.0
BASE=https://github.com/vianneyp72/falcon-ecs-patch/releases/download/$VERSION
curl -fsSLO $BASE/falcon-ecs-patch.sh
curl -fsSLO $BASE/falcon-ecs-patch.sh.sha256
```

- [ ] Verify the checksum, then make the script executable:

```bash
shasum -a 256 -c falcon-ecs-patch.sh.sha256 && chmod +x falcon-ecs-patch.sh
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

- [ ] In the console, open **Amazon ECR** > **Private repositories** > `falcon-container` and confirm one image tag exists.

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

> **Verify:** It prints an ARN ending in `<family>:<revision>`. The revision should match the **Task definition: revision** column you saw on the service.

- [ ] Save the task definition without the managed fields:

```bash
mkdir -p manual && aws ecs describe-task-definition --task-definition $TASK_DEF --region $AWS_REGION --query taskDefinition \
  | jq 'del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy,.tags,.deregisteredAt)' > manual/taskdef.json
```

> **Verify:** `jq -r .family manual/taskdef.json` prints your task family name.

### Step 2: Build the pull token

> **What & Why:** At patch time the utility reads each app image's entrypoint and command, so it needs credentials for your registry. The pull token is a base64-encoded Docker config. It is only for patching; ECS pulls at runtime with the execution role.

> **Warning:** Do not use `cat ~/.docker/config.json | base64`. On Docker Desktop that file holds a credential-helper pointer, not credentials, so the utility fails with `Failed to retrieve image details (credentials tried: 2)`. Build the token explicitly.

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

> **Verify:** Your service shows `FARGATE`, `X86_64`, and `UNPROTECTED`. EC2-launch and ARM64 services are reported but not patched.

### Step 2: Preview the patch

- [ ] Dry run. Nothing in ECS changes:

```bash
./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <SERVICE_NAME>
```

> **Verify:** The diff matches what you saw in section 4. The original and patched JSON are saved under `./falcon-ecs-patch-out/<family>/`.

### Step 3: Deploy

- [ ] Register the patched revision, update the service, and wait until stable. It asks for confirmation:

```bash
./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <SERVICE_NAME> --deploy
```

> **Verify:** The output ends with `Registered: <family>:<N>` and a `Roll back with:` command. Keep it.

> **Why this matters:** In ECS terms, `--deploy` did two things: it registered the patched JSON as a new task definition revision, then told the service to use it. The service replaces tasks gradually: ECS starts new tasks on the patched revision, waits until they are healthy, then stops the old ones. If a new task fails to start, the old task keeps running.

### Step 4: Run it again

- [ ] Run the same preview again:

```bash
./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <SERVICE_NAME>
```

> **Verify:** It prints `SKIP  already protected` and changes nothing. That idempotence is what makes it safe to run on every deploy in CI.

### Step 5: Optional flags

> **Heads-up:** Tags allow letters, numbers, `-`, `_`, and `/` only. A space in a tag breaks the sensor, and the app container then exits before it starts.

- [ ] When you patch your next service, you can group its hosts in the Falcon console with sensor tags and keep a container out of the patch (for example a log router):

```bash
./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <OTHER_SERVICE_NAME> --falconctl-opts "--tags=ecs-fargate,lab" --skip-container <CONTAINER_TO_SKIP>
```

## 6. Verify

> **What & Why:** Two independent checks: ECS shows the sensor files were copied and the app started, and the Falcon console shows the sensor reached the cloud.

### Step 1: Check the task in ECS

- [ ] In the console, open **Amazon ECS** > **Clusters** > your cluster > your service > **Tasks**, open the newest task, and look at the **Containers** table.

> **Verify:** `crowdstrike-falcon-init-container` is `Stopped` with exit code `0`, and your app container is `Running`. The init container is expected to stop: it only copies files.

<details>
<summary>CLI equivalent</summary>

```bash
export TASK_ID=$(aws ecs list-tasks --cluster <CLUSTER_NAME> --service-name <SERVICE_NAME> --region $AWS_REGION --query 'taskArns[0]' --output text | awk -F/ '{print $NF}')
aws ecs describe-tasks --cluster <CLUSTER_NAME> --tasks $TASK_ID --region $AWS_REGION --query 'tasks[0].containers[].{Name:name,Status:lastStatus,Exit:exitCode}' --output table
```

</details>

> **Heads-up:** If the init container fails with `CannotPullContainerError`, the execution role cannot pull from your ECR. Attach `AmazonECSTaskExecutionRolePolicy` to it. If the service never stabilizes, ECS keeps your old task running; check the service **Events** tab.

### Step 2: Check the Falcon console

- [ ] Go to **Host setup and management** > **Host management**, add a **Pod ID** filter, and enter your task ID **with dashes** in the 8-4-4-4-12 pattern. Print it:

```bash
echo $TASK_ID | sed -E 's/^(.{8})(.{4})(.{4})(.{4})(.{12})$/\1-\2-\3-\4-\5/'
```

> **Look for:** A host entry with a populated **Host ID** (the sensor's AID) within a few minutes. No entry after five minutes usually means the task cannot reach the Falcon cloud: it needs a public IP or a NAT route.

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

1. **Gate your pipeline.** Add `./falcon-ecs-patch.sh patch --family <FAMILY> --deploy --yes` to your CI/CD job, right before the step that updates the service. Every new revision is then patched automatically, and re-runs are safe because protected task definitions are skipped. A starter workflow is in the repo's `examples/` folder.
2. **Catch drift.** Schedule `audit --cluster <CLUSTER_NAME> --fail-on-unprotected` nightly. When someone launches a new unprotected service, the job fails and tells you which one.
3. **Practice the rollback.** Deploy, then roll back to the previous revision with only the printed command, and confirm `audit` flips back to `UNPROTECTED`. Rolling back by revision is the safety net that makes this change low-risk for a customer.

## Quick Reference

| Task | Command |
|------|---------|
| Copy sensor image to ECR | `./falcon-ecs-patch.sh setup` |
| Find unprotected services | `./falcon-ecs-patch.sh audit --cluster <CLUSTER_NAME>` |
| Preview a patch | `./falcon-ecs-patch.sh patch --cluster <CLUSTER_NAME> --service <SERVICE_NAME>` |
| Patch and deploy | add `--deploy` (and `--yes` in CI) |
| Patch every unprotected service | `patch --cluster <CLUSTER_NAME> --all --deploy` |
| Patch without touching a service | `patch --family <FAMILY> --deploy` |
| CI gate | `audit --cluster <CLUSTER_NAME> --fail-on-unprotected` (exit 3 on drift) |
| Skip a container | `--skip-container <NAME>` |
| Corporate TLS proxy | `--ca-bundle /path/to/full-bundle.pem` |
| Find the sensor in Falcon | Host management > **Pod ID** = task ID with dashes |

</div>

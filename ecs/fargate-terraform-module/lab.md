# Falcon Container Sensor on ECS Fargate — CrowdStrike Terraform Module

Add the Falcon Container Sensor to an ECS Fargate service you already manage with Terraform, using CrowdStrike's official `terraform-aws-ecs-fargate` module. The module replaces your `aws_ecs_task_definition`, and your service, cluster, and network stay as they are. The sensor image is hosted in your own ECR.

> **Prerequisites:**
>
> - An ECS cluster and a Fargate service already managed by Terraform, and the folder that holds that Terraform. You will edit it, so run `terraform plan` there first and confirm it shows no changes
> - An AWS account and the `aws` CLI configured (`aws sts get-caller-identity` prints your account)
> - Terraform 1.0 or later installed (`terraform version` prints a version) and `git`
> - Docker, Podman, or Skopeo installed **and running** (to copy the sensor image to ECR; `docker info` should print server details, not an error. Start Docker Desktop if it fails)
> - Permission to register ECS task definitions and update the service in that account (and to create the extra service and security group if you run the optional detection test)
> - CrowdStrike Falcon API credentials (Client ID + Secret)
>   - Required scopes to pull the sensor image:
>     - **Falcon Images Download** (Read)
>     - **Sensor Download** (Read)
> - CrowdStrike CID (with checksum)

> **Tip:** Where to find your Falcon credentials:
>
> - **CID (with checksum):** in the Falcon console, go to **Host setup and management** > **Deploy** > **Sensor downloads** and copy the **Customer ID** from the right panel. Direct link: [US-1](https://falcon.crowdstrike.com/sensor-downloads/all) | [US-2](https://falcon.us-2.crowdstrike.com/sensor-downloads/all) | [EU-1](https://falcon.eu-1.crowdstrike.com/sensor-downloads/all). On GovCloud, open the same page on your GovCloud console host.
> - **API client:** go to **Support and resources** > **Client Management** > **API Clients** > **Create API client**. Copy the client secret right away; the console shows it only once.

## Reference Docs

| Source | Link |
| ------ | ---- |
| Deploy Falcon Container Sensor for Linux on ECS Fargate | https://docs.crowdstrike.com/r/en-US/iopiipqy/ba83eb6c |
| terraform-aws-ecs-fargate module | https://github.com/CrowdStrike/terraform-aws-ecs-fargate |
| falcon-container-sensor-pull script | https://github.com/CrowdStrike/falcon-scripts/tree/main/bash/containers/falcon-container-sensor-pull |
| ECS task definitions | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html |

---

## Core Concepts

On Fargate there is no host to install an agent on, so the sensor travels inside the task. In ECS, a **task definition** is the blueprint for the containers a task runs, and a **service** keeps the desired number of tasks running from it. The module builds a task definition with two containers:

- **Init container** (`crowdstrike-falcon-init-container`) — runs first, copies the sensor files into a volume shared with your app, then exits.
- **Application container** — your app, started through the Falcon entrypoint so the sensor launches before it. The module adds the `SYS_PTRACE` capability the sensor needs.

The module does not create a cluster or service. You call it from your own Terraform, in place of your current `aws_ecs_task_definition`, and point your existing `aws_ecs_service` at the task definition it outputs. On the next apply ECS rolls the service onto the new task definition, so your tasks restart once, now carrying the sensor.

You copy the sensor image into your own ECR because Fargate pulls images with the **execution role** (the IAM role ECS uses to pull images from ECR and write logs, not something your app code uses). Same-account ECR needs no pull secret. This guide reuses your existing execution role and log group, so the module adds only the task definition.

```
ECS FARGATE TERRAFORM MODULE — ARCHITECTURE
CrowdStrike Registry | Your ECR | Terraform Module
Your existing ECS cluster | Your existing service
ECS Fargate Task — crowdstrike-falcon-init-container | Shared volume | Application container
Execution role pulls the image from ECR
CrowdStrike Cloud — Telemetry
```

---

## Deployment Steps

<div data-mode="guide">

### 1. Set credentials

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,AWS_ACCOUNT_ID:AWS account ID,AWS_REGION:AWS region,CLUSTER_NAME:ECS cluster name,SERVICE_NAME:ECS service name"></div>

Then copy this to export the API client secret. It is the only value kept as a shell variable, and the page never saves it:

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

### 2. Copy the Falcon sensor image to ECR

Create an ECR repository for the sensor (skips if it already exists). The repo name must be `falcon-container` because `--copy` does not rename images:

```bash
aws ecr describe-repositories --repository-names falcon-container --region <AWS_REGION> >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name falcon-container --region <AWS_REGION> --query repository.repositoryUri --output text
```

> **Verify:** A new repo prints its address (`<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-container`). Nothing prints if it already exists.

Log Docker in to your ECR registry (the pull script does not log in to the destination):

```bash
aws ecr get-login-password --region <AWS_REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

Pick the Falcon cloud your CID belongs to, then copy the `falcon-container` image from CrowdStrike's registry into your ECR:

<div data-choice-picker="falconcloud"></div>

<div data-choice="falconcloud:commercial">

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-container --copy <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

</div>

<div data-choice="falconcloud:govcloud-1">

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-container --region us-gov-1 --copy <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

</div>

<div data-choice="falconcloud:govcloud-2">

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-container --region us-gov-2 --copy <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

</div>

### 3. Read the image tag from ECR

`--copy` keeps the image tag, so read it back from ECR. This is the exact image the task will pull:

```bash
export FALCON_IMAGE_TAG=$(aws ecr describe-images --repository-name falcon-container --region <AWS_REGION> --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
```

Validate the client secret and tag were populated (a ✅ means set, a ❌ means missing):

```bash
echo "Client Secret : $([ -n "$FALCON_CLIENT_SECRET" ] && echo ✅ || echo ❌)"
echo "Image tag     : $([ -n "$FALCON_IMAGE_TAG" ] && [ "$FALCON_IMAGE_TAG" != None ] && echo ✅ || echo ❌) ($FALCON_IMAGE_TAG)"
```

> **Verify:** The tag looks like `7.39.0-7802`. `None` means the copy in step 2 did not finish; re-run it and read the error.

### 4. Look up your app's entrypoint

Move to the folder that holds your ECS Terraform (the one with your `aws_ecs_service`). Every command from here on runs in that folder.

The module starts the sensor by wrapping your app's **entrypoint** (the program the container runs on start). It only wraps what you tell it, so the module needs your app's entrypoint and command written out. Find them in your existing `aws_ecs_task_definition`: the `name`, `image`, and port in its `container_definitions`.

<div data-fill-fields="APP_NAME:Container name (also the task definition family),APP_IMAGE:App image,APP_PORT:Container port"></div>

Read the entrypoint and command baked into your image:

```bash
docker pull -q <APP_IMAGE> >/dev/null && docker image inspect <APP_IMAGE> --format 'Entrypoint: {{json .Config.Entrypoint}}  Cmd: {{json .Config.Cmd}}'
```

> **Verify:** For the sample nginx image this prints `Entrypoint: ["/docker-entrypoint.sh"]  Cmd: ["nginx","-g","daemon off;"]`. Note both values. If your task definition sets its own `entryPoint` or `command`, use those instead.

> **Why this matters:** Without `app_entrypoint` the app runs normally but the sensor never starts, and nothing warns you. Always set it to your container's entrypoint.

### 5. Add the module to your Terraform

Add a new file beside your existing ones. It calls the module (pinned to a release with `?ref=`, so a new version never changes your infrastructure unannounced) and declares the two Falcon inputs. The module reuses your execution role and log group by their ARN and name, so it does not try to create ones that already exist:

```bash
cat > falcon.tf <<'EOF'
variable "falcon_cid" {
  type      = string
  sensitive = true
}

variable "falcon_image" {
  type = string
}

module "falcon_ecs_task" {
  source = "github.com/CrowdStrike/terraform-aws-ecs-fargate?ref=v0.0.3"

  app_name       = "<APP_NAME>"
  app_image      = "<APP_IMAGE>"
  app_entrypoint = ["/docker-entrypoint.sh"]
  app_command    = ["nginx", "-g", "daemon off;"]

  app_port_mappings = [
    { containerPort = <APP_PORT>, protocol = "tcp" }
  ]

  falcon_image = var.falcon_image
  falcon_cid   = var.falcon_cid

  # Match your current task definition
  task_cpu    = "512"
  task_memory = "1024"

  # Reuse what you already have instead of creating duplicates
  create_execution_role = false
  execution_role_arn    = aws_iam_role.execution.arn
  create_log_group      = false
  log_group_name        = aws_cloudwatch_log_group.app.name
}
EOF
```

> **Heads-up:** Edit three things in `falcon.tf` to match your setup: `app_entrypoint` and `app_command` (the values from step 4), `aws_iam_role.execution` (your execution role resource), and `aws_cloudwatch_log_group.app` (your log group resource). Your resource names will differ from these.

Write the Falcon values to a variables file. Terraform loads any `*.auto.tfvars` file on its own:

```bash
cat > falcon.auto.tfvars <<EOF
falcon_cid   = "<FALCON_CID>"
falcon_image = "<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-container:$FALCON_IMAGE_TAG"
EOF
```

> **Note:** `falcon.auto.tfvars` and the state file contain your CID in plain text. Add `falcon.auto.tfvars` to your `.gitignore` before you commit anything.

### 6. Point your service at the module

Two edits in your existing files. First, delete your `aws_ecs_task_definition` resource. The module builds its replacement from the same `app_name`. Second, in your `aws_ecs_service`, swap the task definition for the module's output (the other two lines pass through the module's matching settings):

```hcl
resource "aws_ecs_service" "app" {
  name    = "..."
  cluster = aws_ecs_cluster.main.id

  task_definition        = module.falcon_ecs_task.task_definition_arn   # was aws_ecs_task_definition.app.arn
  platform_version       = module.falcon_ecs_task.platform_version
  enable_execute_command = module.falcon_ecs_task.enable_execute_command

  # ...everything else stays exactly as it was
}
```

Find anything else that still refers to the old resource:

```bash
grep -rn "aws_ecs_task_definition" --include='*.tf' .
```

> **Verify:** Only the module's own files should match; here that means no output. Change any match, such as an `output` block, to `module.falcon_ecs_task.task_definition_arn`.

### 7. Deploy

Download the module and providers:

```bash
terraform init
```

Preview the change before anything happens:

```bash
terraform plan
```

> **Verify:** The plan should show `1 to add, 1 to change, 1 to destroy`: the new task definition is added, your service is updated in place to use it, and your old task definition is removed. It should not touch your cluster, network, execution role, or log group. Anything else means a resource name in `falcon.tf` or the service edit is off; do not apply until the plan matches.

Apply it. Type `yes` when prompted:

```bash
terraform apply
```

### 8. Verify

ECS now replaces your running task with one built from the new task definition. Wait for the rollout; this returns when the service is stable (about a minute or two):

```bash
aws ecs wait services-stable --cluster <CLUSTER_NAME> --services <SERVICE_NAME> --region <AWS_REGION>
```

Capture the task ID and list its containers:

```bash
export TASK_ID=$(aws ecs list-tasks --cluster <CLUSTER_NAME> --service-name <SERVICE_NAME> --region <AWS_REGION> --query 'taskArns[0]' --output text | awk -F/ '{print $NF}')
aws ecs describe-tasks --cluster <CLUSTER_NAME> --tasks $TASK_ID --region <AWS_REGION> --query 'tasks[0].containers[].{Name:name,Status:lastStatus,Exit:exitCode}' --output table
```

> **Verify:** `crowdstrike-falcon-init-container` should be `STOPPED` with `Exit` `0` (it copies the sensor files and exits), and your app container (`<APP_NAME>`) should be `RUNNING`. If the service never stabilizes, run `aws ecs describe-services --cluster <CLUSTER_NAME> --services <SERVICE_NAME> --region <AWS_REGION> --query 'services[0].events[:3]'`; `CannotPullContainerError` means the image URI or tag in `falcon.auto.tfvars` is wrong, and ECS keeps your old task running until the new one is healthy.

Confirm the sensor registered in the Falcon console: go to **Host setup and management** > **Host management**, add a **Pod ID** filter set to your `$TASK_ID` (print it with `echo $TASK_ID`), and open the row.

> **Look for:** A host entry appears within a few minutes, and its **Host ID** is populated (this is the sensor's AID). No entry after five minutes usually means the task cannot reach the Falcon cloud, so check that it has a public IP or a NAT route.

### 9. Test a detection (optional)

Run CrowdStrike's vulnapp beside your service. It is a web app with buttons that fire safe, simulated attacks. It goes through the same module, so the sensor wraps it the same way. The security group below admits only your own IP address:

<div data-fill-fields="MY_IP_CIDR:Your public IP with /32 (for example 203.0.113.7/32)"></div>

> **Tip:** Print your public IP with `curl -s https://checkip.amazonaws.com` and add `/32`. If your company routes traffic through a VPN or proxy, use the address the proxy presents.

```bash
cat > detection.tf <<'EOF'
data "aws_subnet" "first" {
  id = tolist(aws_ecs_service.app.network_configuration[0].subnets)[0]
}

resource "aws_security_group" "vulnapp" {
  name        = "falcon-vulnapp-sg"
  description = "vulnapp web UI from one IP only"
  vpc_id      = data.aws_subnet.first.vpc_id

  ingress {
    description = "vulnapp UI"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["<MY_IP_CIDR>"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

module "falcon_vulnapp" {
  source = "github.com/CrowdStrike/terraform-aws-ecs-fargate?ref=v0.0.3"

  app_name       = "falcon-vulnapp"
  app_image      = "quay.io/crowdstrike/vulnapp"
  app_entrypoint = ["/entrypoint.sh"]

  app_port_mappings = [
    { containerPort = 8080, protocol = "tcp" }
  ]

  falcon_image = var.falcon_image
  falcon_cid   = var.falcon_cid

  create_execution_role = false
  execution_role_arn    = aws_iam_role.execution.arn
}

resource "aws_ecs_service" "vulnapp" {
  name            = "falcon-vulnapp"
  cluster         = aws_ecs_service.app.cluster
  task_definition = module.falcon_vulnapp.task_definition_arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_ecs_service.app.network_configuration[0].subnets
    security_groups  = [aws_security_group.vulnapp.id]
    assign_public_ip = true
  }
}
EOF
```

> **Heads-up:** This reuses your service's subnets and gives the task a public IP, so those subnets must be public (a route to an internet gateway). If your service runs in private subnets, use public ones here instead. Change `aws_iam_role.execution` and `aws_ecs_service.app` to your own resource names.

```bash
terraform init && terraform apply
```

Wait for it and look up the task's public IP:

```bash
aws ecs wait services-stable --cluster <CLUSTER_NAME> --services falcon-vulnapp --region <AWS_REGION>
export VULN_TASK=$(aws ecs list-tasks --cluster <CLUSTER_NAME> --service-name falcon-vulnapp --region <AWS_REGION> --query 'taskArns[0]' --output text)
export ENI_ID=$(aws ecs describe-tasks --cluster <CLUSTER_NAME> --tasks $VULN_TASK --region <AWS_REGION> --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value' --output text)
aws ec2 describe-network-interfaces --network-interface-ids $ENI_ID --region <AWS_REGION> --query 'NetworkInterfaces[0].Association.PublicIp' --output text
```

Open `http://<that IP>:8080` in your browser and click an attack simulation (for example **Access sensitive files** or **Kill process**). Then in the Falcon console go to **Next-Gen SIEM** > **Monitor and investigate** > **Detections** and filter **Source product** = **Cloud**.

> **Look for:** A detection naming the `falcon-vulnapp` task appears within a few minutes of the click.

### 10. Clean up (optional)

Remove the vulnapp first. Delete `detection.tf`, then apply so Terraform removes the vulnapp service, security group, and task definition:

```bash
rm detection.tf && terraform apply
```

To take the sensor off your service, put your original `aws_ecs_task_definition` back, point the service at it again, delete `falcon.tf` and `falcon.auto.tfvars`, and run `terraform apply`. ECS rolls the service back to a task without the sensor.

> **Do NOT:** Run `terraform destroy` here. It deletes everything in this Terraform folder, including your cluster and service, not just what this guide added.

Delete the ECR repository and the sensor image in it:

```bash
aws ecr delete-repository --repository-name falcon-container --force --region <AWS_REGION>
```

> **Note:** Host entries stay in the Falcon console for a while after the tasks are gone.

</div>

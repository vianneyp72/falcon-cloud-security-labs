# Falcon Container Sensor on ECS Fargate — CrowdStrike Terraform Module

Deploy a sample app on ECS Fargate protected by the Falcon Container Sensor, using CrowdStrike's official `terraform-aws-ecs-fargate` module, with the sensor image hosted in your own ECR.

> **Prerequisites:**
>
> - An AWS account and the `aws` CLI configured (`aws sts get-caller-identity` prints your account)
> - Terraform 1.0 or later installed (`terraform version` prints a version) and `git`
> - Docker, Podman, or Skopeo installed **and running** (to copy the sensor image to ECR; `docker info` should print server details, not an error. Start Docker Desktop if it fails)
> - A default VPC with public subnets in your region (most accounts have one; if yours was deleted, `aws ec2 create-default-vpc` recreates it)
> - CrowdStrike Falcon API credentials (Client ID + Secret)
>   - Required scopes to pull the sensor image:
>     - **Falcon Images Download** (Read)
>     - **Sensor Download** (Read)
> - CrowdStrike CID (with checksum)

## Reference Docs

| Source | Link |
| ------ | ---- |
| Deploy Falcon Container Sensor for Linux on ECS Fargate | https://docs.crowdstrike.com/r/en-US/iopiipqy/ba83eb6c |
| terraform-aws-ecs-fargate module | https://github.com/CrowdStrike/terraform-aws-ecs-fargate |
| falcon-container-sensor-pull script | https://github.com/CrowdStrike/falcon-scripts/tree/main/bash/containers/falcon-container-sensor-pull |
| ECS task definitions | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html |

---

## Core Concepts

On Fargate there is no host to install an agent on, so the sensor travels inside the task. The module builds an ECS **task definition** (the blueprint ECS runs) with two containers:

- **Init container** (`crowdstrike-falcon-init-container`) — runs first, copies the sensor files into a volume shared with your app, then exits.
- **Application container** — your app, started through the Falcon entrypoint so the sensor launches before it. The module adds the `SYS_PTRACE` capability the sensor needs.

The module also creates the task **execution role** (the IAM role ECS uses to pull images from ECR and write logs, not something your app code uses) and a CloudWatch log group. It does not create a cluster or service, so this guide adds those.

You copy the sensor image into your own ECR because Fargate pulls images with the execution role. Same-account ECR needs no pull secret.

```
ECS FARGATE TERRAFORM MODULE — ARCHITECTURE
CrowdStrike Registry | Your ECR | Terraform Module
ECS Fargate Task — crowdstrike-falcon-init-container | Shared volume | Application container
Execution role pulls the image from ECR
CrowdStrike Cloud — Telemetry
```

---

## Deployment Steps

<div data-mode="guide">

### 1. Set credentials

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,AWS_ACCOUNT_ID:AWS account ID,AWS_REGION:AWS region"></div>

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

Copy the `falcon-container` image from CrowdStrike's registry into your ECR:

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-container --copy <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

> **Heads-up:** On GovCloud, add `--region us-gov-1` (or `us-gov-2`) to the command above. Auto-discovery of your Falcon cloud only works for us-1, us-2, us-3, and eu-1, and without the flag the script tries us-1 and authentication fails. The module itself switches to GovCloud ARNs automatically.

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

### 4. Clone the CrowdStrike module repo

The repo contains the module plus runnable examples. Clone it and move into the `basic` example, which builds a task definition for a sample nginx app:

```bash
git clone -c advice.detachedHead=false --branch v0.0.3 https://github.com/CrowdStrike/terraform-aws-ecs-fargate.git
cd terraform-aws-ecs-fargate/examples/basic
```

> **Why this matters:** The example already sets `app_entrypoint` for nginx. The module only wraps your app with the Falcon entrypoint when this is set, so for your own images always set it to your container's entrypoint. Without it the app runs normally but the sensor never starts.

### 5. Add an ECS cluster and service

The module only creates the task definition. Add a cluster and a service to run it, in the default VPC. The service uses the VPC's default security group, which allows no inbound traffic, and a public IP so the task can reach ECR and the Falcon cloud over the internet:

```bash
cat > lab.tf <<'EOF'
variable "aws_region" {
  type = string
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      "cstag-accounting" = "dev"
      "cstag-department" = "Sales - 310000"
      "cstag-business"   = "Sales"
      "cstag-owner"      = "ali.zia"
      "cstag-user"       = "minh.pham"
      "cstag-purpose"    = "SE Labs ECS Fargate Falcon TF"
    }
  }
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_security_group" "default" {
  vpc_id = data.aws_vpc.default.id
  name   = "default"
}

resource "aws_ecs_cluster" "demo" {
  name = "falcon-demo-cluster"
}

resource "aws_ecs_service" "demo" {
  name            = "falcon-demo-service"
  cluster         = aws_ecs_cluster.demo.id
  task_definition = module.falcon_ecs_task.task_definition_arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [data.aws_security_group.default.id]
    assign_public_ip = true
  }
}
EOF
```

> **Why this matters:** An ECS **cluster** is just a logical grouping, and a **service** keeps the desired number of tasks running (it restarts them if they stop). Fargate means AWS supplies the compute, so there are no instances to manage.

### 6. Write your values

Point the module at your sensor image and CID. The sample app is nginx from Amazon's public registry, which Fargate can pull without credentials:

```bash
cat > terraform.tfvars <<EOF
aws_region   = "<AWS_REGION>"
app_image    = "public.ecr.aws/nginx/nginx:stable"
falcon_image = "<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-container:$FALCON_IMAGE_TAG"
falcon_cid   = "<FALCON_CID>"
app_port     = 80
EOF
```

> **Note:** `terraform.tfvars` and the state file contain your CID in plain text. The repo's `.gitignore` already excludes both, so keep it that way.

### 7. Deploy

Download the AWS provider and the module:

```bash
terraform init
```

Create the task definition, execution role, log group, cluster, and service. Review the plan, then type `yes`:

```bash
terraform apply
```

> **Verify:** The apply ends with `Apply complete! Resources: 6 added` (task definition, execution role and its policy attachment, log group, cluster, service). If it fails with `AccessDenied`, your AWS identity lacks ECS or IAM permissions.

### 8. Verify

Wait for the service to start its task. Fargate takes about a minute to provision and pull images, and this command returns when the service is stable:

```bash
aws ecs wait services-stable --cluster falcon-demo-cluster --services falcon-demo-service --region <AWS_REGION>
```

Capture the task ID and list its containers:

```bash
export TASK_ID=$(aws ecs list-tasks --cluster falcon-demo-cluster --service-name falcon-demo-service --region <AWS_REGION> --query 'taskArns[0]' --output text | awk -F/ '{print $NF}')
aws ecs describe-tasks --cluster falcon-demo-cluster --tasks $TASK_ID --region <AWS_REGION> --query 'tasks[0].containers[].{Name:name,Status:lastStatus,Exit:exitCode}' --output table
```

> **Verify:** `crowdstrike-falcon-init-container` should be `STOPPED` with `Exit` `0` (it copies the sensor files and exits), and `falcon-demo-app` should be `RUNNING`. If the task never appears, run `aws ecs describe-services --cluster falcon-demo-cluster --services falcon-demo-service --query 'services[0].events[:3]'`; `CannotPullContainerError` means the image URI or tag in `terraform.tfvars` is wrong.

Confirm the sensor registered in the Falcon console: go to **Host setup and management** > **Host management**, add a **Pod ID** filter set to your `$TASK_ID` (print it with `echo $TASK_ID`), and open the row.

> **Look for:** A host entry appears within a few minutes, and its **Host ID** is populated (this is the sensor's AID). No entry after five minutes usually means the task cannot reach the Falcon cloud, so check that it got a public IP or a NAT route.

### 9. Clean up (optional)

Removes everything Terraform created. Run it from `terraform-aws-ecs-fargate/examples/basic`; type `yes` when prompted:

```bash
terraform destroy
```

Delete the ECR repository and the sensor image in it:

```bash
aws ecr delete-repository --repository-name falcon-container --force --region <AWS_REGION>
```

> **Note:** The host entry stays in the Falcon console for a while after the task is gone.

</div>

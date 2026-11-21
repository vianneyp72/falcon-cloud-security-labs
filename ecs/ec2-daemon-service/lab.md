# Falcon Sensor on Self-Managed ECS EC2 via Daemon Service

Deploy the Falcon sensor as an ECS **daemon service** on a cluster whose EC2 instances you launch and manage yourself, using CrowdStrike's official CloudFormation stack. One sensor task runs on every container instance, and the sensor image is hosted in your own ECR.

> **Prerequisites:**
>
> - AWS account with the `aws` CLI <span data-tip="aws sts get-caller-identity should print your account.">configured</span>
> - `git` installed <span data-tip="Used to clone the CrowdStrike CloudFormation repo. You can also download the template file from GitHub in a browser.">to get the template</span>
> - <span data-tip="Used to copy the sensor image to ECR. It must be running: docker info should print server details, not an error. Start Docker Desktop if it fails.">Docker, Podman, or Skopeo</span> installed **and running**
> - Permission to <span data-tip="CloudFormation stack create and delete, ECS service and task definition changes, and ECR repository create and push. If you enable logging, the deploying identity also needs logs:CreateLogGroup and iam:PassRole.">deploy stacks and push to ECR</span>
> - CrowdStrike Falcon API <span data-tip="Needed to pull the sensor image from the CrowdStrike registry.">credentials</span> (Client ID + Secret)
>   - Scopes to pull the sensor image:
>     - **Falcon Images Download** (Read)
>     - **Sensor Download** (Read)
> - CrowdStrike <span data-tip="Use the full Customer ID including the checksum suffix. The credentials tip below shows where to find it.">CID</span> (with checksum)
> - **Quick Deploy:** existing ECS cluster <span data-tip="Linux container instances registered to the cluster, with outbound TLS 443 to the Falcon cloud and to ECR. Run aws ecs describe-clusters and check registeredContainerInstancesCount is above 0.">backed by EC2</span>
> - **Full Lab:** nothing else; the lab builds a <span data-tip="Two small EC2 instances in your default VPC. Section 8 deletes them.">test cluster</span>

> **Tip:** Where to find your Falcon credentials:
>
> - **CID (with checksum):** in the Falcon console, go to **Host setup and management** > **Deploy** > **Sensor downloads** and copy the **Customer ID** from the right panel. Direct link: [US-1](https://falcon.crowdstrike.com/sensor-downloads/all) | [US-2](https://falcon.us-2.crowdstrike.com/sensor-downloads/all) | [EU-1](https://falcon.eu-1.crowdstrike.com/sensor-downloads/all). On GovCloud, open the same page on your GovCloud console host.
> - **API client:** go to **Support and resources** > **Client Management** > **API Clients** > **Create API client**. Copy the client secret right away; the console shows it only once.

> **Note:** **Which lab is this?** This one is for **self-managed EC2**: you create the instances (usually an Auto Scaling group) and patch them, and the sensor runs as an ECS *daemon service*, a regular ECS service that places one task on each instance. If AWS launches and patches the instances for you (**ECS Managed Instances**), use [Managed Instances (Managed Daemon)](../managed-instances-daemon/) instead. It deploys a different CloudFormation template that creates an ECS *managed daemon*.

> **Note:** **Which registry?** The CloudFormation template only pulls the sensor from **Amazon ECR**, either a new repository or one you already have. For Artifactory, Harbor, Docker Hub, ACR, or GAR, mirror the sensor into ECR first; the template has no registry-credential parameter.

## Reference Docs

| Source | Link |
| ------ | ---- |
| CrowdStrike CloudFormation stack for ECS (template and README) | https://github.com/CrowdStrike/aws-cloudformation-falcon-sensor-ecs |
| falcon-container-sensor-pull script | https://github.com/CrowdStrike/falcon-scripts/tree/main/bash/containers/falcon-container-sensor-pull |
| ECS service scheduler strategies (DAEMON) | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html |
| aws cloudformation deploy | https://docs.aws.amazon.com/cli/latest/reference/cloudformation/deploy/ |

---

## Core Concepts

An EC2-backed ECS cluster runs your containers on EC2 instances you can reach, so the sensor protects the **host** and every task on it. In ECS, a **task definition** is the blueprint for a set of containers, and a **service** keeps tasks running from it. A service with the **DAEMON** scheduling strategy places exactly one task on every container instance, including instances added later by Auto Scaling.

A **CloudFormation stack** is a group of AWS resources created from one template file. CrowdStrike's template creates two things for you: the task definition and the daemon service (plus an optional log group).

- **Init container** (`init-falconstore`) — runs first, installs the sensor files onto the host under `/opt/CrowdStrike`, then exits.
- **Sensor container** (`crowdstrike-falcon-node-sensor`) — starts after the init container finishes. It runs privileged with the host's network, PID, and IPC namespaces, which is how one container sees every process on the instance.

> **Why this matters:** Host networking and a privileged container are normal for a node sensor, but they mean this task is not like your app tasks. It also needs room to be scheduled: by default each instance must have 256 CPU units and 512 MiB of memory free, or the daemon task is not placed on it.

The template pulls the sensor from your own ECR, so you copy the `falcon-sensor` image there first. The template creates no IAM roles, so the stack deploys without any capability acknowledgement.

```
ECS EC2 DAEMON SERVICE — CLOUDFORMATION
CloudFormation Stack | Daemon service crowdstrike-falcon-node-daemon
Your ECR | falcon-sensor image
ECS cluster — EC2 instances 1, 2, 3 | one sensor task per instance
crowdstrike-falcon-node-sensor | host network / PID / IPC
CrowdStrike Cloud — Telemetry
```

---

## Deployment Steps

<div data-mode="guide">

### 1. Set credentials

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,AWS_ACCOUNT_ID:AWS account ID,AWS_REGION:AWS region,CLUSTER_NAME:ECS cluster name"></div>

Then copy this to export the API client secret. It is the only value kept as a shell variable, and the page never saves it:

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

> **Warning:** Use the same region as your cluster for `AWS_REGION`. A stack created in a different region cannot find the cluster.

### 2. Copy the Falcon sensor image to ECR

The stack pulls the sensor from ECR in your account. Pick whether to create a repository for it or use one you already have, and the Falcon cloud your CID belongs to:

<div data-choice-picker="ecrrepo"></div>

<div data-choice-picker="falconcloud"></div>

<div data-choice="ecrrepo:new">

Create an ECR repository for the sensor (reuses it if it already exists). The repo name must be `falcon-sensor` because `--copy` does not rename images:

```bash
if aws ecr describe-repositories --repository-names falcon-sensor --region <AWS_REGION> >/dev/null 2>&1; then
  echo "✅ falcon-sensor already exists"
else
  aws ecr create-repository --repository-name falcon-sensor --region <AWS_REGION> --query repository.repositoryUri --output text \
    && echo "🆕 Created falcon-sensor"
fi
```

> **Verify:** `✅ ... already exists` means the repo was reused. `🆕 Created ...` follows the new repo's address (`<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-sensor`).

</div>

<div data-choice="ecrrepo:existing">

Enter the name of your existing ECR repository. It must already exist in this account and region:

<div data-fill-fields="ECR_REPOSITORY:ECR repository"></div>

> **Note:** The sensor is stored in that repository tagged `falcon-sensor-<version>`, so it can sit next to your other images. The repository must be in the same account as the cluster; for another account, add a repository policy that lets the instance role pull from it.

</div>

Log Docker in to your ECR registry (the pull script does not log in to the destination):

```bash
aws ecr get-login-password --region <AWS_REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

<div data-choice="ecrrepo:existing">

Look up the current sensor version. `--copy-custom-tag` needs it to name the tag in your repository:

```bash
export SENSOR_VERSION=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-sensor \
  --region us-gov-1 \ #@choice=falconcloud:govcloud-1
  --region us-gov-2 \ #@choice=falconcloud:govcloud-2
  --get-image-path | cut -d: -f2)
echo "SENSOR_VERSION: $SENSOR_VERSION"
```

</div>

Copy the `falcon-sensor` image (the node sensor, not `falcon-container`) from CrowdStrike's registry into your ECR:

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-sensor \
  --region us-gov-1 \ #@choice=falconcloud:govcloud-1
  --region us-gov-2 \ #@choice=falconcloud:govcloud-2
  --copy <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com #@choice=ecrrepo:new
  --copy <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/<ECR_REPOSITORY> --copy-omit-image-name --copy-custom-tag "falcon-sensor-$SENSOR_VERSION" #@choice=ecrrepo:existing
```

### 3. Build the image path

`--copy` keeps the image tag, so build the full path the stack will pull:

```bash
export FALCON_IMAGE_TAG=$(aws ecr describe-images --repository-name falcon-sensor --region <AWS_REGION> --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text) #@choice=ecrrepo:new
export FALCON_IMAGE_PATH="<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-sensor:$FALCON_IMAGE_TAG" #@choice=ecrrepo:new
export FALCON_IMAGE_TAG="falcon-sensor-$SENSOR_VERSION" #@choice=ecrrepo:existing
export FALCON_IMAGE_PATH="<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/<ECR_REPOSITORY>:$FALCON_IMAGE_TAG" #@choice=ecrrepo:existing
```

Validate the client secret and image path were populated (a ✅ means set, a ❌ means missing):

```bash
echo "Client Secret : $([ -n "$FALCON_CLIENT_SECRET" ] && echo ✅ || echo ❌)"
echo "Image path    : $([ -n "$FALCON_IMAGE_TAG" ] && [ "$FALCON_IMAGE_TAG" != None ] && echo ✅ || echo ❌) ($FALCON_IMAGE_PATH)"
```

> **Verify:** The tag looks like `7.39.0-19204-1` (`falcon-sensor-7.39.0-19204-1` in an existing repository). `None` means the copy in step 2 did not finish; re-run it and read the error.

### 4. Get the CloudFormation template

Clone CrowdStrike's repo at a released version and move into the EC2 folder (sensor 7.40 and later needs template v0.2.0 or later):

```bash
git clone --branch v0.3.0 --depth 1 https://github.com/CrowdStrike/aws-cloudformation-falcon-sensor-ecs.git
cd aws-cloudformation-falcon-sensor-ecs/falcon-sensor-ecs-ec2
```

### 5. Deploy the stack

Edit the highlighted `SENSOR_TAGS` field (the page replaces it when you click Copy) to group these hosts in the Falcon console. Use comma-separated values; letters, numbers, `-`, `_`, `/` only. The two GovCloud lines appear only when you pick GovCloud in step 2:

```bash
aws cloudformation deploy \
  --region <AWS_REGION> \
  --stack-name falcon-ecs-ec2-daemon-<CLUSTER_NAME> \
  --template-file falcon-ecs-ec2-daemon.yaml \
  --parameter-overrides \
    "ECSClusterName=<CLUSTER_NAME>" \
    "FalconCID=<FALCON_CID>" \
    "FalconImagePath=$FALCON_IMAGE_PATH" \
    "Cloud=us-gov-1" \ #@choice=falconcloud:govcloud-1
    "Cloud=us-gov-2" \ #@choice=falconcloud:govcloud-2
    "Tags=<SENSOR_TAGS:ecs-ec2-daemon>"
```

> **Look for:** The command waits, then prints `Successfully created/updated stack - falcon-ecs-ec2-daemon-<CLUSTER_NAME>`. If it ends with `Failed to create/update the stack`, run `aws cloudformation describe-stack-events --stack-name falcon-ecs-ec2-daemon-<CLUSTER_NAME> --region <AWS_REGION>` and read the first `FAILED` reason.

> **Note:** Proxy, logging, resource limits, and other options are extra `--parameter-overrides` entries. Full Lab section 4 lists them and Challenges 1 and 2 use two.

### 6. Verify deployment

Confirm the stack finished:

```bash
aws cloudformation describe-stacks --stack-name falcon-ecs-ec2-daemon-<CLUSTER_NAME> --region <AWS_REGION> --query "Stacks[0].StackStatus" --output text
```

> **Verify:** `CREATE_COMPLETE` (or `UPDATE_COMPLETE` on a redeploy).

Check the daemon service has one running task:

```bash
aws ecs describe-services --cluster <CLUSTER_NAME> --services crowdstrike-falcon-node-daemon --region <AWS_REGION> --query "services[0].[status,desiredCount,runningCount]" --output text
```

Count the instances in the cluster to compare against:

```bash
aws ecs describe-clusters --clusters <CLUSTER_NAME> --region <AWS_REGION> --query "clusters[0].registeredContainerInstancesCount" --output text
```

> **Verify:** The service prints `ACTIVE`, then `desiredCount` and `runningCount` that match the instance count. If `runningCount` is lower, an instance has no free CPU or memory for the sensor task, or cannot pull from ECR.

Finally, in the Falcon console go to **Host setup and management** > **Host management** > **Manage endpoints** and look for your instances. Filter by **Grouping Tags** with your `SENSOR_TAGS` value. Hosts appear within a few minutes.

### 7. Test a detection (optional)

On any container instance (EC2 console > **Connect** > **Session Manager**, or SSH), run one script from CrowdStrike's detection container:

```bash
sudo docker run --rm quay.io/crowdstrike/detection-container "bash /home/eval/bin/Defense_Evasion_via_Rootkit.sh"
```

> **Look for:** In the Falcon console, **Next-Gen SIEM** > **Monitor and investigate** > **Detections**, a **Critical** detection with tactic **Defense Evasion via Rootkit** on that host, including container and image details.

### 8. Clean up (optional)

Removing the sensor takes two stacks. First delete the install stack:

```bash
aws cloudformation delete-stack --stack-name falcon-ecs-ec2-daemon-<CLUSTER_NAME> --region <AWS_REGION>
```

Then run the sensor's uninstall as a temporary daemon service from the cleanup template (still in `falcon-sensor-ecs-ec2`):

```bash
aws cloudformation deploy \
  --region <AWS_REGION> \
  --stack-name falcon-ecs-ec2-daemon-cleanup-<CLUSTER_NAME> \
  --template-file falcon-ecs-ec2-daemon-cleanup.yaml \
  --parameter-overrides \
    "ECSClusterName=<CLUSTER_NAME>" \
    "FalconImagePath=$FALCON_IMAGE_PATH"
```

Once it completes, delete the cleanup stack:

```bash
aws cloudformation delete-stack --stack-name falcon-ecs-ec2-daemon-cleanup-<CLUSTER_NAME> --region <AWS_REGION>
```

> **Why this matters:** Deleting the install stack only stops the sensor task. The init container already wrote files to `/opt/CrowdStrike` on every host, so the cleanup service runs the sensor's uninstall on each instance to remove them. Skip it and the host files stay behind.

> **Note:** Host entries stay in the Falcon console for a while after the sensors are gone. The copied image stays in ECR (delete the `falcon-sensor` repo, or only the `falcon-sensor-<version>` tag if you used your own repository).

</div>

<div data-mode="lab">

## 1. Provision a Test Cluster

> **What & Why:** The lab needs an ECS cluster backed by EC2 instances you control, with two instances so you can watch the daemon service place one sensor on each. The default VPC and subnets that every AWS account starts with are enough.

### Step 1: Install and authenticate the AWS CLI

> **What & Why:** Fresh machines often hit "command not found" or "Unable to locate credentials" on the first AWS command. Install and log in first.

<div data-lab-variables></div>

- [ ] [Install the `aws` CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), then log in:

```bash
aws configure   # or: aws sso login
```

- [ ] Confirm you are the expected principal and note the 12-digit `Account` value:

```bash
aws sts get-caller-identity
```

> **Verify:** The output shows your account ID and a user or role ARN. `Unable to locate credentials` means login did not complete.

### Step 2: Create the cluster and two instances

> **What & Why:** An ECS **cluster** is a logical grouping. With EC2 capacity, instances join it when the ECS agent on them is told the cluster name. The **container instance role** is the IAM role those instances use to talk to ECS and pull images. You also attach Session Manager access so you can open a shell later without SSH keys.

- [ ] **Console:** Navigate to **Elastic Container Service** → **Clusters** → **Create cluster**
  - Cluster name: `{{CLUSTER_NAME}}`
  - Infrastructure: clear **AWS Fargate (serverless)**, select **Amazon EC2 instances**
  - Provisioning model: **On-demand**
  - Operating system/Architecture: **Amazon Linux 2023**
  - EC2 instance type: `t3.medium`
  - Desired capacity: minimum `2`, maximum `2`
  - Container instance IAM role: **Create new role**
  - Network: leave the default VPC and subnets, and turn **Auto-assign public IP** on
  - Click **Create** (the page shows the cluster as it provisions; wait until it finishes)
- [ ] **Console:** Navigate to **IAM** → **Roles** → open `ecsInstanceRole` (the role the wizard created) → **Add permissions** → **Attach policies** → select `AmazonSSMManagedInstanceCore` → **Add permissions**

> **Note:** If the wizard shows a different role name, attach `AmazonSSMManagedInstanceCore` to that role instead.

<details>
<summary>CLI equivalent</summary>

Create the instance role with ECS and Session Manager access, and wrap it in an instance profile:

```bash
aws iam create-role --role-name falcon-lab-ecs-instance-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name falcon-lab-ecs-instance-role --policy-arn arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role
aws iam attach-role-policy --role-name falcon-lab-ecs-instance-role --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam create-instance-profile --instance-profile-name falcon-lab-ecs-instance-profile
aws iam add-role-to-instance-profile --instance-profile-name falcon-lab-ecs-instance-profile --role-name falcon-lab-ecs-instance-role
```

Create the cluster:

```bash
aws ecs create-cluster --cluster-name {{CLUSTER_NAME}} --region {{REGION}}
```

Launch two ECS-optimized instances that register to it. The `sleep` gives the new instance profile time to propagate:

```bash
sleep 15
aws ec2 run-instances --region {{REGION}} --count 2 --instance-type t3.medium \
  --image-id resolve:ssm:/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id \
  --iam-instance-profile Name=falcon-lab-ecs-instance-profile \
  --user-data "#!/bin/bash
echo ECS_CLUSTER={{CLUSTER_NAME}} >> /etc/ecs/ecs.config" \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=falcon-lab-ecs-instance}]' \
  --query 'Instances[].InstanceId' --output text
```

</details>

> **Tip:** The ECS-optimized AMI ships with Docker and the ECS agent preinstalled. The only thing that makes an instance join your cluster is the `ECS_CLUSTER` line in `/etc/ecs/ecs.config`; the console wizard writes it for you through an Auto Scaling group.

### Step 3: Confirm both instances registered

- [ ] **Console:** Open your cluster → **Infrastructure** tab → **Container instances**, and wait for two rows

<details>
<summary>CLI equivalent</summary>

```bash
aws ecs describe-clusters --clusters {{CLUSTER_NAME}} --region {{REGION}} --query "clusters[0].registeredContainerInstancesCount" --output text
```

</details>

> **Verify:** The count is `2`. If it is `0` after a few minutes, the instances cannot reach ECS: check the instance has a public IP and the cluster name in `/etc/ecs/ecs.config` is exactly `{{CLUSTER_NAME}}`.

---

## 2. Configure API Credentials

> **What & Why:** The sensor image lives in CrowdStrike's registry. An API client lets the pull script fetch it for your CID's cloud region and copy it into your ECR.

### Step 1: Create an API client

- [ ] Navigate to **Falcon Console** > **Support and resources** > **Client Management** > **API Clients** > **Create API client**
- [ ] Set the following OAuth 2.0 scopes:
  - **Falcon Images Download**: **Read**
  - **Sensor Download**: **Read**

<details>
<summary>CLI equivalent</summary>

There is no CLI for creating API clients; this must be done in the console.

</details>

### Step 2: Enter your values

- [ ] Enter your values (find the account ID in the `aws sts get-caller-identity` output from section 1):

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,AWS_ACCOUNT_ID:AWS account ID"></div>

- [ ] Export the API client secret (the only value kept as a shell variable):

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

---

## 3. Copy the Sensor Image to ECR

> **What & Why:** The CloudFormation template pulls the sensor from an ECR repo in your account. You prepare a repo (new or one you already have), then copy the image from CrowdStrike's registry into it.

> **Tip:** Use the **node sensor** (`falcon-sensor`) here, not `falcon-container`. The container sensor is for Fargate; the node sensor is the one that installs on a host.

- [ ] Pick the ECR repository option and the Falcon cloud your CID belongs to. The steps below update to match:

<div data-choice-picker="ecrrepo"></div>

<div data-choice-picker="falconcloud"></div>

### Step 1: Prepare the ECR repository

<div data-choice="ecrrepo:new">

- [ ] **Console:** Navigate to **Elastic Container Registry** → **Private registry** → **Repositories** → **Create repository**
  - Repository name: `falcon-sensor` (it must match exactly because the copy keeps the image name)
  - Click **Create**

<details>
<summary>CLI equivalent</summary>

```bash
if aws ecr describe-repositories --repository-names falcon-sensor --region {{REGION}} >/dev/null 2>&1; then
  echo "✅ falcon-sensor already exists"
else
  aws ecr create-repository --repository-name falcon-sensor --region {{REGION}} --query repository.repositoryUri --output text \
    && echo "🆕 Created falcon-sensor"
fi
```

</details>

> **Verify:** The repo list shows `falcon-sensor` with the URI `<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-sensor`.

</div>

<div data-choice="ecrrepo:existing">

> **What & Why:** An existing repository keeps the sensor next to your other images. Because every image shares one repo, the tag carries the image name: `falcon-sensor-<version>`.

- [ ] **Console:** Navigate to **Elastic Container Registry** → **Private registry** → **Repositories** and confirm your repository is listed in region `{{REGION}}`
- [ ] Enter its name:

<div data-fill-fields="ECR_REPOSITORY:ECR repository"></div>

> **Warning:** The repository must be in the same account and region as the cluster. For another account, add a repository policy that lets the instance role pull from it, or the sensor task fails with an image pull error.

</div>

### Step 2: Log Docker in to ECR

> **What & Why:** The pull script pushes with your local Docker, which has to authenticate to ECR first. The script does not do this for you.

- [ ] Log in:

```bash
aws ecr get-login-password --region {{REGION}} | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com
```

> **Verify:** `Login Succeeded`.

### Step 3: Copy the image

<div data-choice="ecrrepo:existing">

> **What & Why:** `--copy-omit-image-name` puts the image directly in your repository, and `--copy-custom-tag` names the tag. You need the sensor version first so the tag matches what the script copies.

- [ ] Look up the current sensor version:

```bash
export SENSOR_VERSION=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-sensor \
  --region us-gov-1 \ #@choice=falconcloud:govcloud-1
  --region us-gov-2 \ #@choice=falconcloud:govcloud-2
  --get-image-path | cut -d: -f2)
echo "SENSOR_VERSION: $SENSOR_VERSION"
```

</div>

- [ ] Copy the image:

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-sensor \
  --region us-gov-1 \ #@choice=falconcloud:govcloud-1
  --region us-gov-2 \ #@choice=falconcloud:govcloud-2
  --copy <AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com #@choice=ecrrepo:new
  --copy <AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/<ECR_REPOSITORY> --copy-omit-image-name --copy-custom-tag "falcon-sensor-$SENSOR_VERSION" #@choice=ecrrepo:existing
```

> **Note:** Add `-p x86_64` or `-p aarch64` to copy only one CPU architecture. Without it the script copies every architecture CrowdStrike publishes, so the same image works on Intel and Graviton instances.

### Step 4: Read the tag and build the image path

<div data-choice="ecrrepo:new">

- [ ] **Console:** Open **Elastic Container Registry** → **Repositories** → `falcon-sensor`; the **Image tags** column shows the tag (for example `7.39.0-19204-1`)

</div>

<div data-choice="ecrrepo:existing">

- [ ] **Console:** Open **Elastic Container Registry** → **Repositories** → your repository; the **Image tags** column shows `falcon-sensor-<version>`

</div>

- [ ] Save the tag and full path (the path is what the stack's `FalconImagePath` parameter takes):

```bash
export FALCON_IMAGE_TAG=$(aws ecr describe-images --repository-name falcon-sensor --region {{REGION}} --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text) #@choice=ecrrepo:new
export FALCON_IMAGE_PATH="<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-sensor:$FALCON_IMAGE_TAG" #@choice=ecrrepo:new
export FALCON_IMAGE_TAG="falcon-sensor-$SENSOR_VERSION" #@choice=ecrrepo:existing
export FALCON_IMAGE_PATH="<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/<ECR_REPOSITORY>:$FALCON_IMAGE_TAG" #@choice=ecrrepo:existing
```

### Step 5: Validate the saved variables

- [ ] Confirm every variable is set (a ✅ means set, a ❌ means missing):

```bash
echo "Client Secret : $([ -n "$FALCON_CLIENT_SECRET" ] && echo ✅ || echo ❌)"
echo "Image path    : $([ -n "$FALCON_IMAGE_TAG" ] && [ "$FALCON_IMAGE_TAG" != None ] && echo ✅ || echo ❌) ($FALCON_IMAGE_PATH)"
```

> **Verify:** `None` as the tag means the copy did not finish. Re-run step 3 and read the error.

---

## 4. Deploy the CloudFormation Stack

> **What & Why:** The stack creates the task definition and the daemon service. CloudFormation tracks everything it made, so one `delete-stack` later removes it all.

### Step 1: Get the template

- [ ] Clone CrowdStrike's repo at a released version (sensor 7.40 and later needs template v0.2.0 or later):

```bash
git clone --branch v0.3.0 --depth 1 https://github.com/CrowdStrike/aws-cloudformation-falcon-sensor-ecs.git
cd aws-cloudformation-falcon-sensor-ecs/falcon-sensor-ecs-ec2
```

> **Verify:** `ls` shows `falcon-ecs-ec2-daemon.yaml` and `falcon-ecs-ec2-daemon-cleanup.yaml`.

### Step 2: Create the stack

> **Why this matters:** Parameters are the template's inputs. Only three are required (cluster, CID, image path). The rest, such as `Tags`, `Cloud` (required for GovCloud), proxy settings, logging, and resource limits, have safe defaults.

- [ ] **Console:** Set the region selector (top right) to `{{REGION}}`, then navigate to **CloudFormation** → **Stacks** → **Create stack** → **With new resources (standard)**
  - Prepare template: **Choose an existing template**, Specify template: **Upload a template file** → **Choose file** → `falcon-ecs-ec2-daemon.yaml` → **Next**
  - Stack name: `falcon-ecs-ec2-daemon-{{CLUSTER_NAME}}`
  - ECSClusterName: `{{CLUSTER_NAME}}`
  - FalconCID: your CID with checksum
  - FalconImagePath: the full image path (run `echo $FALCON_IMAGE_PATH` and paste)
  - Tags: `ecs-ec2-daemon` (groups the hosts in the Falcon console)
  - Cloud (GovCloud only): `us-gov-1` or `us-gov-2`
  - Click **Next** twice, then **Submit**

<details>
<summary>CLI equivalent</summary>

```bash
aws cloudformation deploy \
  --region {{REGION}} \
  --stack-name falcon-ecs-ec2-daemon-{{CLUSTER_NAME}} \
  --template-file falcon-ecs-ec2-daemon.yaml \
  --parameter-overrides \
    "ECSClusterName={{CLUSTER_NAME}}" \
    "FalconCID=<FALCON_CID>" \
    "FalconImagePath=$FALCON_IMAGE_PATH" \
    "Cloud=us-gov-1" \ #@choice=falconcloud:govcloud-1
    "Cloud=us-gov-2" \ #@choice=falconcloud:govcloud-2
    "Tags=ecs-ec2-daemon"
```

</details>

> **Note:** The template creates no IAM resources, so CloudFormation does not ask you to acknowledge capabilities.

### Step 3: Wait for the stack

- [ ] **Console:** Open the stack → **Events** tab and watch the resources go to `CREATE_COMPLETE`. The last one is the service, which waits until its tasks are running.

> **Look for:** The stack's **Status** at the top reads `CREATE_COMPLETE`. If it shows `ROLLBACK_COMPLETE`, open **Events**, scroll to the first `CREATE_FAILED` row, and read **Status reason**. The stack must be deleted before you retry.

---

## 5. Verify Deployment

> **What & Why:** Confirm the daemon service placed one task per instance, then confirm the sensors registered with CrowdStrike.

### Step 1: Confirm one sensor task per instance

- [ ] **Console:** Navigate to **Elastic Container Service** → **Clusters** → `{{CLUSTER_NAME}}` → **Services** → `crowdstrike-falcon-node-daemon`
  - **Service type** reads **Daemon**
  - On the **Tasks** tab, filter **Running**

<details>
<summary>CLI equivalent</summary>

```bash
aws ecs describe-services --cluster {{CLUSTER_NAME}} --services crowdstrike-falcon-node-daemon --region {{REGION}} --query "services[0].[status,desiredCount,runningCount]" --output text
```

</details>

> **Verify:** `ACTIVE 2 2`: status active, two desired, two running. Each task has one row, and the **Container instance** column shows a different instance for each. A daemon service has no "desired count" you set; ECS derives it from the instance count.

### Step 2: Verify in Falcon console

- [ ] Navigate to **Falcon Console** > **Host setup and management** > **Host management** > **Manage endpoints**
- [ ] Filter by **Grouping Tags** with `ecs-ec2-daemon`
- [ ] Both instances should appear within a few minutes

### Step 3: Troubleshooting

| Symptom | Likely cause | Check |
|---------|--------------|-------|
| `runningCount` lower than instances | Instance has less than 256 CPU / 512 MiB free, so ECS cannot place the task | Service **Events** tab shows `unable to place a task because no container instance met all of its requirements` |
| Task stops with `CannotPullContainerError` | Image path or tag wrong, or instance role cannot pull from ECR | Service **Events** and the stopped task's **Stopped reason**; confirm the tag exists in your `falcon-sensor` repo |
| Stack `ROLLBACK_COMPLETE` | Cluster name wrong, stack in a different region than the cluster, or earlier stack with the same name | Stack **Events** tab, first `CREATE_FAILED` row |
| Task running but no host in console | Instance cannot reach the Falcon cloud on TLS 443, or still registering | Security group and route table egress; wait a few minutes |

---

## 6. Test a Detection (Optional)

> **What & Why:** Hosts registering proves connectivity. A detection proves the sensor is actively watching the instance and the containers on it.

### Step 1: Open a shell on an instance

- [ ] **Console:** Navigate to **EC2** → **Instances** → select one instance → **Connect** → **Session Manager** tab → **Connect**

<details>
<summary>CLI equivalent</summary>

Needs the [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) installed locally:

```bash
aws ssm start-session --region {{REGION}} --target <INSTANCE_ID>
```

</details>

> **Heads-up:** If the **Connect** button for Session Manager is greyed out, the instance role is missing `AmazonSSMManagedInstanceCore` (section 1, step 2). It can take a couple of minutes after attaching for the instance to show up.

### Step 2: Trigger and confirm

- [ ] In the shell, run one of CrowdStrike's detection scripts in a container:

```bash
sudo docker run --rm quay.io/crowdstrike/detection-container "bash /home/eval/bin/Defense_Evasion_via_Rootkit.sh"
```

- [ ] In the Falcon console, go to **Next-Gen SIEM** > **Monitor and investigate** > **Detections** and find the host

> **Look for:** A **Critical** detection with tactic **Defense Evasion via Rootkit**, carrying container and image details because the sensor saw the activity from the host.

---

## 7. Cleanup the Sensor

> **Destructive:** This removes the Falcon sensor from every instance in the cluster. Run it only when you are finished, or when you want to see the uninstall path.

> **Why this matters:** Deleting the install stack only stops the sensor task. The init container already wrote files to `/opt/CrowdStrike` on each host, so a second, temporary daemon service runs the sensor's uninstall on every instance.

### Step 1: Delete the install stack

- [ ] **Console:** Navigate to **CloudFormation** → **Stacks** → `falcon-ecs-ec2-daemon-{{CLUSTER_NAME}}` → **Delete** → **Delete**

<details>
<summary>CLI equivalent</summary>

```bash
aws cloudformation delete-stack --stack-name falcon-ecs-ec2-daemon-{{CLUSTER_NAME}} --region {{REGION}}
```

</details>

### Step 2: Run the uninstall stack

- [ ] Back in `falcon-sensor-ecs-ec2`, create the cleanup stack (it creates the `crowdstrike-falcon-cleanup-daemon` service, which runs the uninstall and then sleeps for about 5 minutes):

```bash
aws cloudformation deploy \
  --region {{REGION}} \
  --stack-name falcon-ecs-ec2-daemon-cleanup-{{CLUSTER_NAME}} \
  --template-file falcon-ecs-ec2-daemon-cleanup.yaml \
  --parameter-overrides \
    "ECSClusterName={{CLUSTER_NAME}}" \
    "FalconImagePath=$FALCON_IMAGE_PATH"
```

> **Verify:** The command ends with `Successfully created/updated stack`. In the console, the service's tasks show one per instance.

### Step 3: Delete the uninstall stack

- [ ] **Console:** Navigate to **CloudFormation** → **Stacks** → `falcon-ecs-ec2-daemon-cleanup-{{CLUSTER_NAME}}` → **Delete** → **Delete**

<details>
<summary>CLI equivalent</summary>

```bash
aws cloudformation delete-stack --stack-name falcon-ecs-ec2-daemon-cleanup-{{CLUSTER_NAME}} --region {{REGION}}
```

</details>

> **Note:** Host entries stay in the Falcon console for a while after the sensors are gone.

---

## 8. Delete the Test Cluster

> **Costs money:** The two `t3.medium` instances bill by the hour until you delete them. Skip this section only if you want to keep the cluster for the Challenges.

### Step 1: Delete the cluster and instances

- [ ] **Console (console-created cluster):** Navigate to **Elastic Container Service** → **Clusters** → `{{CLUSTER_NAME}}` → **Delete cluster**. This also deletes the Auto Scaling group and terminates the instances.

<details>
<summary>CLI equivalent</summary>

Terminate the two instances you launched, then delete the cluster and the IAM objects:

```bash
aws ec2 terminate-instances --region {{REGION}} --instance-ids $(aws ec2 describe-instances --region {{REGION}} --filters "Name=tag:Name,Values=falcon-lab-ecs-instance" "Name=instance-state-name,Values=running,pending" --query "Reservations[].Instances[].InstanceId" --output text)
aws ecs delete-cluster --cluster {{CLUSTER_NAME}} --region {{REGION}}
aws iam remove-role-from-instance-profile --instance-profile-name falcon-lab-ecs-instance-profile --role-name falcon-lab-ecs-instance-role
aws iam delete-instance-profile --instance-profile-name falcon-lab-ecs-instance-profile
aws iam detach-role-policy --role-name falcon-lab-ecs-instance-role --policy-arn arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role
aws iam detach-role-policy --role-name falcon-lab-ecs-instance-role --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam delete-role --role-name falcon-lab-ecs-instance-role
```

If `delete-cluster` reports the cluster still has container instances, wait a minute for the terminated instances to deregister and re-run it.

</details>

### Step 2: Remove the sensor image

<div data-choice="ecrrepo:new">

- [ ] **Console:** Navigate to **Elastic Container Registry** → **Repositories** → select `falcon-sensor` → **Delete** → type `delete` to confirm

<details>
<summary>CLI equivalent</summary>

```bash
aws ecr delete-repository --repository-name falcon-sensor --region {{REGION}} --force
```

</details>

</div>

<div data-choice="ecrrepo:existing">

> **Do NOT:** Delete the repository. It is yours and may hold other images. Remove only the sensor image tag.

- [ ] **Console:** Navigate to **Elastic Container Registry** → **Repositories** → your repository → select the `falcon-sensor-<version>` image → **Delete**

<details>
<summary>CLI equivalent</summary>

```bash
aws ecr batch-delete-image --repository-name <ECR_REPOSITORY> --region {{REGION}} --image-ids imageTag=$FALCON_IMAGE_TAG
```

</details>

</div>

---

## 9. Challenges

### Challenge 1: Turn on sensor logging

**Scenario:** Your security team wants the sensor's startup and runtime output in CloudWatch Logs instead of a shell on the host.

<details>
<summary>Hint</summary>

The template has an `EnableLogging` parameter and creates the log group for you. Logging also needs an `ECSTaskRoleArn`. Create an IAM role that the `ecs-tasks.amazonaws.com` service can assume, attach the `AmazonECSTaskExecutionRolePolicy` managed policy, and pass its ARN.

</details>

<details>
<summary>Solution</summary>

Create the role:

```bash
aws iam create-role --role-name falcon-ecs-task-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  --query Role.Arn --output text
aws iam attach-role-policy --role-name falcon-ecs-task-role --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

Re-run the deploy from section 4 with two extra parameter overrides (`"EnableLogging=true"` and `"ECSTaskRoleArn=<role ARN printed above>"`). CloudFormation updates the stack in place. The new log group is `/aws/ecs/{{CLUSTER_NAME}}/crowdstrike/falcon-daemon-service`, with streams prefixed `falcon-node-init` and `falcon-node-sensor`.

</details>

### Challenge 2: Cap the sensor's resources

**Scenario:** A customer runs small instances and wants to guarantee the sensor never uses more than half a vCPU and 1 GiB of memory.

<details>
<summary>Hint</summary>

Look at the parameters starting with `EnableResourceLimits` and `SensorCpu` / `SensorMemory`. A limit must be at least as large as its reservation, and the memory limit must be greater than the memory reservation.

</details>

<details>
<summary>Solution</summary>

Redeploy with these extra overrides:

```
"EnableResourceLimits=true" "SensorCpuReservation=256" "SensorCpuLimit=512" "SensorMemoryReservation=512" "SensorMemoryLimit=1024"
```

CPU is in units of 1/1024 of a vCPU, so `512` is half a vCPU. Measure real sensor usage before setting limits in production; a limit set too low can starve the sensor.

</details>

### Challenge 3: Upgrade the sensor

**Scenario:** CrowdStrike released a newer sensor and you want the daemon service on it without deleting the stack.

<details>
<summary>Solution</summary>

List available tags, copy the version you want into ECR, then redeploy with the new path:

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-sensor --list-tags
```

Re-run the section 3 copy (add `--version <SENSOR_VERSION>` to pick one; with an existing repository also set `SENSOR_VERSION` to that version so the custom tag matches), re-run the tag and path exports from step 4, then the section 4 deploy. CloudFormation registers a new task definition revision and ECS replaces the sensor task on each instance. If a sensor update policy with **Uninstall and maintenance protection** is on, it blocks updates for sensors 7.33 and earlier.

</details>

---

## Quick Reference

| Action | Console Path | CLI Command |
|--------|-------------|-------------|
| Create ECR repo | **ECR** → **Repositories** → **Create repository** | `aws ecr create-repository --repository-name falcon-sensor` |
| Copy sensor image | n/a | `falcon-container-sensor-pull.sh --type falcon-sensor --copy <registry>` |
| Deploy stack | **CloudFormation** → **Create stack** → upload `falcon-ecs-ec2-daemon.yaml` | `aws cloudformation deploy --template-file falcon-ecs-ec2-daemon.yaml ...` |
| Check stack | **CloudFormation** → stack → **Events** | `aws cloudformation describe-stacks --stack-name <name>` |
| Check service | **ECS** → cluster → **Services** → `crowdstrike-falcon-node-daemon` | `aws ecs describe-services --cluster <cluster> --services crowdstrike-falcon-node-daemon` |
| Uninstall sensor | **CloudFormation** → delete stack, deploy cleanup stack, delete it | `aws cloudformation delete-stack` / `deploy` with `falcon-ecs-ec2-daemon-cleanup.yaml` |

</div>

# Falcon Sensor on ECS Managed Instances via Managed Daemon

Deploy the Falcon sensor as an ECS managed daemon on an ECS Managed Instances cluster using CrowdStrike's official CloudFormation stack. One sensor task runs on every instance AWS launches for the cluster, and the sensor image is hosted in your own ECR.

> **Prerequisites:**
>
> - AWS account with the `aws` CLI <span data-tip="aws sts get-caller-identity should print your account.">configured</span>
> - `git` installed <span data-tip="Used to clone the CrowdStrike CloudFormation repo. You can also download the template file from GitHub in a browser.">to get the template</span>
> - <span data-tip="Used to copy the sensor image to ECR. It must be running: docker info should print server details, not an error. Start Docker Desktop if it fails.">Docker, Podman, or Skopeo</span> installed **and running**
> - Permission to <span data-tip="CloudFormation stack create and delete, ECS daemon and daemon task definition changes (ecs:RegisterDaemonTaskDefinition, ecs:CreateDaemon, ecs:UpdateDaemon, ecs:DeleteDaemon), iam:PassRole for the execution role, and ECR repository create and push. If you enable logging, the deploying identity also needs logs:CreateLogGroup.">deploy stacks and push to ECR</span>
> - CrowdStrike Falcon API <span data-tip="Needed to pull the sensor image from the CrowdStrike registry.">credentials</span> (Client ID + Secret)
>   - Scopes to pull the sensor image:
>     - **Falcon Images Download** (Read)
>     - **Sensor Download** (Read)
> - CrowdStrike <span data-tip="Use the full Customer ID including the checksum suffix. The credentials tip below shows where to find it.">CID</span> (with checksum)
> - **Quick Deploy:** an ECS cluster on <span data-tip="Run aws ecs describe-capacity-providers --cluster YOUR_CLUSTER and look for a provider with a managedInstancesProvider block. Only instances under those providers get the sensor. Instances need outbound TLS 443 to the Falcon cloud and to ECR.">Managed Instances capacity</span>, plus an <span data-tip="An IAM role ECS uses to pull the sensor from ECR and write logs. It needs the AmazonECSTaskExecutionRolePolicy managed policy, and the usual name is ecsTaskExecutionRole. Full Lab section 1 creates one.">execution role</span>
> - **Full Lab:** nothing else; the lab builds a <span data-tip="One small AWS-managed instance in your default VPC, launched by a sample web service. Section 8 deletes everything.">test cluster</span>

> **Tip:** Where to find your Falcon credentials:
>
> - **CID (with checksum):** in the Falcon console, go to **Host setup and management** > **Deploy** > **Sensor downloads** and copy the **Customer ID** from the right panel. Direct link: [US-1](https://falcon.crowdstrike.com/sensor-downloads/all) | [US-2](https://falcon.us-2.crowdstrike.com/sensor-downloads/all) | [EU-1](https://falcon.eu-1.crowdstrike.com/sensor-downloads/all). On GovCloud, open the same page on your GovCloud console host.
> - **API client:** go to **Support and resources** > **Client Management** > **API Clients** > **Create API client**. Copy the client secret right away; the console shows it only once.

> **Note:** This lab is for clusters on **ECS Managed Instances**. For a cluster whose EC2 instances you launch and manage yourself, use the [EC2 Daemon Service](../ec2-daemon-service/) lab instead; it uses a different CloudFormation template.

## Reference Docs

| Source | Link |
| ------ | ---- |
| CrowdStrike CloudFormation stack for ECS (template and README) | https://github.com/CrowdStrike/aws-cloudformation-falcon-sensor-ecs |
| falcon-container-sensor-pull script | https://github.com/CrowdStrike/falcon-scripts/tree/main/bash/containers/falcon-container-sensor-pull |
| Amazon ECS Managed Instances | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/managed-instances.html |
| ECS Managed Instances infrastructure role | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/managed-instances-infrastructure-role.html |
| aws cloudformation deploy | https://docs.aws.amazon.com/cli/latest/reference/cloudformation/deploy/ |

---

## Core Concepts

With **ECS Managed Instances**, you do not launch or patch the EC2 instances. You attach a **capacity provider** to the cluster, and AWS launches the instances your tasks need, runs the ECS agent on them, and replaces each one at least every 14 days. There is no SSH, and you cannot install software on the host yourself, so the sensor ships as a container that runs on every instance instead.

An **ECS managed daemon** is how that works. It is a separate ECS resource (not a regular service) that runs exactly one copy of a task on every instance in the capacity providers you name, starts before your workloads, and is restarted or replaced with the instance. It is the Managed Instances counterpart of the `DAEMON` service used on classic EC2 clusters.

A **CloudFormation stack** is a group of AWS resources created from one template file. CrowdStrike's Managed template creates two things: a daemon task definition and the managed daemon (plus an optional log group).

- **Init container** (`init-falconstore`) — runs first, writes the sensor files to the instance under `/opt/CrowdStrike`, then exits.
- **Sensor container** (`crowdstrike-falcon-node-sensor`) — starts after the init container finishes. It runs privileged with the instance's PID and IPC namespaces shared, which is how one container sees every process on the instance.

> **Why this matters:** The template creates no IAM roles, but it needs an **execution role** you pass in. On Managed Instances the instance role cannot pull from ECR or write logs for the daemon task, so the execution role does both.

> **Heads-up:** Deploying, upgrading, changing parameters on, or deleting the stack drains and replaces your instances in batches, because AWS cannot change a managed instance in place. Each replacement registers in Falcon as a **new host with a new Agent ID (AID)**, and the old host entries go offline. Plan a maintenance window before running this against a production cluster.

The template pulls the sensor from your own ECR, so you copy the `falcon-sensor` image there first. The template needs sensor 8.12 or later, which the pull script's latest image satisfies.

```
ECS MANAGED INSTANCES DAEMON — CLOUDFORMATION
CloudFormation Stack | Managed daemon crowdstrike-falcon-node-daemon
Your ECR | falcon-sensor image
Capacity provider | AWS launches and replaces instances
ECS cluster — Managed instances 1, 2, 3 | one sensor task per instance
crowdstrike-falcon-node-sensor | privileged / shared PID and IPC
CrowdStrike Cloud — Telemetry
```

---

## Deployment Steps

<div data-mode="guide">

### 1. Set credentials

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,AWS_ACCOUNT_ID:AWS account ID,AWS_REGION:AWS region,CLUSTER_NAME:ECS cluster name,EXECUTION_ROLE_ARN:Execution role ARN"></div>

Then copy this to export the API client secret. It is the only value kept as a shell variable, and the page never saves it:

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

> **Warning:** Use the same region as your cluster for `AWS_REGION`. A stack created in a different region cannot find the cluster.

### 2. Copy the Falcon sensor image to ECR

Create an ECR repository for the sensor (skips if it already exists). The repo name must be `falcon-sensor` because `--copy` does not rename images:

```bash
aws ecr describe-repositories --repository-names falcon-sensor --region <AWS_REGION> >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name falcon-sensor --region <AWS_REGION> --query repository.repositoryUri --output text
```

> **Verify:** A new repo prints its address (`<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-sensor`). Nothing prints if it already exists.

Log Docker in to your ECR registry (the pull script does not log in to the destination):

```bash
aws ecr get-login-password --region <AWS_REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

Pick the Falcon cloud your CID belongs to, then copy the `falcon-sensor` image (the node sensor, not `falcon-container`) from CrowdStrike's registry into your ECR:

<div data-choice-picker="falconcloud"></div>

<div data-choice="falconcloud:commercial">

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-sensor --copy <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

</div>

<div data-choice="falconcloud:govcloud-1">

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-sensor --region us-gov-1 --copy <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

</div>

<div data-choice="falconcloud:govcloud-2">

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-sensor --region us-gov-2 --copy <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

</div>

### 3. Build the image path and find the capacity providers

`--copy` keeps the image tag, so read it back from ECR and build the full path the stack will pull:

```bash
export FALCON_IMAGE_TAG=$(aws ecr describe-images --repository-name falcon-sensor --region <AWS_REGION> --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
export FALCON_IMAGE_PATH="<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/falcon-sensor:$FALCON_IMAGE_TAG"
```

List your cluster's Managed Instances capacity providers as one comma-separated string. The sensor runs only on instances under the providers you pass:

```bash
export CAPACITY_PROVIDER_ARNS=$(aws ecs describe-capacity-providers --cluster <CLUSTER_NAME> --region <AWS_REGION> --query "join(',', capacityProviders[?managedInstancesProvider].capacityProviderArn)" --output text)
```

Validate the values were populated (a ✅ means set, a ❌ means missing):

```bash
echo "Client Secret       : $([ -n "$FALCON_CLIENT_SECRET" ] && echo ✅ || echo ❌)"
echo "Image path          : $([ -n "$FALCON_IMAGE_TAG" ] && [ "$FALCON_IMAGE_TAG" != None ] && echo ✅ || echo ❌) ($FALCON_IMAGE_PATH)"
echo "Capacity providers  : $([ -n "$CAPACITY_PROVIDER_ARNS" ] && echo ✅ || echo ❌) ($CAPACITY_PROVIDER_ARNS)"
```

> **Verify:** The tag looks like `8.12.0-20000-1`. `None` means the copy in step 2 did not finish; re-run it and read the error. An empty capacity provider list means the cluster has no Managed Instances provider, so this is not the right lab for it.

### 4. Get the CloudFormation template

Clone CrowdStrike's repo at a released version and move into the Managed folder:

```bash
git clone --branch v0.3.0 --depth 1 https://github.com/CrowdStrike/aws-cloudformation-falcon-sensor-ecs.git
cd aws-cloudformation-falcon-sensor-ecs/falcon-sensor-ecs-managed
```

### 5. Deploy the stack

Edit the highlighted `SENSOR_TAGS` field (the page replaces it when you click Copy) to group these hosts in the Falcon console. Use comma-separated values; letters, numbers, `-`, `_`, `/` only. The two GovCloud lines appear only when you pick GovCloud in step 2:

```bash
aws cloudformation deploy \
  --region <AWS_REGION> \
  --stack-name falcon-ecs-managed-daemon-<CLUSTER_NAME> \
  --template-file falcon-ecs-managed-daemon.yaml \
  --parameter-overrides \
    "ECSClusterName=<CLUSTER_NAME>" \
    "FalconCID=<FALCON_CID>" \
    "FalconImagePath=$FALCON_IMAGE_PATH" \
    "CapacityProviderArns=$CAPACITY_PROVIDER_ARNS" \
    "ECSExecutionRoleArn=<EXECUTION_ROLE_ARN>" \
    "Cloud=us-gov-1" \ #@choice=falconcloud:govcloud-1
    "Cloud=us-gov-2" \ #@choice=falconcloud:govcloud-2
    "Tags=<SENSOR_TAGS:ecs-managed-daemon>"
```

> **Look for:** The command waits, then prints `Successfully created/updated stack - falcon-ecs-managed-daemon-<CLUSTER_NAME>`. If it ends with `Failed to create/update the stack`, run `aws cloudformation describe-stack-events --stack-name falcon-ecs-managed-daemon-<CLUSTER_NAME> --region <AWS_REGION>` and read the first `FAILED` reason.

> **Heads-up:** ECS now drains and replaces your instances in batches (10 percent at a time by default, with a 5-minute bake time between batches), so the rollout can take a while on a larger cluster. Expect new host entries with new AIDs in Falcon.

> **Note:** Proxy, logging, deployment pacing, resource limits, and other options are extra `--parameter-overrides` entries. Full Lab section 4 lists them and Challenges 1 and 2 use some.

### 6. Verify deployment

Confirm the stack finished:

```bash
aws cloudformation describe-stacks --stack-name falcon-ecs-managed-daemon-<CLUSTER_NAME> --region <AWS_REGION> --query "Stacks[0].StackStatus" --output text
```

> **Verify:** `CREATE_COMPLETE` (or `UPDATE_COMPLETE` on a redeploy).

Look up the daemon and its latest rollout:

```bash
export DAEMON_ARN=$(aws cloudformation describe-stack-resources --stack-name falcon-ecs-managed-daemon-<CLUSTER_NAME> --region <AWS_REGION> --logical-resource-id FalconECSDaemon --query "StackResources[0].PhysicalResourceId" --output text)
export DEPLOYMENT_ARN=$(aws ecs describe-daemon --daemon-arn $DAEMON_ARN --region <AWS_REGION> --query "daemon.deploymentArn" --output text)
```

Check the rollout status:

```bash
aws ecs describe-daemon-deployments --daemon-deployment-arns $DEPLOYMENT_ARN --region <AWS_REGION> --query "daemonDeployments[0].status" --output text
```

> **Verify:** `SUCCESSFUL`. `IN_PROGRESS` means instances are still being replaced; wait and run it again.

Count the sensor tasks running and the instances in the cluster, and compare:

```bash
aws ecs describe-daemon --daemon-arn $DAEMON_ARN --region <AWS_REGION> --query "daemon.currentRevisions[0].totalRunningCount" --output text
```

```bash
aws ecs list-container-instances --cluster <CLUSTER_NAME> --region <AWS_REGION> --query "length(containerInstanceArns)" --output text
```

> **Verify:** Both numbers match. A deployment can report `SUCCESSFUL` while one instance still has no sensor (a first-install race). If the counts differ, drain the instance that is missing it so ECS replaces it: `aws ecs update-container-instances-state --cluster <CLUSTER_NAME> --container-instances <INSTANCE_ARN> --status DRAINING --region <AWS_REGION>`.

Finally, in the Falcon console go to **Host setup and management** > **Host management** > **Manage endpoints** and look for your instances. Filter by **Grouping Tags** with your `SENSOR_TAGS` value. Hosts appear within a few minutes.

### 7. Test a detection (optional)

Managed Instances have no SSH, so run CrowdStrike's detection container as a one-off task on the cluster. Register a task definition for it:

```bash
aws ecs register-task-definition --region <AWS_REGION> --family falcon-detection-test \
  --requires-compatibilities MANAGED_INSTANCES --network-mode awsvpc --cpu 256 --memory 512 \
  --container-definitions '[{"name":"detection","image":"quay.io/crowdstrike/detection-container","essential":true,"command":["bash /home/eval/bin/Defense_Evasion_via_Rootkit.sh"]}]'
```

Run it on your cluster, using your Managed Instances capacity provider and a subnet and security group from the cluster's VPC:

```bash
aws ecs run-task --cluster <CLUSTER_NAME> --region <AWS_REGION> --task-definition falcon-detection-test \
  --capacity-provider-strategy capacityProvider=<CAPACITY_PROVIDER_NAME>,weight=1 \
  --network-configuration "awsvpcConfiguration={subnets=[<SUBNET_ID>],securityGroups=[<SECURITY_GROUP_ID>],assignPublicIp=ENABLED}"
```

> **Look for:** In the Falcon console, **Next-Gen SIEM** > **Monitor and investigate** > **Detections**, a **Critical** detection with tactic **Defense Evasion via Rootkit** on the instance that ran the task, including container and image details.

### 8. Clean up (optional)

Removing the sensor is one command. Unlike the EC2 version there is no second cleanup stack, because ECS replaces every instance with a fresh one when the daemon is deleted:

```bash
aws cloudformation delete-stack --stack-name falcon-ecs-managed-daemon-<CLUSTER_NAME> --region <AWS_REGION>
```

> **Note:** The replaced instances register as new hosts without a sensor, and the old host entries stay in the Falcon console for a while. The ECR repo and copied image are not removed.

</div>

<div data-mode="lab">

## 1. Provision a Test Cluster

> **What & Why:** The lab needs an ECS cluster on Managed Instances capacity. That takes three IAM roles, a capacity provider, and a small sample workload, because a Managed Instances cluster launches **no instances until a task needs one**. The default VPC and subnets that every AWS account starts with are enough.

> **Note:** Examples use the commercial `arn:aws` partition and a Managed Instances-capable region such as `{{REGION}}`. On GovCloud, use `arn:aws-us-gov` and make sure the AWS docs list Managed Instances as available in your region.

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

- [ ] Enter your account ID so the commands below can use it:

<div data-fill-fields="AWS_ACCOUNT_ID:AWS account ID"></div>

### Step 2: Create the infrastructure role

> **What & Why:** The **infrastructure role** is the IAM role ECS assumes to launch, manage, and replace the EC2 instances in your account. It is what lets AWS manage instances on your behalf.

- [ ] **Console:** Navigate to **IAM** → **Roles** → **Create role**
  - Trusted entity type: **Custom trust policy**
  - Paste this trust policy, then click **Next**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAccessToECSForInfrastructureManagement",
      "Effect": "Allow",
      "Principal": { "Service": "ecs.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

  - Permissions: select `AmazonECSInfrastructureRolePolicyForManagedInstances`, then click **Next**
  - Role name: `ecsInfrastructureRole`
  - Click **Create role**

<details>
<summary>CLI equivalent</summary>

```bash
aws iam create-role --role-name ecsInfrastructureRole \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Sid":"AllowAccessToECSForInfrastructureManagement","Effect":"Allow","Principal":{"Service":"ecs.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name ecsInfrastructureRole --policy-arn arn:aws:iam::aws:policy/AmazonECSInfrastructureRolePolicyForManagedInstances
```

</details>

### Step 3: Create the instance role and instance profile

> **What & Why:** The **instance role** is what the managed instances themselves use to talk to ECS. EC2 attaches a role to an instance through an **instance profile**, a small wrapper with the same name.

> **Heads-up:** The role name must start with `ecsInstanceRole`. The AWS-managed infrastructure policy only allows ECS to pass roles named `ecsInstanceRole*`, so any other name fails later with a `ResourceInitializationError` that mentions `iam:PassRole`.

- [ ] **Console:** Navigate to **IAM** → **Roles** → **Create role**
  - Trusted entity type: **AWS service**, Use case: **EC2**, then click **Next**
  - Permissions: select `AmazonECSInstanceRolePolicyForManagedInstances`, then click **Next**
  - Role name: `ecsInstanceRole`
  - Click **Create role** (the console creates an instance profile with the same name for you)

<details>
<summary>CLI equivalent</summary>

```bash
aws iam create-role --role-name ecsInstanceRole \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name ecsInstanceRole --policy-arn arn:aws:iam::aws:policy/AmazonECSInstanceRolePolicyForManagedInstances
aws iam create-instance-profile --instance-profile-name ecsInstanceRole
aws iam add-role-to-instance-profile --instance-profile-name ecsInstanceRole --role-name ecsInstanceRole
```

</details>

### Step 4: Create the task execution role

> **What & Why:** The **execution role** lets ECS pull container images from ECR and write logs for a task. The Falcon stack needs one so the sensor task can pull your `falcon-sensor` image.

- [ ] **Console:** Navigate to **IAM** → **Roles** → **Create role**
  - Trusted entity type: **AWS service**, Use case: **Elastic Container Service**, then **Elastic Container Service Task**, then click **Next**
  - Permissions: select `AmazonECSTaskExecutionRolePolicy`, then click **Next**
  - Role name: `ecsTaskExecutionRole`
  - Click **Create role**

<details>
<summary>CLI equivalent</summary>

```bash
aws iam create-role --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name ecsTaskExecutionRole --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

</details>

> **Note:** If `ecsTaskExecutionRole` already exists in your account (many accounts have it), skip this step and reuse it.

### Step 5: Create the cluster with a Managed Instances capacity provider

> **What & Why:** A **capacity provider** tells ECS where to get compute. A Managed Instances capacity provider carries the infrastructure role, the instance profile, and the subnets and security group AWS should launch instances into. The default VPC works because its subnets give instances a public IP, which they need to reach ECR and the Falcon cloud.

- [ ] **Console:** Navigate to **Elastic Container Service** → **Clusters** → **Create cluster**
  - Cluster name: `{{CLUSTER_NAME}}`
  - Infrastructure: **Fargate and Managed Instances**
  - Infrastructure role: `ecsInfrastructureRole`
  - Instance profile: `ecsInstanceRole`
  - Instance attributes: **Use ECS defaults**
  - Networking: your default VPC, its subnets, and the VPC's `default` security group
  - Click **Create**

<details>
<summary>CLI equivalent</summary>

Create the cluster:

```bash
aws ecs create-cluster --cluster-name {{CLUSTER_NAME}} --region {{REGION}}
```

Look up the default VPC's subnets and security group:

```bash
export VPC_ID=$(aws ec2 describe-vpcs --region {{REGION}} --filters Name=is-default,Values=true --query "Vpcs[0].VpcId" --output text)
export SUBNETS_JSON=$(aws ec2 describe-subnets --region {{REGION}} --filters Name=vpc-id,Values=$VPC_ID Name=default-for-az,Values=true --query "Subnets[].SubnetId" --output json | tr -d ' \n')
export SG_ID=$(aws ec2 describe-security-groups --region {{REGION}} --filters Name=vpc-id,Values=$VPC_ID Name=group-name,Values=default --query "SecurityGroups[0].GroupId" --output text)
```

Write the capacity provider definition:

```bash
cat > capacity-provider.json <<EOF
{
  "name": "{{CLUSTER_NAME}}-mi",
  "cluster": "{{CLUSTER_NAME}}",
  "managedInstancesProvider": {
    "infrastructureRoleArn": "arn:aws:iam::<AWS_ACCOUNT_ID>:role/ecsInfrastructureRole",
    "instanceLaunchTemplate": {
      "ec2InstanceProfileArn": "arn:aws:iam::<AWS_ACCOUNT_ID>:instance-profile/ecsInstanceRole",
      "networkConfiguration": { "subnets": $SUBNETS_JSON, "securityGroups": ["$SG_ID"] },
      "storageConfiguration": { "storageSizeGiB": 30 },
      "monitoring": "basic"
    }
  }
}
EOF
```

Create the capacity provider, then make it the cluster's default:

```bash
aws ecs create-capacity-provider --region {{REGION}} --cli-input-json file://capacity-provider.json
```

```bash
aws ecs put-cluster-capacity-providers --region {{REGION}} --cluster {{CLUSTER_NAME}} \
  --capacity-providers {{CLUSTER_NAME}}-mi \
  --default-capacity-provider-strategy capacityProvider={{CLUSTER_NAME}}-mi,weight=1
```

</details>

> **Verify:** The cluster shows a capacity provider named like `{{CLUSTER_NAME}}-mi` (the console may generate its own name). The cluster has **0 container instances** for now; that is expected.

### Step 6: Launch a sample workload so an instance exists

> **What & Why:** Managed Instances launch only when a task needs capacity. A tiny web service gives AWS a reason to start one instance, which is where the sensor will land.

> **Costs money:** A running Managed Instances instance bills the normal EC2 price **plus a per-instance management fee**, by the second with a one-minute minimum. Section 8 deletes it.

- [ ] **Console:** Navigate to **Elastic Container Service** → **Task definitions** → **Create new task definition**
  - Task definition family: `falcon-lab-web`
  - Launch type: **Managed Instances**, Network mode: **awsvpc**, CPU: `1 vCPU`, Memory: `2 GB`
  - Task execution role: `ecsTaskExecutionRole`
  - Container: name `web`, image `public.ecr.aws/docker/library/httpd:latest`, container port `80`
  - Click **Create**
- [ ] **Console:** Open your cluster → **Services** → **Create**
  - Task definition: `falcon-lab-web`, Service name: `falcon-lab-web`, Desired tasks: `1`
  - Compute options: **Capacity provider strategy** → your Managed Instances capacity provider, weight `1`
  - Networking: default VPC and subnets, security group `default`, **Public IP** on
  - Click **Create**

<details>
<summary>CLI equivalent</summary>

Register the task definition:

```bash
aws ecs register-task-definition --region {{REGION}} --family falcon-lab-web \
  --requires-compatibilities MANAGED_INSTANCES --network-mode awsvpc --cpu 1024 --memory 2048 \
  --execution-role-arn arn:aws:iam::<AWS_ACCOUNT_ID>:role/ecsTaskExecutionRole \
  --container-definitions '[{"name":"web","image":"public.ecr.aws/docker/library/httpd:latest","essential":true,"portMappings":[{"containerPort":80}]}]'
```

Create the service, reusing `SUBNETS_JSON`'s first subnet and `SG_ID` from step 5 (or look them up in the console):

```bash
export SUBNET_ID=$(echo $SUBNETS_JSON | tr -d '[]"' | cut -d, -f1)
aws ecs create-service --region {{REGION}} --cluster {{CLUSTER_NAME}} --service-name falcon-lab-web \
  --task-definition falcon-lab-web --desired-count 1 \
  --capacity-provider-strategy capacityProvider={{CLUSTER_NAME}}-mi,weight=1 \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_ID],securityGroups=[$SG_ID],assignPublicIp=ENABLED}"
```

</details>

### Step 7: Confirm an instance registered

- [ ] **Console:** Open your cluster → **Infrastructure** tab → **Container instances**, and wait for one row

<details>
<summary>CLI equivalent</summary>

```bash
aws ecs list-container-instances --cluster {{CLUSTER_NAME}} --region {{REGION}} --query "length(containerInstanceArns)" --output text
```

</details>

> **Verify:** The count is `1`, and the `falcon-lab-web` service shows one running task. The first instance can take a few minutes to launch. If the service events mention `iam:PassRole`, the instance role name does not start with `ecsInstanceRole`.

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

- [ ] Enter your values:

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,AWS_ACCOUNT_ID:AWS account ID"></div>

- [ ] Export the API client secret (the only value kept as a shell variable):

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

---

## 3. Copy the Sensor Image to ECR

> **What & Why:** The CloudFormation template pulls the sensor from an ECR repo in your account. You create the repo, then copy the image from CrowdStrike's registry into it.

> **Tip:** Use the **node sensor** (`falcon-sensor`) here, not `falcon-container`. The container sensor is for Fargate; the node sensor is the one that runs on a host.

### Step 1: Create the ECR repository

- [ ] **Console:** Navigate to **Elastic Container Registry** → **Private registry** → **Repositories** → **Create repository**
  - Repository name: `falcon-sensor` (it must match exactly because the copy keeps the image name)
  - Click **Create**

<details>
<summary>CLI equivalent</summary>

```bash
aws ecr create-repository --repository-name falcon-sensor --region {{REGION}} --query repository.repositoryUri --output text
```

</details>

> **Verify:** The repo list shows `falcon-sensor` with the URI `<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-sensor`.

### Step 2: Log Docker in to ECR

> **What & Why:** The pull script pushes with your local Docker, which has to authenticate to ECR first. The script does not do this for you.

- [ ] Log in:

```bash
aws ecr get-login-password --region {{REGION}} | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com
```

> **Verify:** `Login Succeeded`.

### Step 3: Copy the image

- [ ] Pick the Falcon cloud your CID belongs to, then copy the image:

<div data-choice-picker="falconcloud"></div>

<div data-choice="falconcloud:commercial">

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-sensor --copy <AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com
```

</div>

<div data-choice="falconcloud:govcloud-1">

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-sensor --region us-gov-1 --copy <AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com
```

</div>

<div data-choice="falconcloud:govcloud-2">

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-sensor --region us-gov-2 --copy <AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com
```

</div>

> **Note:** Add `-p x86_64` or `-p aarch64` to copy only one CPU architecture. Without it the script copies every architecture CrowdStrike publishes, so the same image works on whichever instance types AWS picks.

### Step 4: Read the tag and build the image path

- [ ] **Console:** Open **Elastic Container Registry** → **Repositories** → `falcon-sensor`; the **Image tags** column shows the tag (for example `8.12.0-20000-1`)
- [ ] Save the tag and full path (the path is what the stack's `FalconImagePath` parameter takes):

```bash
export FALCON_IMAGE_TAG=$(aws ecr describe-images --repository-name falcon-sensor --region {{REGION}} --query 'sort_by(imageDetails[?imageTags!=null],&imagePushedAt)[-1].imageTags[0]' --output text)
export FALCON_IMAGE_PATH="<AWS_ACCOUNT_ID>.dkr.ecr.{{REGION}}.amazonaws.com/falcon-sensor:$FALCON_IMAGE_TAG"
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

> **What & Why:** The stack creates the daemon task definition and the managed daemon. CloudFormation tracks everything it made, so one `delete-stack` later removes it all.

> **Heads-up:** Creating the daemon replaces your instances. With one instance that means a short gap where it is drained and a new one launches, and the new instance registers in Falcon as a new host.

### Step 1: Get the template

- [ ] Clone CrowdStrike's repo at a released version (the Managed template v0.3.x needs sensor 8.12 or later):

```bash
git clone --branch v0.3.0 --depth 1 https://github.com/CrowdStrike/aws-cloudformation-falcon-sensor-ecs.git
cd aws-cloudformation-falcon-sensor-ecs/falcon-sensor-ecs-managed
```

> **Verify:** `ls` shows `falcon-ecs-managed-daemon.yaml`.

### Step 2: Look up the capacity provider

> **Why this matters:** The sensor runs only on instances launched by the capacity providers you pass in `CapacityProviderArns`. An instance under any other provider has no sensor, so list every Managed Instances provider the cluster uses.

- [ ] **Console:** Open your cluster → **Infrastructure** tab → **Capacity providers**, and note the provider name; its ARN ends `capacity-provider/<name>`
- [ ] Save the ARNs as one comma-separated string (the lookup returns every Managed Instances provider on the cluster):

```bash
export CAPACITY_PROVIDER_ARNS=$(aws ecs describe-capacity-providers --cluster {{CLUSTER_NAME}} --region {{REGION}} --query "join(',', capacityProviders[?managedInstancesProvider].capacityProviderArn)" --output text)
echo $CAPACITY_PROVIDER_ARNS
```

> **Verify:** One ARN prints, like `arn:aws:ecs:{{REGION}}:<AWS_ACCOUNT_ID>:capacity-provider/{{CLUSTER_NAME}}-mi`. An empty line means the cluster has no Managed Instances capacity provider.

### Step 3: Parameters

> **Why this matters:** Parameters are the template's inputs. Five are required: cluster name, CID, image path, capacity provider ARNs, and execution role ARN. The rest have safe defaults: `Tags`, `Cloud` (required for GovCloud), proxy settings, `EnableLogging`, deployment pacing (`DeploymentBakeTimeInMinutes`, `DeploymentDrainPercent`), `DaemonCritical`, and resource limits.

### Step 4: Create the stack

- [ ] **Console:** Set the region selector (top right) to `{{REGION}}`, then navigate to **CloudFormation** → **Stacks** → **Create stack** → **With new resources (standard)**
  - Prepare template: **Choose an existing template**, Specify template: **Upload a template file** → **Choose file** → `falcon-ecs-managed-daemon.yaml` → **Next**
  - Stack name: `falcon-ecs-managed-daemon-{{CLUSTER_NAME}}`
  - ECSClusterName: `{{CLUSTER_NAME}}`
  - FalconCID: your CID with checksum
  - FalconImagePath: the full image path (run `echo $FALCON_IMAGE_PATH` and paste)
  - CapacityProviderArns: the ARN from step 2
  - ECSExecutionRoleArn: `arn:aws:iam::<AWS_ACCOUNT_ID>:role/ecsTaskExecutionRole`
  - Tags: `ecs-managed-daemon` (groups the hosts in the Falcon console)
  - Cloud (GovCloud only): `us-gov-1` or `us-gov-2`
  - Click **Next** twice, then **Submit**

<details>
<summary>CLI equivalent</summary>

```bash
aws cloudformation deploy \
  --region {{REGION}} \
  --stack-name falcon-ecs-managed-daemon-{{CLUSTER_NAME}} \
  --template-file falcon-ecs-managed-daemon.yaml \
  --parameter-overrides \
    "ECSClusterName={{CLUSTER_NAME}}" \
    "FalconCID=<FALCON_CID>" \
    "FalconImagePath=$FALCON_IMAGE_PATH" \
    "CapacityProviderArns=$CAPACITY_PROVIDER_ARNS" \
    "ECSExecutionRoleArn=arn:aws:iam::<AWS_ACCOUNT_ID>:role/ecsTaskExecutionRole" \
    "Cloud=us-gov-1" \ #@choice=falconcloud:govcloud-1
    "Cloud=us-gov-2" \ #@choice=falconcloud:govcloud-2
    "Tags=ecs-managed-daemon"
```

</details>

> **Note:** The template creates no IAM resources, so CloudFormation does not ask you to acknowledge capabilities.

### Step 5: Wait for the stack

- [ ] **Console:** Open the stack → **Events** tab and watch the resources go to `CREATE_COMPLETE`. The managed daemon is the last one and waits for its rollout.

> **Look for:** The stack's **Status** at the top reads `CREATE_COMPLETE`. If it shows `ROLLBACK_COMPLETE`, open **Events**, scroll to the first `CREATE_FAILED` row, and read **Status reason**. The stack must be deleted before you retry.

---

## 5. Verify Deployment

> **What & Why:** Confirm the daemon placed one sensor task on every instance, then confirm the sensors registered with CrowdStrike. The count check is required, not optional: a rollout can report success while an instance has no sensor.

### Step 1: Confirm the rollout finished

- [ ] **Console:** Navigate to **Elastic Container Service** → **Clusters** → `{{CLUSTER_NAME}}` → **Daemons** tab → `crowdstrike-falcon-node-daemon`, and read the latest deployment status

<details>
<summary>CLI equivalent</summary>

```bash
export DAEMON_ARN=$(aws cloudformation describe-stack-resources --stack-name falcon-ecs-managed-daemon-{{CLUSTER_NAME}} --region {{REGION}} --logical-resource-id FalconECSDaemon --query "StackResources[0].PhysicalResourceId" --output text)
export DEPLOYMENT_ARN=$(aws ecs describe-daemon --daemon-arn $DAEMON_ARN --region {{REGION}} --query "daemon.deploymentArn" --output text)
aws ecs describe-daemon-deployments --daemon-deployment-arns $DEPLOYMENT_ARN --region {{REGION}} --query "daemonDeployments[0].status" --output text
```

</details>

> **Verify:** The status is `SUCCESSFUL`. `IN_PROGRESS` means ECS is still draining and replacing instances in batches; wait and check again.

### Step 2: Compare sensor tasks to instances

- [ ] **Console:** On the daemon page, note the running task count; on the cluster's **Infrastructure** tab, note the container instance count

<details>
<summary>CLI equivalent</summary>

```bash
aws ecs describe-daemon --daemon-arn $DAEMON_ARN --region {{REGION}} --query "daemon.currentRevisions[0].totalRunningCount" --output text
aws ecs list-container-instances --cluster {{CLUSTER_NAME}} --region {{REGION}} --query "length(containerInstanceArns)" --output text
```

</details>

> **Verify:** Both numbers are `1` for this lab, and they match on any cluster. If the sensor count is lower, an instance came up without a sensor (a first-install race). Drain it so ECS replaces it with a fresh one:

```bash
aws ecs update-container-instances-state --cluster {{CLUSTER_NAME}} --region {{REGION}} --status DRAINING --container-instances <INSTANCE_ARN>
```

### Step 3: Verify in Falcon console

- [ ] Navigate to **Falcon Console** > **Host setup and management** > **Host management** > **Manage endpoints**
- [ ] Filter by **Grouping Tags** with `ecs-managed-daemon`
- [ ] The instance should appear within a few minutes

> **Why this matters:** Every time ECS replaces an instance (a stack update, a delete, or the automatic 14-day refresh), Falcon sees a **new host with a new AID** and the previous one goes offline. That is expected for Managed Instances; filter by your grouping tag, not by a specific host.

### Step 4: Troubleshooting

| Symptom | Likely cause | Check |
|---------|--------------|-------|
| Stack `ROLLBACK_COMPLETE` | Cluster name wrong, stack in a different region than the cluster, or earlier stack with the same name | Stack **Events** tab, first `CREATE_FAILED` row |
| Sensor count lower than instance count | Instance is not under a capacity provider listed in `CapacityProviderArns`, or a first-install race | Compare the provider ARNs; drain the instance as in step 2 |
| Task stops with `CannotPullContainerError` | Image path or tag wrong, or the execution role cannot pull from ECR | Daemon task **Stopped reason**; confirm the tag exists in your `falcon-sensor` repo and the role has `AmazonECSTaskExecutionRolePolicy` |
| `ResourceInitializationError` mentioning `iam:PassRole` | Instance role name does not start with `ecsInstanceRole` | Section 1, step 3 |
| Task running but no host in console | Instance cannot reach the Falcon cloud on TLS 443, or still registering | Security group and subnet egress; wait a few minutes |

---

## 6. Test a Detection (Optional)

> **What & Why:** Hosts registering proves connectivity. A detection proves the sensor is actively watching the instance and the containers on it. Managed Instances have no SSH, so the test runs as a one-off ECS task instead of from a shell.

### Step 1: Register the detection task definition

- [ ] **Console:** Navigate to **Elastic Container Service** → **Task definitions** → **Create new task definition**
  - Task definition family: `falcon-detection-test`
  - Launch type: **Managed Instances**, Network mode: **awsvpc**, CPU: `0.25 vCPU`, Memory: `0.5 GB`
  - Container: name `detection`, image `quay.io/crowdstrike/detection-container`, Command: `bash /home/eval/bin/Defense_Evasion_via_Rootkit.sh`
  - Click **Create**

<details>
<summary>CLI equivalent</summary>

```bash
aws ecs register-task-definition --region {{REGION}} --family falcon-detection-test \
  --requires-compatibilities MANAGED_INSTANCES --network-mode awsvpc --cpu 256 --memory 512 \
  --container-definitions '[{"name":"detection","image":"quay.io/crowdstrike/detection-container","essential":true,"command":["bash /home/eval/bin/Defense_Evasion_via_Rootkit.sh"]}]'
```

</details>

### Step 2: Run the task and confirm

- [ ] **Console:** Open your cluster → **Tasks** → **Run new task**
  - Task definition: `falcon-detection-test`
  - Compute options: **Capacity provider strategy** → your Managed Instances capacity provider
  - Networking: default VPC and subnets, security group `default`, **Public IP** on
  - Click **Create**

<details>
<summary>CLI equivalent</summary>

```bash
aws ecs run-task --cluster {{CLUSTER_NAME}} --region {{REGION}} --task-definition falcon-detection-test \
  --capacity-provider-strategy capacityProvider={{CLUSTER_NAME}}-mi,weight=1 \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_ID],securityGroups=[$SG_ID],assignPublicIp=ENABLED}"
```

</details>

- [ ] In the Falcon console, go to **Next-Gen SIEM** > **Monitor and investigate** > **Detections** and find the host

> **Look for:** A **Critical** detection with tactic **Defense Evasion via Rootkit**, carrying container and image details because the sensor saw the activity from the instance. The task itself finishes and stops within seconds; that is normal.

---

## 7. Remove the Sensor

> **Destructive:** This removes the Falcon sensor by replacing every instance in the cluster with a fresh one. Run it only when you are finished, or when you want to see the uninstall path.

> **Why this matters:** On classic EC2 clusters the sensor leaves files on the host, so a second cleanup stack is needed. A managed instance is thrown away and replaced instead, so the files go with it and deleting one stack is the whole uninstall.

### Step 1: Delete the stack

- [ ] **Console:** Navigate to **CloudFormation** → **Stacks** → `falcon-ecs-managed-daemon-{{CLUSTER_NAME}}` → **Delete** → **Delete**

<details>
<summary>CLI equivalent</summary>

```bash
aws cloudformation delete-stack --stack-name falcon-ecs-managed-daemon-{{CLUSTER_NAME}} --region {{REGION}}
```

</details>

> **Verify:** The stack disappears from the **Stacks** list. The cluster's container instance list shows the old instance being replaced by a new one that has no sensor.

> **Note:** Host entries stay in the Falcon console for a while after the sensors are gone.

---

## 8. Delete the Test Cluster

> **Costs money:** The managed instance bills by the second plus a management fee until it is deleted. Skip this section only if you want to keep the cluster for the Challenges.

### Step 1: Delete the services and cluster

> **What & Why:** Delete the workload first so no tasks need capacity. AWS terminates the managed instances automatically when the capacity provider is deleted.

- [ ] **Console:** Navigate to **Elastic Container Service** → **Clusters** → `{{CLUSTER_NAME}}` → **Services** → `falcon-lab-web` → **Delete service** → tick **Force delete**
- [ ] **Console:** Open the cluster → **Infrastructure** tab → **Capacity providers**, remove the provider, then delete it
- [ ] **Console:** From **Clusters**, select `{{CLUSTER_NAME}}` → **Delete cluster**

<details>
<summary>CLI equivalent</summary>

```bash
aws ecs delete-service --cluster {{CLUSTER_NAME}} --service falcon-lab-web --force --region {{REGION}}
```

Wait about a minute for the service to drain, then remove the capacity provider from the cluster, delete it, and delete the cluster:

```bash
aws ecs put-cluster-capacity-providers --cluster {{CLUSTER_NAME}} --region {{REGION}} --capacity-providers --default-capacity-provider-strategy
aws ecs delete-capacity-provider --capacity-provider {{CLUSTER_NAME}}-mi --region {{REGION}}
aws ecs delete-cluster --cluster {{CLUSTER_NAME}} --region {{REGION}}
```

</details>

> **Note:** If a delete reports the capacity provider is still in use, wait a minute for the instance to terminate and run it again.

### Step 2: Delete the IAM roles

- [ ] **Console:** Navigate to **IAM** → **Roles**, select `ecsInfrastructureRole` and `ecsInstanceRole` (and `ecsTaskExecutionRole` if you created it only for this lab) → **Delete**

<details>
<summary>CLI equivalent</summary>

```bash
aws iam detach-role-policy --role-name ecsInfrastructureRole --policy-arn arn:aws:iam::aws:policy/AmazonECSInfrastructureRolePolicyForManagedInstances
aws iam delete-role --role-name ecsInfrastructureRole
aws iam remove-role-from-instance-profile --instance-profile-name ecsInstanceRole --role-name ecsInstanceRole
aws iam delete-instance-profile --instance-profile-name ecsInstanceRole
aws iam detach-role-policy --role-name ecsInstanceRole --policy-arn arn:aws:iam::aws:policy/AmazonECSInstanceRolePolicyForManagedInstances
aws iam delete-role --role-name ecsInstanceRole
```

</details>

### Step 3: Delete the ECR repository

- [ ] **Console:** Navigate to **Elastic Container Registry** → **Repositories** → select `falcon-sensor` → **Delete** → type `delete` to confirm

<details>
<summary>CLI equivalent</summary>

```bash
aws ecr delete-repository --repository-name falcon-sensor --region {{REGION}} --force
```

</details>

---

## 9. Challenges

### Challenge 1: Turn on sensor logging

**Scenario:** Your security team wants the sensor's startup and runtime output in CloudWatch Logs, but there is no shell on a managed instance to read it.

<details>
<summary>Hint</summary>

The template has an `EnableLogging` parameter and creates the log group for you. Unlike the EC2 template, no extra role is needed: the execution role you already pass in writes the logs.

</details>

<details>
<summary>Solution</summary>

Re-run the section 4 deploy with one extra parameter override: `"EnableLogging=true"`. CloudFormation updates the stack in place, which also replaces your instances. The new log group is `/aws/ecs/{{CLUSTER_NAME}}/crowdstrike/falcon-daemon-service`, with streams prefixed `falcon-node-init` and `falcon-node-sensor`. `AmazonECSTaskExecutionRolePolicy` already allows writing the log streams.

</details>

### Challenge 2: Control how fast instances are replaced

**Scenario:** A customer's cluster has 40 instances and they do not want a quarter of them draining at once when the sensor is updated.

<details>
<summary>Hint</summary>

Look at `DeploymentDrainPercent` and `DeploymentBakeTimeInMinutes`. Also read the `DaemonCritical` description: it decides whether ECS replaces an instance when the sensor stops.

</details>

<details>
<summary>Solution</summary>

Redeploy with these extra overrides:

```
"DeploymentDrainPercent=5" "DeploymentBakeTimeInMinutes=10"
```

`DeploymentDrainPercent` is the share of instances updated at once (default 10), and the bake time is how long ECS waits between batches (default 5 minutes). Lower values shrink the blast radius but make the rollout slower. Separately, `DaemonCritical=true` (the default) means an instance does not run workloads until the sensor starts, and ECS replaces the instance if the sensor stops. Setting it to `false` keeps workloads running through a sensor failure, at the cost of an unprotected instance.

</details>

### Challenge 3: Upgrade the sensor

**Scenario:** CrowdStrike released a newer sensor and you want the daemon on it without deleting the stack.

<details>
<summary>Solution</summary>

List available tags, copy the version you want into ECR, then redeploy with the new path:

```bash
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type falcon-sensor --list-tags
```

Re-run the section 3 copy (add `--version <SENSOR_VERSION>` to pick one), re-run the tag and path exports from step 4, then the section 4 deploy. CloudFormation registers a new daemon task definition revision and ECS replaces the instances in batches, so each instance returns as a new host with a new AID.

</details>

---

## Quick Reference

| Action | Console Path | CLI Command |
|--------|-------------|-------------|
| Create ECR repo | **ECR** → **Repositories** → **Create repository** | `aws ecr create-repository --repository-name falcon-sensor` |
| Copy sensor image | n/a | `falcon-container-sensor-pull.sh --type falcon-sensor --copy <registry>` |
| List capacity providers | **ECS** → cluster → **Infrastructure** → **Capacity providers** | `aws ecs describe-capacity-providers --cluster <cluster>` |
| Deploy stack | **CloudFormation** → **Create stack** → upload `falcon-ecs-managed-daemon.yaml` | `aws cloudformation deploy --template-file falcon-ecs-managed-daemon.yaml ...` |
| Check stack | **CloudFormation** → stack → **Events** | `aws cloudformation describe-stacks --stack-name <name>` |
| Check daemon | **ECS** → cluster → **Daemons** → `crowdstrike-falcon-node-daemon` | `aws ecs describe-daemon --daemon-arn <arn>` |
| Check rollout | **ECS** → daemon → latest deployment | `aws ecs describe-daemon-deployments --daemon-deployment-arns <arn>` |
| Uninstall sensor | **CloudFormation** → delete stack | `aws cloudformation delete-stack --stack-name <name>` |

</div>

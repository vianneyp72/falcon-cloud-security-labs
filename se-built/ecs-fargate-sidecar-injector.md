# ECS Fargate Sidecar Injector — Falcon Container on ECS Fargate

A community/SE-built set of Bash scripts that inject the latest Falcon Container Sensor (sidecar) into your ECS Fargate task definitions, pulling ECS services or task definitions from your AWS environment and patching them automatically.

> **Note:** Community/SE-built — **not** an official CrowdStrike tool. Purpose is quick deployment of CWP resources for testing. Test in non-production first. For production and advanced customization, use the [official CrowdStrike documentation](https://falcon.crowdstrike.com/documentation).

| Source | Owner | Link |
|--------|-------|------|
| Repository | [@igorschultz](https://github.com/igorschultz) | https://github.com/igorschultz/container-sensor-ecs-fargate |

## What It Does

Wraps the Falcon Container sidecar workflow (pull image → push to ECR → patch → register new task definition) into interactive scripts that discover your ECS services or task definitions for you. Every run also saves a local folder with the original and patched task-definition JSON.

Two injection strategies are offered:

- **Patching Utility** — Patches the **task definition JSON** offline. Injects a `crowdstrike-falcon-init-container` into each container and sets the Falcon Container sensor as the container `EntryPoint`. Your application image is untouched.
- **Falcon Utility** — Patches the **application container image** itself. The Falcon utility (bundled in the sensor image) rebuilds your app image with the sensor and its dependencies baked in, sets the Falcon entry point, pushes the new image, and registers a new task definition revision.

## Required API Scopes

- Falcon Images Download: **Read**
- Sensor Download: **Read**

## Required AWS Permissions

- **ECS** — `ListServices`, `ListTaskDefinitionFamilies`, `DescribeClusters`, `DescribeServices`, `DescribeTaskDefinition`, `RegisterTaskDefinition`
- **ECR** — `DescribeRepositories`, `GetAuthorizationToken`, `BatchGetImage`, `CreateRepository`

> **Prerequisites:** `curl`, `jq`, and `docker` installed; an ECS cluster name; optionally an existing ECR repo to store the Falcon Container Sensor image (the scripts can create one for you).

## Scripts

### Patching Utility (patches the task definition)

| Script | Scope |
|--------|-------|
| `manual-patch-utility-task-definition.sh` | Pick one ACTIVE task definition to patch |
| `manual-patch-utility-service.sh` | Pick one service on a cluster to patch |
| `automated-patch-utility-cluster.sh` | Patch **all** services on a cluster |

### Falcon Utility (patches the container image)

| Script | Scope |
|--------|-------|
| `manual-falcon-utility-task-definition.sh` | Pick one ACTIVE task definition to patch |
| `manual-falcon-utility-service.sh` | Pick one service on a cluster to patch |

## Basic Usage

Clone the repo, then run the script for your chosen strategy and scope.

```bash
git clone https://github.com/igorschultz/container-sensor-ecs-fargate.git
cd container-sensor-ecs-fargate
```

Patch a single task definition (patching utility):

```bash
cd patching-utility
./manual-patch-utility-task-definition.sh \
  -u "<YOUR_FALCON_CLIENT_ID>" \
  -s "<YOUR_FALCON_CLIENT_SECRET>" \
  -r "<AWS_REGION>"
```

Patch every service on a cluster (patching utility):

```bash
./automated-patch-utility-cluster.sh \
  -u "<YOUR_FALCON_CLIENT_ID>" \
  -s "<YOUR_FALCON_CLIENT_SECRET>" \
  -r "<AWS_REGION>" \
  -c "<ECS_CLUSTER_NAME>"
```

Patch the application image instead (falcon utility, single service):

```bash
cd ../falcon-utility
./manual-falcon-utility-service.sh \
  -u "<YOUR_FALCON_CLIENT_ID>" \
  -s "<YOUR_FALCON_CLIENT_SECRET>" \
  -r "<AWS_REGION>" \
  -c "<ECS_CLUSTER_NAME>"
```

### Flags

| Flag | Value |
|------|-------|
| `-u`, `--client-id` | Falcon API OAuth Client ID |
| `-s`, `--client-secret` | Falcon API OAuth Client Secret |
| `-r`, `--region` | AWS region (e.g. `us-east-1`, `us-west-2`, `sa-east-1`) |
| `-c`, `--cluster` | ECS cluster name (service/cluster-scoped scripts only) |

> **Caution:** The scripts register **new** task definition revisions and can create ECR repositories in your account. Review the generated JSON (saved locally alongside the original) before pointing your services at the new revision.

## Which Utility Should I Use?

- **Patching Utility** — Faster, non-invasive to your image. Best when you cannot or do not want to rebuild the application image. Adds an init container and rewrites the entry point in the task definition.
- **Falcon Utility** — Bakes the sensor into the image itself. Best when you want the sensor to travel with the image regardless of where the task definition is deployed.

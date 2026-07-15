# Falcon Sensor on Azure Container Instances — Image-Embedded (falconutil patch-image)

Embed the CrowdStrike Falcon Container Sensor into your application image with `falconutil patch-image`, push it to Azure Container Registry (ACR), and run it on Azure Container Instances (ACI).

> **Performance note:** Patching adds the sensor rootfs (~30-50 MB) to your image and a few seconds of startup latency (sensor initializes before your app). Runtime footprint is roughly **30-35 MiB** memory and **<1 millicore** CPU per container at idle; CPU scales with syscall/process-event volume.

> **Prerequisites:**
>
> - Azure subscription with the `az` CLI installed and logged in (`az login`)
> - Docker engine running locally (you'll authenticate to ACR with `az acr login`)
> - CrowdStrike API client with **Falcon Images Download: Read** and **Sensor Download: Read** scopes
> - CrowdStrike CID with checksum
> - Falcon Container Sensor **7.22+** (older versions use a different `patch-image aci` subcommand — see the note in Section 3)

## Reference Docs

| Source                                                      | Link                                                                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Deploy Falcon Container Sensor on Azure Container Instances | https://docs.crowdstrike.com/r/en-US/iopiipqy/ndf35434                                                         |
| Deploy Falcon Container Sensor Embedded in Image            | https://docs.crowdstrike.com/r/en-US/iopiipqy/k58f1a5e                                                         |
| Falcon Container Sensor for Linux Architecture              | https://docs.crowdstrike.com/r/en-US/iopiipqy/ff6d35ef                                                         |
| Azure Container Instances docs                              | https://learn.microsoft.com/en-us/azure/container-instances/                                                   |
| Deploy to ACI from ACR                                      | https://learn.microsoft.com/en-us/azure/container-instances/container-instances-using-azure-container-registry |
| Terraform azurerm_container_group                           | https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/container_group                |

---

## Core Concepts

ACI is a serverless container runtime — no host access, no kernel modules, no DaemonSets, and no Kubernetes sidecar admission. The **only** way to run the Falcon sensor on ACI is to embed it directly into the container image at build time with `falconutil patch-image`, then deploy that patched image.

The flow is entirely offline + registry-based:

1. Copy the Falcon Container Sensor image (contains `falconutil` + the sensor runtime) straight from CrowdStrike into your ACR as a single-arch amd64 image
2. Run `falconutil patch-image` on your local Docker to inject the sensor into your application image
3. Push the patched image (`-falcon` suffix) to ACR
4. Deploy the patched image to ACI with `az container create`

### Architecture

```
LOCAL DOCKER (patch)
Falcon Container Image: falconutil binary + sensor runtime
falconutil patch-image: app:1.0 -> app:1.0-falcon (--cloud-service ACI)
docker push app:1.0-falcon
Azure Container Registry (ACR): app:1.0 | app:1.0-falcon | falcon-container (single-arch amd64)
Azure Container Instances (ACI): falcon-sensor + your app
CrowdStrike Cloud: telemetry over TLS 443
```

### How `falconutil patch-image` Works

The Falcon Container sensor image ships a utility binary called `falconutil`. When you run `falconutil patch-image`, it:

1. **Reads** your application image (the "source")
2. **Injects** the Falcon sensor binaries and libraries as additional image layers
3. **Rewrites** the entrypoint so the sensor launches first via `/opt/CrowdStrike/rootfs/bin/falcon-entrypoint`, then hands off to your original entrypoint
4. **Outputs** a new image (the "target") with the sensor embedded

At runtime the sensor runs in user space alongside your application — no kernel access needed.

### Key Parameters

| Flag                  | Purpose                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `--source-image-uri`  | The unpatched application image to read                                                           |
| `--target-image-uri`  | Where to write the patched image (`-falcon` suffix)                                               |
| `--falcon-image-uri`  | The Falcon sensor image (contains `falconutil` + sensor binaries)                                 |
| `--cid`               | Your CrowdStrike CID with checksum                                                                |
| `--cloud-service`     | Set to `ACI` so the sensor collects Azure Container Instances metadata                            |
| `--image-pull-policy` | `Always` or `IfNotPresent`                                                                        |
| `--falconctl-opts`    | Passes `falconctl` options into the sensor, e.g. `"--tags=..."` for Host Management grouping tags |

### The `-falcon` Suffix Convention

Unpatched images keep their original tag (`:1.0`). Patched images get a `-falcon` suffix (`:1.0-falcon`). Only `-falcon` images are approved for deployment to ACI.

---

## Deployment Steps

<div data-mode="guide">

### 1. Set environment variables

Create an API client in the Falcon console with **Falcon Images Download: Read** and **Sensor Download: Read** scopes, then export your values.

```bash
export FALCON_CLIENT_ID=<your_client_id>
export FALCON_CLIENT_SECRET=<your_client_secret>
export FALCON_CID=<your_cid_with_checksum>

export ACR_NAME=<YOUR_ACR_NAME>
export RESOURCE_GROUP=<YOUR_RESOURCE_GROUP>
export SUBSCRIPTION=$(az account show --query id -o tsv)
export ACR_LOGIN_SERVER=${ACR_NAME}.azurecr.io

export APP_IMAGE=<YOUR_IMAGE>
export APP_TAG=<TAG>
```

### 2. Log Docker in to ACR

Authenticates your host Docker CLI so it can copy the sensor into ACR, pull the source image, and push the patched image back.

```bash
az acr login --name $ACR_NAME
```

### 3. Copy the Falcon Container Sensor into ACR (single-arch)

Copy the sensor straight from CrowdStrike into your ACR as a **single-arch amd64** image. `--platform x86_64 --copy` flattens the multi-arch image to the one platform ACI runs, so a later pull by tag gives you a concrete amd64 image. Then read the pushed tag back from ACR.

```bash
bash <(curl -Ls https://github.com/CrowdStrike/falcon-scripts/releases/latest/download/falcon-container-sensor-pull.sh) \
  -t falcon-container --platform x86_64 --copy $ACR_LOGIN_SERVER
```

```bash
export CONTAINER_TAG=$(az acr repository show-tags -n $ACR_NAME \
  --repository falcon-container --orderby time_desc --query '[0]' -o tsv)
```

### 4. Pull the sensor and your application image locally as amd64

The `--copy` step leaves a multi-arch index aliased locally. Replace it with a concrete amd64 image so `falconutil` can patch straight from your local Docker cache — `IfNotPresent` only matches a single-arch local image; a manifest list forces it to re-resolve against the private registry and fail on auth.

```bash
docker rmi ${ACR_LOGIN_SERVER}/falcon-container:$CONTAINER_TAG 2>/dev/null
docker pull --platform linux/amd64 ${ACR_LOGIN_SERVER}/falcon-container:$CONTAINER_TAG
```

Pull your application image the same way.

```bash
docker pull --platform linux/amd64 ${ACR_LOGIN_SERVER}/${APP_IMAGE}:${APP_TAG}
```

### 5. Patch your application image

`falconutil` runs inside the sensor container and reads/writes your images through the mounted Docker socket (`/var/run/docker.sock`). Both the sensor and source images are present locally as single-arch amd64, so `--image-pull-policy IfNotPresent` patches straight from your local cache without pulling from a registry. `--falconctl-opts "--tags=..."` bakes in sensor grouping tags so you can group and filter this host in Host Management.

```bash
docker run --user 0:0 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --rm ${ACR_LOGIN_SERVER}/falcon-container:$CONTAINER_TAG \
  falconutil patch-image \
  --source-image-uri ${ACR_LOGIN_SERVER}/${APP_IMAGE}:${APP_TAG} \
  --target-image-uri ${ACR_LOGIN_SERVER}/${APP_IMAGE}:${APP_TAG}-falcon \
  --falcon-image-uri ${ACR_LOGIN_SERVER}/falcon-container:$CONTAINER_TAG \
  --cid $FALCON_CID \
  --image-pull-policy IfNotPresent \
  --platform linux/amd64 \
  --falconctl-opts "--tags=ACI-Container" \
  --cloud-service ACI
```

### 6. Push the patched image to ACR

Your host Docker CLI (already logged in at step 2) handles the push.

```bash
docker push ${ACR_LOGIN_SERVER}/${APP_IMAGE}:${APP_TAG}-falcon
```

### 7. Get ACR pull credentials

ACI needs credentials to pull from your private ACR. For the lab, use the ACR admin account (in production, use a managed identity with `AcrPull` — see Challenge 1).

```bash
az acr update -n $ACR_NAME --admin-enabled true
export ACR_USER=$(az acr credential show -n $ACR_NAME --query username -o tsv)
export ACR_PASS=$(az acr credential show -n $ACR_NAME --query 'passwords[0].value' -o tsv)
```

### 8. Deploy the patched image to ACI

Navigate to **Container instances** > **Create** > point the image at your `-falcon` tag in ACR and set the registry credentials. Or with the CLI:

<details>
<summary>CLI equivalent</summary>

```bash
az container create \
  --resource-group $RESOURCE_GROUP \
  --name falcon-aci-demo \
  --image ${ACR_LOGIN_SERVER}/${APP_IMAGE}:${APP_TAG}-falcon \
  --registry-login-server $ACR_LOGIN_SERVER \
  --registry-username $ACR_USER \
  --registry-password $ACR_PASS \
  --os-type Linux --cpu 1 --memory 1.5 \
  --ports 80 --ip-address Public \
  --environment-variables \
    CS_CLOUD_SERVICE=ACI \
    CS_AZURE_RESOURCE_GROUP=$RESOURCE_GROUP \
    CS_AZURE_CONTAINER_GROUP=falcon-aci-demo \
    CS_AZURE_SUBSCRIPTION=$SUBSCRIPTION \
    CS_CONTAINER=${APP_IMAGE}
```

</details>

### 9. Verify

Check the container logs.

```bash
az container logs --resource-group $RESOURCE_GROUP --name falcon-aci-demo
```

> You should see your app start (e.g. nginx startup lines) after the Falcon entrypoint runs.

Then in the Falcon console go to **Cloud security** > **Assets** > **Kubernetes and containers** and filter for your container — it appears within 1-2 minutes with a **Falcon container sensor** agent attached.

> **`az container exec` needs an interactive terminal.** You can open a shell (`az container exec ... --exec-command "/bin/sh"`) and run `ps -aef | grep falcon-sensor` by hand, but it can't be piped or scripted (it requires a TTY). The Falcon console is the reliable confirmation the sensor registered.

</div>

<div data-mode="lab">

## 1. Create ACR & Push a Sample Image

### Step 1: Create a Resource Group and ACR

> **What & Why:** ACI, ACR, and the sensor image all live in one resource group so you can tear the lab down cleanly. ACR holds both your application image and the Falcon sensor image.

- [ ] **Console:** Navigate to **Container registries** > **Create**
  - Resource group: `falcon-aci-lab` (create new)
  - Registry name: a globally-unique name, e.g. `falconacilab0001` (5-50 alphanumeric, no hyphens)
  - Location: `East US`
  - SKU: **Standard**
  - Click **Review + create** > **Create**

<details>
<summary>CLI equivalent</summary>

Set your variables:

```bash
export RESOURCE_GROUP=falcon-aci-lab
export LOCATION=eastus
export ACR_NAME=falconacilab0001
export ACR_LOGIN_SERVER=${ACR_NAME}.azurecr.io
export SUBSCRIPTION=$(az account show --query id -o tsv)
```

Create the resource group:

```bash
az group create --name $RESOURCE_GROUP --location $LOCATION
```

Create the ACR:

```bash
az acr create --resource-group $RESOURCE_GROUP --name $ACR_NAME \
  --sku Standard
```

</details>

### Step 2: Build and Push a Sample Application Image

> **What & Why:** This is the "unpatched" image a dev team would produce — functional but unprotected. You'll patch it next.

- [ ] Log Docker in to ACR:

```bash
az acr login --name $ACR_NAME
```

- [ ] Build a minimal nginx sample and push it as `:1.0`:

```bash
mkdir -p /tmp/aci-sample && cd /tmp/aci-sample
cat > Dockerfile <<'EOF'
FROM nginx:1.27-alpine
COPY index.html /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
EOF
echo "<h1>Falcon ACI Lab</h1>" > index.html

docker build --platform linux/amd64 -t ${ACR_LOGIN_SERVER}/aci-web:1.0 .
docker push ${ACR_LOGIN_SERVER}/aci-web:1.0
```

- [ ] **Verify in Console:** Navigate to **Container registries** > your registry > **Repositories** > confirm `aci-web` with tag `1.0`.

---

## 2. Copy the Falcon Container Sensor into ACR

### Step 1: Set CrowdStrike API Credentials

> **What & Why:** The pull script authenticates to CrowdStrike's private registry to download the sensor image, which contains both the `falconutil` binary and the runtime sensor.

- [ ] Export your credentials:

```bash
export FALCON_CLIENT_ID=<your_client_id>
export FALCON_CLIENT_SECRET=<your_client_secret>
export FALCON_CID=<your_cid_with_checksum>
```

### Step 2: Copy the Sensor into ACR (single-arch)

> **What & Why:** Copy the sensor straight from CrowdStrike into your ACR as a **single-arch amd64** image. `--platform x86_64 --copy` flattens the multi-arch image to the one platform ACI runs, so a later pull by tag gives you a concrete amd64 image. Copying directly registry-to-registry also avoids a wasteful round-trip through your local Docker.

- [ ] Copy the sensor into ACR (Docker is already logged in to ACR from Section 1):

```bash
bash <(curl -Ls https://github.com/CrowdStrike/falcon-scripts/releases/latest/download/falcon-container-sensor-pull.sh) \
  -t falcon-container --platform x86_64 --copy $ACR_LOGIN_SERVER
```

- [ ] Read the pushed tag back from ACR:

```bash
export CONTAINER_TAG=$(az acr repository show-tags -n $ACR_NAME \
  --repository falcon-container --orderby time_desc --query '[0]' -o tsv)

echo "Sensor tag in ACR: $CONTAINER_TAG"
```

- [ ] **Verify in Console:** Navigate to **Container registries** > your registry > **Repositories** > confirm `falcon-container` with the tag above.

---

## 3. Patch an Image Manually (Local Docker)

### Step 1: Run `falconutil patch-image`

> **What & Why:** Patching injects the sensor into your image and rewrites the entrypoint. `--cloud-service ACI` tells the sensor to collect Azure Container Instances metadata. `falconutil` runs inside the sensor container and reads/writes your images through the mounted Docker socket (`/var/run/docker.sock`). Both the sensor and source images are present locally as single-arch amd64, so `--image-pull-policy IfNotPresent` patches straight from your local cache without pulling from a registry.

- [ ] Refresh the local sensor image as concrete amd64. The `--copy` step in Section 2 leaves a multi-arch index aliased locally; `IfNotPresent` only matches a single-arch local image, so replace it with a pull by tag (ACR now holds single-arch):

```bash
docker rmi ${ACR_LOGIN_SERVER}/falcon-container:$CONTAINER_TAG 2>/dev/null
docker pull --platform linux/amd64 ${ACR_LOGIN_SERVER}/falcon-container:$CONTAINER_TAG
```

- [ ] Pull the source image locally as amd64:

```bash
docker pull --platform linux/amd64 ${ACR_LOGIN_SERVER}/aci-web:1.0
```

- [ ] Patch the image:

```bash
docker run --user 0:0 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --rm ${ACR_LOGIN_SERVER}/falcon-container:$CONTAINER_TAG \
  falconutil patch-image \
  --source-image-uri ${ACR_LOGIN_SERVER}/aci-web:1.0 \
  --target-image-uri ${ACR_LOGIN_SERVER}/aci-web:1.0-falcon \
  --falcon-image-uri ${ACR_LOGIN_SERVER}/falcon-container:$CONTAINER_TAG \
  --cid $FALCON_CID \
  --image-pull-policy IfNotPresent \
  --platform linux/amd64 \
  --falconctl-opts "--tags=Environment/Lab,Team/CloudSecurity" \
  --cloud-service ACI
```

> **What to look for:** Output ends with `Successfully patched image and saved to ...:1.0-falcon`.

> **Sensor grouping tags:** `--falconctl-opts "--tags=..."` bakes in comma-separated grouping tags (letters, numbers, `-`, `_`, `/` only — no spaces, commas, or `=`; 256 chars max) so you can group and filter this host in Host Management. Omit the flag if you don't need tags.

> **Sensor < 7.22:** Older sensors use a subcommand instead of the flag: `falconutil patch-image aci --source-image-uri ... --target-image-uri ... --cid ...`. Prefer 7.22+ with `--cloud-service ACI`.

### Step 2: Verify the Patched Image

> **What & Why:** Confirm the patched image is larger (sensor layers added) and the entrypoint now points at the Falcon wrapper.

```bash
docker images | grep "aci-web"

# Original vs. patched entrypoint
docker inspect ${ACR_LOGIN_SERVER}/aci-web:1.0 --format '{{.Config.Entrypoint}}'
docker inspect ${ACR_LOGIN_SERVER}/aci-web:1.0-falcon --format '{{.Config.Entrypoint}}'
```

> The patched entrypoint should reference `/opt/CrowdStrike/rootfs/bin/falcon-entrypoint`.

### Step 3: Push the Patched Image

```bash
docker push ${ACR_LOGIN_SERVER}/aci-web:1.0-falcon
```

- [ ] **Verify in Console:** **Container registries** > your registry > **aci-web** > confirm both `1.0` and `1.0-falcon` tags exist.

---

## 4. Deploy the Patched Image to ACI

### Step 1: Get ACR Pull Credentials

> **What & Why:** ACI needs credentials to pull from a private ACR. For the lab we use the ACR admin account; in production use a managed identity (Challenge 1).

```bash
az acr update -n $ACR_NAME --admin-enabled true
export ACR_USER=$(az acr credential show -n $ACR_NAME --query username -o tsv)
export ACR_PASS=$(az acr credential show -n $ACR_NAME --query 'passwords[0].value' -o tsv)
```

### Step 2: Create the Container Group

> **What & Why:** Deploy the `-falcon` image to ACI. The embedded sensor starts first via the modified entrypoint, then launches your app. The `CS_AZURE_*` env vars stamp telemetry with the correct Azure metadata.

- [ ] **Console:** Navigate to **Container instances** > **Create**
  - Resource group: `falcon-aci-lab`
  - Container name: `falcon-aci-demo`
  - Image source: **Azure Container Registry** > select `aci-web` > tag `1.0-falcon`
  - Networking: DNS name label (any unique value), port `80`
  - Advanced > Environment variables: add `CS_CLOUD_SERVICE=ACI`, `CS_AZURE_RESOURCE_GROUP`, `CS_AZURE_CONTAINER_GROUP`, `CS_AZURE_SUBSCRIPTION`, `CS_CONTAINER`
  - Click **Review + create** > **Create**

<details>
<summary>CLI equivalent</summary>

```bash
az container create \
  --resource-group $RESOURCE_GROUP \
  --name falcon-aci-demo \
  --image ${ACR_LOGIN_SERVER}/aci-web:1.0-falcon \
  --registry-login-server $ACR_LOGIN_SERVER \
  --registry-username $ACR_USER \
  --registry-password $ACR_PASS \
  --os-type Linux --cpu 1 --memory 1.5 \
  --ports 80 --ip-address Public \
  --dns-name-label falcon-aci-demo-$RANDOM \
  --environment-variables \
    CS_CLOUD_SERVICE=ACI \
    CS_AZURE_RESOURCE_GROUP=$RESOURCE_GROUP \
    CS_AZURE_CONTAINER_GROUP=falcon-aci-demo \
    CS_AZURE_SUBSCRIPTION=$SUBSCRIPTION \
    CS_CONTAINER=aci-web
```

</details>

> **Custom command note:** If you override the container command with `--command-line`, you **must** prepend the Falcon entrypoint or the sensor won't start: `--command-line "/opt/CrowdStrike/rootfs/bin/falcon-entrypoint <your command>"`.

---

## 5. Verify

### Step 1: Confirm the Container Is Running

```bash
az container show --resource-group $RESOURCE_GROUP --name falcon-aci-demo \
  --query "instanceView.state" -o tsv
```

> Expect `Running`. ACI cold start takes tens of seconds.

### Step 2: Confirm the Sensor Process (interactive)

> **What & Why:** `az container exec` opens an interactive shell inside the container — it requires a TTY, so it can't be piped or scripted (a piped `| grep` returns nothing). Open a shell and check by hand.

- [ ] Open a shell in the container:

```bash
az container exec --resource-group $RESOURCE_GROUP --name falcon-aci-demo \
  --exec-command "/bin/sh"
```

- [ ] Inside the container, confirm the sensor process and its AID:

```sh
ps -aef | grep falcon-sensor
/opt/CrowdStrike/rootfs/bin/falconctl -g --aid
```

> Expect a `/opt/CrowdStrike/rootfs/bin/falcon-sensor` process and a non-empty `aid`.

> **Can't open a shell?** ACI exec needs an interactive terminal and isn't available in every environment. Use `az container logs` plus the Falcon console (Step 3) instead — the console is the definitive confirmation the sensor registered.

### Step 3: Verify in the Falcon Console

- [ ] **Falcon Console:** Navigate to **Cloud security** > **Assets** > **Kubernetes and containers** > filter for your ACI container group, or check **Host setup and management** > **Host management** for the new host.

> The container appears within 1-2 minutes of starting.

---

## 6. Connect Back to Terraform

You've built everything by hand — now make it repeatable. Import the resources so Terraform can tear the lab down and rebuild it with one command.

### Step 1: Initialize Terraform

```bash
cd ~/projects/falcon-cloud-security-labs-workspace/serverless-containers/azure-container-instances
terraform init
```

### Step 2: Update `terraform.tfvars`

- [ ] Fill in your values:

```hcl
resource_group_name = "falcon-aci-lab"
location            = "eastus"
acr_name            = "falconacilab0001"
container_group_name = "falcon-aci-demo"
patched_image_tag   = "1.0-falcon"
```

### Step 3: Import Existing Resources

```bash
export SUB=$(az account show --query id -o tsv)

terraform import azurerm_resource_group.lab \
  /subscriptions/$SUB/resourceGroups/falcon-aci-lab

terraform import azurerm_container_registry.acr \
  /subscriptions/$SUB/resourceGroups/falcon-aci-lab/providers/Microsoft.ContainerRegistry/registries/falconacilab0001

terraform import azurerm_container_group.app \
  /subscriptions/$SUB/resourceGroups/falcon-aci-lab/providers/Microsoft.ContainerInstance/containerGroups/falcon-aci-demo
```

### Step 4: Validate with `terraform plan`

```bash
terraform plan
```

> The resource group and ACR import cleanly. The **container group** will still show a replacement, because the azurerm provider can't read the registry password or `restart_policy` back from Azure on import — this is a known provider limitation, not a config error. Run `terraform apply` once to bring the group under full management; the next `terraform plan` returns `No changes. Your infrastructure matches the configuration.`

### Step 5: Test the Lifecycle

```bash
terraform destroy
terraform apply
```

> You now have a repeatable lab. Note: `terraform apply` recreates the ACR and container group, but the patched image itself is produced by `falconutil` — keep the patch step (Section 3) in your image pipeline.

---

## 7. Cleanup

```bash
# Option 1: Terraform (if you completed Section 6)
terraform destroy

# Option 2: Manual
az container delete --resource-group $RESOURCE_GROUP --name falcon-aci-demo --yes
az acr repository delete --name $ACR_NAME --repository aci-web --yes
az acr repository delete --name $ACR_NAME --repository falcon-container --yes
az group delete --name $RESOURCE_GROUP --yes --no-wait
```

---

## 8. Challenges

### Challenge 1: Pull from ACR with a Managed Identity (No Admin Creds)

**Scenario:** Your security team forbids the ACR admin account. Deploy the ACI container group so it pulls the `-falcon` image using a **user-assigned managed identity** granted `AcrPull`, instead of `--registry-username`/`--registry-password`.

<details>
<summary>Hint</summary>

Create a user-assigned identity, grant it `AcrPull` on the ACR, then pass `--acr-identity` (and `--assign-identity`) to `az container create`. No registry username/password needed.

</details>

<details>
<summary>Solution</summary>

```bash
# Create the identity and capture its IDs
export ID_NAME=falcon-aci-puller
az identity create --resource-group $RESOURCE_GROUP --name $ID_NAME
export ID_RESOURCE_ID=$(az identity show -g $RESOURCE_GROUP -n $ID_NAME --query id -o tsv)
export ID_PRINCIPAL=$(az identity show -g $RESOURCE_GROUP -n $ID_NAME --query principalId -o tsv)
export ACR_ID=$(az acr show -n $ACR_NAME --query id -o tsv)

# Grant AcrPull to the identity
az role assignment create --assignee $ID_PRINCIPAL --role AcrPull --scope $ACR_ID

# Deploy using the identity for the pull (no admin creds)
az container create \
  --resource-group $RESOURCE_GROUP \
  --name falcon-aci-demo-mi \
  --image ${ACR_LOGIN_SERVER}/aci-web:1.0-falcon \
  --assign-identity $ID_RESOURCE_ID \
  --acr-identity $ID_RESOURCE_ID \
  --os-type Linux --cpu 1 --memory 1.5 --ports 80 --ip-address Public \
  --environment-variables CS_CLOUD_SERVICE=ACI CS_AZURE_RESOURCE_GROUP=$RESOURCE_GROUP \
    CS_AZURE_CONTAINER_GROUP=falcon-aci-demo-mi CS_AZURE_SUBSCRIPTION=$SUBSCRIPTION CS_CONTAINER=aci-web
```

Granting the identity the **Reader** role on the resource group also lets the sensor read container-group metadata for richer telemetry.

</details>

---

### Challenge 2: Patch an App That Overrides Its Command

**Scenario:** Your app is deployed with a custom `--command-line` (e.g. `python app.py --port 80`). After patching, the sensor doesn't start. Fix the deployment.

<details>
<summary>Hint</summary>

`falconutil` rewrites the image entrypoint, but `--command-line` on `az container create` overrides it. You must call the Falcon entrypoint yourself.

</details>

<details>
<summary>Solution</summary>

Prepend the Falcon entrypoint to your command so the sensor launches before your app:

```bash
az container create \
  --resource-group $RESOURCE_GROUP \
  --name falcon-aci-cmd \
  --image ${ACR_LOGIN_SERVER}/aci-web:1.0-falcon \
  --registry-login-server $ACR_LOGIN_SERVER \
  --registry-username $ACR_USER --registry-password $ACR_PASS \
  --os-type Linux --cpu 1 --memory 1.5 --ports 80 --ip-address Public \
  --command-line "/opt/CrowdStrike/rootfs/bin/falcon-entrypoint python app.py --port 80" \
  --environment-variables CS_CLOUD_SERVICE=ACI
```

</details>

---

### Challenge 3: Automate Patching in CI (Bonus)

**Scenario:** Manually patching every image release doesn't scale. Automate the patch step in a CI pipeline (Azure Pipelines or GitHub Actions) that logs in to ACR, runs `falconutil patch-image --cloud-service ACI`, and pushes the `-falcon` image.

<details>
<summary>Hint</summary>

CrowdStrike publishes `crowdstrike/falconutil-action` for GitHub Actions — pass `cloud_service: ACI`. Authenticate to Azure with OIDC (`azure/login`) and to ACR with `az acr login`. Pull the source image first (falconutil reads local Docker).

</details>

<details>
<summary>Solution</summary>

```yaml
name: Patch ACI Image with Falcon Sensor
on:
  workflow_dispatch:
    inputs:
      image_name:
        { description: "Image name in ACR", required: true, default: "aci-web" }
      image_tag: { description: "Tag to patch", required: true, default: "1.0" }

permissions:
  id-token: write
  contents: read

env:
  ACR_LOGIN_SERVER: ${{ vars.ACR_NAME }}.azurecr.io

jobs:
  patch:
    runs-on: ubuntu-latest
    steps:
      - uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}

      - name: Login to ACR
        run: az acr login --name ${{ vars.ACR_NAME }}

      - name: Pull source image
        run: docker pull ${{ env.ACR_LOGIN_SERVER }}/${{ inputs.image_name }}:${{ inputs.image_tag }}

      - name: Patch image with Falcon sensor
        uses: crowdstrike/falconutil-action@v1.1.0
        with:
          falcon_client_id: ${{ vars.FALCON_CLIENT_ID }}
          falcon_region: ${{ vars.FALCON_REGION }}
          source_image_uri: ${{ env.ACR_LOGIN_SERVER }}/${{ inputs.image_name }}:${{ inputs.image_tag }}
          target_image_uri: ${{ env.ACR_LOGIN_SERVER }}/${{ inputs.image_name }}:${{ inputs.image_tag }}-falcon
          cid: ${{ secrets.FALCON_CID }}
          cloud_service: ACI
          image_pull_policy: IfNotPresent
        env:
          FALCON_CLIENT_SECRET: ${{ secrets.FALCON_CLIENT_SECRET }}

      - name: Push patched image
        run: docker push ${{ env.ACR_LOGIN_SERVER }}/${{ inputs.image_name }}:${{ inputs.image_tag }}-falcon
```

</details>

---

## 9. Quick Reference

| Action                           | Console Path                               | CLI Command                                                                                                                                           |
| -------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create ACR                       | Container registries > Create              | `az acr create -g <rg> -n <name> --sku Standard`                                                                                                      |
| Docker login to ACR              | —                                          | `az acr login --name <acr>`                                                                                                                           |
| Copy CrowdStrike sensor into ACR | —                                          | `bash <(curl -Ls .../falcon-container-sensor-pull.sh) -t falcon-container --platform x86_64 --copy <acr-login-server>`                                |
| Patch image                      | —                                          | `docker run ... falconutil patch-image --source-image-uri <src> --target-image-uri <tgt> --falcon-image-uri <sensor> --cid <cid> --cloud-service ACI` |
| Get ACR admin creds              | Container registries > Access keys         | `az acr credential show -n <acr>`                                                                                                                     |
| Deploy to ACI                    | Container instances > Create               | `az container create -g <rg> -n <name> --image <uri> --registry-username <u> --registry-password <p>`                                                 |
| Exec into container              | Container instances > Containers > Connect | `az container exec -g <rg> -n <name> --exec-command "/bin/sh"` (interactive TTY only)                                                                 |
| Check state                      | Container instances > Overview             | `az container show -g <rg> -n <name> --query instanceView.state`                                                                                      |
| Delete container group           | Container instances > Delete               | `az container delete -g <rg> -n <name> --yes`                                                                                                         |

</div>

---

_Created: 2026-07-08 | Topics: cloud-security, falcon-sensor, azure-container-instances, aci, acr, image-patching, falconutil, serverless_

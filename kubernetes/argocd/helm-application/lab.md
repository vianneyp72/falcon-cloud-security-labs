# Falcon Platform on Argo CD — Direct Helm Chart Application

Deploy the CrowdStrike Falcon Platform (sensor, KAC, Image Analyzer) to a Kubernetes cluster with a single Argo CD `Application` that points straight at CrowdStrike's public Helm chart, with the values written inline.

> **Prerequisites:**
>
> - Argo CD installed in the `argocd` namespace <span data-tip="kubectl get pods -n argocd should show running pods.">(running)</span>
> - `kubectl` <span data-tip="Installed and pointed at the Argo CD cluster. kubectl get nodes should return nodes.">pointed at that cluster</span>
> - <span data-tip="Only needed if you copy the images to your own registry. It must be running: docker info should print server details, not an error. Start Docker Desktop if it fails.">Docker, Podman, or Skopeo</span> running (optional)
> - CrowdStrike Falcon API <span data-tip="The pull scopes let you download the images from the CrowdStrike registry. The runtime scopes let IAR upload image assessments after it is running.">credentials</span> (Client ID + Secret)
>   - Scopes to pull the images (sensor, KAC, IAR):
>     - **Sensor Download** (Read)
>     - **Falcon Images Download** (Read)
>   - Runtime scopes (IAR):
>     - **Falcon Container Image** (Read/Write)
>     - **Falcon Container CLI** (Write)
> - CrowdStrike <span data-tip="Use the full Customer ID including the checksum suffix. The credentials tip below shows where to find it.">CID</span> (with checksum)

> **Tip:** Where to find your Falcon credentials:
>
> - **CID (with checksum):** in the Falcon console, go to **Host setup and management** > **Deploy** > **Sensor downloads** and copy the **Customer ID** from the right panel. Direct link: [US-1](https://falcon.crowdstrike.com/sensor-downloads/all) | [US-2](https://falcon.us-2.crowdstrike.com/sensor-downloads/all) | [EU-1](https://falcon.eu-1.crowdstrike.com/sensor-downloads/all). On GovCloud, open the same page on your GovCloud console host.
> - **API client:** go to **Support and resources** > **Client Management** > **API Clients** > **Create API client**. Copy the client secret right away; the console shows it only once.

## Reference Docs

| Source                                  | Link                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| falcon-platform Helm chart (GitHub)     | https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-platform                     |
| Falcon Helm Chart Values Reference      | https://github.com/CrowdStrike/falcon-helm/blob/main/helm-charts/falcon-platform/values.yaml         |
| Falcon Container Image Pull Script      | https://github.com/CrowdStrike/falcon-scripts/tree/main/bash/containers/falcon-container-sensor-pull |
| Argo CD: Helm applications              | https://argo-cd.readthedocs.io/en/stable/user-guide/helm/                                            |
| Argo CD: Sync options                   | https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/                                    |
| Argo CD: Diffing customization          | https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/                                         |

---

## Core Concepts

**Argo CD** is a GitOps controller that runs in your cluster and keeps what is deployed in sync with a definition you give it. That definition is an **`Application`**: a small Kubernetes object that says "take this source (a Git repo or a Helm chart repo), render it, and apply the result to this cluster and namespace."

This lab uses the simplest form, a **direct Helm Application**. The source is CrowdStrike's public chart repo (`https://crowdstrike.github.io/falcon-helm`), and your configuration goes inline under `helm.values`, so there is no Git repo to create. One `Application` deploys all three Falcon components:

- **Falcon Sensor** (DaemonSet): kernel-level runtime protection, one pod per node, in `falcon-system`.
- **Falcon KAC** (Deployment): the Kubernetes Admission Controller, in `falcon-kac`.
- **Falcon Image Analyzer** (Deployment): scans the images running in the cluster, in `falcon-image-analyzer`.

> **Why this matters:** Argo CD does not run `helm install`. Its repo-server runs `helm template` to render the chart into plain manifests, then Argo applies them. Anything in a chart that depends on the live cluster at install time (Helm `lookup`, install-only hooks) behaves differently. Two Falcon quirks follow from this and are handled for you below: the KAC certificate drift, and creating the component namespaces up front.

```
ARGO CD — HELM CHART APPLICATION
Helm repo: crowdstrike.github.io/falcon-helm — chart falcon-platform
Argo CD (argocd namespace): Application falcon-platform — inline helm values
repo-server: helm template, then sync to the cluster
Cluster namespaces: falcon-system (sensor), falcon-kac (KAC), falcon-image-analyzer (IAR)
CrowdStrike Cloud — Telemetry
```

---

## Deployment Steps

<div data-mode="guide">

### 1. Set credentials

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,CLUSTER_NAME:Cluster name"></div>

Then copy this to export the API client secret. It is the only value kept as a shell variable, and the page never saves it:

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

### 2. Get the images

Choose where Kubernetes should pull the Falcon images from. The page below shows only the steps for your choice.

<div data-registry-picker></div>

<div data-registry="crowdstrike">

Generate the registry pull token (Kubernetes uses it to authenticate to CrowdStrike's registry):

```bash
export FALCON_PULL_TOKEN=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --get-pull-token)
echo "FALCON_PULL_TOKEN: $FALCON_PULL_TOKEN"
```

Get each component's image location and split it into registry + tag. `--get-image-path` returns the image's location in CrowdStrike's registry, so Kubernetes pulls directly from CrowdStrike at runtime:

```bash
export SENSOR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> \
  --client-secret $FALCON_CLIENT_SECRET \
  --type falcon-sensor \
  --get-image-path)
echo "SENSOR_IMAGE_PATH: $SENSOR_IMAGE_PATH"
export DAEMONSET_SENSOR_REGISTRY=$(echo $SENSOR_IMAGE_PATH | cut -d: -f1)
export DAEMONSET_SENSOR_IMAGE_TAG=$(echo $SENSOR_IMAGE_PATH | cut -d: -f2)
#@opt=kac
export KAC_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \ #@opt=kac
  --client-id <FALCON_CLIENT_ID> \ #@opt=kac
  --client-secret $FALCON_CLIENT_SECRET \ #@opt=kac
  --type falcon-kac \ #@opt=kac
  --get-image-path) #@opt=kac
echo "KAC_IMAGE_PATH: $KAC_IMAGE_PATH" #@opt=kac
export KAC_REGISTRY=$(echo $KAC_IMAGE_PATH | cut -d: -f1) #@opt=kac
export KAC_IMAGE_TAG=$(echo $KAC_IMAGE_PATH | cut -d: -f2) #@opt=kac
#@opt=iar
export IAR_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \ #@opt=iar
  --client-id <FALCON_CLIENT_ID> \ #@opt=iar
  --client-secret $FALCON_CLIENT_SECRET \ #@opt=iar
  --type falcon-imageanalyzer \ #@opt=iar
  --get-image-path) #@opt=iar
echo "IAR_IMAGE_PATH: $IAR_IMAGE_PATH" #@opt=iar
export IAR_REGISTRY=$(echo $IAR_IMAGE_PATH | cut -d: -f1) #@opt=iar
export IAR_IMAGE_TAG=$(echo $IAR_IMAGE_PATH | cut -d: -f2) #@opt=iar
```

</div>

<div data-registry="ecr">

<div data-registry="ecr-new">

Enter your AWS account and region. They build your ECR registry address (`<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com`):

<div data-fill-fields="AWS_ACCOUNT_ID:AWS account ID,AWS_REGION:AWS region" data-fill-derive="REGISTRY=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com"></div>

ECR does not create repositories on push, so create one per image (this skips any that already exist):

```bash
for repo in falcon-sensor falcon-kac falcon-imageanalyzer; do #@opt=kac #@opt=iar
for repo in falcon-sensor falcon-kac; do #@opt=kac #@opt=noiar
for repo in falcon-sensor falcon-imageanalyzer; do #@opt=nokac #@opt=iar
for repo in falcon-sensor; do #@opt=nokac #@opt=noiar
  aws ecr describe-repositories --repository-names $repo --region <AWS_REGION> >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name $repo --region <AWS_REGION>
done
```

Log Docker in to ECR (the pull script does not log in to the destination):

```bash
aws ecr get-login-password --region <AWS_REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

> **Note:** `--copy` appends the image name itself, so each image lands in the repo named after it.

</div>

<div data-registry="ecr-existing">

Enter your AWS account, region, and the name of your existing ECR repository (`<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/<ECR_REPOSITORY>`):

<div data-fill-fields="AWS_ACCOUNT_ID:AWS account ID,AWS_REGION:AWS region,ECR_REPOSITORY:ECR repository" data-fill-derive="REGISTRY=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/<ECR_REPOSITORY>"></div>

Log Docker in to the ECR registry (the pull script does not log in to the destination):

```bash
aws ecr get-login-password --region <AWS_REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

> **Note:** The repository must already exist. All the images go into it, tagged `<image>-<version>` (for example `falcon-sensor-8.11.0-19508-1`).

</div>

</div>

<div data-registry="acr">

Enter your ACR name and resource group. The registry address is `<ACR_NAME>.azurecr.io`:

<div data-fill-fields="ACR_NAME:ACR name,RESOURCE_GROUP:Resource group" data-fill-derive="REGISTRY=<ACR_NAME>.azurecr.io"></div>

Log Docker in to ACR. ACR creates each repository on first push, so there is nothing to pre-create:

```bash
az acr login --name <ACR_NAME>
```

Let the AKS cluster pull from this registry (grants its kubelet identity the `AcrPull` role):

```bash
az aks update --name <CLUSTER_NAME> --resource-group <RESOURCE_GROUP> --attach-acr <ACR_NAME>
```

> **Why this matters:** AKS has no pull access to your ACR until you attach it. If you skip this, pods stay in `ImagePullBackOff` with an `unauthorized` error.

</div>

<div data-registry="gar">

Enter your Artifact Registry location, project, and repository name. The path is `<GAR_REGION>-docker.pkg.dev/<PROJECT_ID>/<REPO_NAME>`:

<div data-fill-fields="GAR_REGION:GAR region,PROJECT_ID:GCP project ID,REPO_NAME:Repository name" data-fill-derive="REGISTRY=<GAR_REGION>-docker.pkg.dev/<PROJECT_ID>/<REPO_NAME>"></div>

Create the Docker repository (this skips it if it already exists; the name must match the last part of the path above):

```bash
gcloud artifacts repositories describe <REPO_NAME> --location=<GAR_REGION> --project=<PROJECT_ID> >/dev/null 2>&1 \
  || gcloud artifacts repositories create <REPO_NAME> --repository-format=docker --location=<GAR_REGION> --project=<PROJECT_ID>
```

> **Heads-up:** If you see `Artifact Registry API has not been used`, run `gcloud services enable artifactregistry.googleapis.com --project=<PROJECT_ID>` and retry.

Log Docker in to Artifact Registry:

```bash
gcloud auth configure-docker <GAR_REGION>-docker.pkg.dev
```

> **Why this matters:** GKE nodes pull from Artifact Registry in the same project with the node service account (the default Compute Engine account can read it), so the Application needs no registry credentials. For a registry in another project, grant that service account `roles/artifactregistry.reader` on it.

</div>

<div data-registry="generic">

Enter your registry host, repository path, and the username and password Kubernetes will pull with. The registry address is `<REGISTRY_HOST>/<REPOSITORY_PATH>`:

<div data-fill-fields="REGISTRY_HOST:Registry host,REPOSITORY_PATH:Repository path,REGISTRY_USERNAME:Registry username,REGISTRY_PASSWORD:Registry password" data-fill-derive="REGISTRY=<REGISTRY_HOST>/<REPOSITORY_PATH>"></div>

Log Docker in so the pull script can push to it:

```bash
docker login <REGISTRY_HOST>
```

Build the credentials Kubernetes will use to pull from it. This creates a base64 Docker config without touching the cluster:

```bash
export REGISTRY_CONFIG_JSON=$(kubectl create secret docker-registry regcred \
  --docker-server=<REGISTRY_HOST> \
  --docker-username=<REGISTRY_USERNAME> \
  --docker-password=<REGISTRY_PASSWORD> \
  --dry-run=client -o jsonpath='{.data.\.dockerconfigjson}')
```

> **Why this matters:** A registry outside your cloud can't use node identity, so Kubernetes needs a username and password. The chart takes them as `global.containerRegistry.configJSON` and turns them into an image pull secret in each Falcon namespace for you.

</div>

<div data-registry="own">

Copy the images into your registry:

```bash
tag_of() { curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type $1 --get-image-path | cut -d: -f2; }
for t in falcon-sensor falcon-kac falcon-imageanalyzer; do #@opt=kac #@opt=iar
for t in falcon-sensor falcon-kac; do #@opt=kac #@opt=noiar
for t in falcon-sensor falcon-imageanalyzer; do #@opt=nokac #@opt=iar
for t in falcon-sensor; do #@opt=nokac #@opt=noiar
  curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
    --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type $t --copy <REGISTRY> #@registry=per-image
    --client-id <FALCON_CLIENT_ID> --client-secret $FALCON_CLIENT_SECRET --type $t --copy <REGISTRY> --copy-omit-image-name --copy-custom-tag "$t-$(tag_of $t)" #@registry=ecr-existing
done
```

<div data-registry="per-image">

Set the registry + tag variables (the copy keeps the source tag, so `tag_of` returns what landed in your registry):

```bash
export DAEMONSET_SENSOR_REGISTRY=<REGISTRY>/falcon-sensor
export DAEMONSET_SENSOR_IMAGE_TAG=$(tag_of falcon-sensor)
#@opt=kac
export KAC_REGISTRY=<REGISTRY>/falcon-kac #@opt=kac
export KAC_IMAGE_TAG=$(tag_of falcon-kac) #@opt=kac
#@opt=iar
export IAR_REGISTRY=<REGISTRY>/falcon-imageanalyzer #@opt=iar
export IAR_IMAGE_TAG=$(tag_of falcon-imageanalyzer) #@opt=iar
```

</div>

<div data-registry="ecr-existing">

Every image is in the same repository, so each tag starts with the image name (`falcon-sensor-<version>`). Set the registry + tag variables:

```bash
export DAEMONSET_SENSOR_REGISTRY=<REGISTRY>
export DAEMONSET_SENSOR_IMAGE_TAG=falcon-sensor-$(tag_of falcon-sensor)
#@opt=kac
export KAC_REGISTRY=<REGISTRY> #@opt=kac
export KAC_IMAGE_TAG=falcon-kac-$(tag_of falcon-kac) #@opt=kac
#@opt=iar
export IAR_REGISTRY=<REGISTRY> #@opt=iar
export IAR_IMAGE_TAG=falcon-imageanalyzer-$(tag_of falcon-imageanalyzer) #@opt=iar
```

</div>

</div>

Validate the client secret and every image variable the Application needs was populated (a ✅ means set, a ❌ means missing):

```bash
echo "Client Secret  : $([ -n "$FALCON_CLIENT_SECRET" ] && echo ✅ || echo ❌)"
echo "Pull Token     : $([ -n "$FALCON_PULL_TOKEN" ] && echo ✅ || echo ❌)"  #@registry=crowdstrike
echo "Registry creds : $([ -n "$REGISTRY_CONFIG_JSON" ] && echo ✅ || echo ❌)"  #@registry=generic
echo "Sensor         : $([ -n "$DAEMONSET_SENSOR_REGISTRY" ] && echo ✅ || echo ❌) ($DAEMONSET_SENSOR_REGISTRY:$DAEMONSET_SENSOR_IMAGE_TAG)"
echo "KAC            : $([ -n "$KAC_REGISTRY" ] && echo ✅ || echo ❌) ($KAC_REGISTRY:$KAC_IMAGE_TAG)"  #@opt=kac
echo "IAR            : $([ -n "$IAR_REGISTRY" ] && echo ✅ || echo ❌) ($IAR_REGISTRY:$IAR_IMAGE_TAG)"  #@opt=iar
```

> **Verify:** Every line should show ✅. A ❌ means that variable is empty, so re-run the step that sets it before creating the Application.

### 3. Prepare the Falcon namespaces

> **Note:** Open **Additional settings** below for GovCloud, proxy, and which components (KAC, Image Analyzer) to deploy. The commands in the next steps update to match.

<div data-deploy-options></div>

Each Falcon component runs in its own namespace. Create them before Argo CD syncs, because Argo CD does not create namespaces unless told to:

```bash
for ns in falcon-system falcon-kac falcon-image-analyzer; do #@opt=kac #@opt=iar
for ns in falcon-system falcon-kac; do #@opt=kac #@opt=noiar
for ns in falcon-system falcon-image-analyzer; do #@opt=nokac #@opt=iar
for ns in falcon-system; do #@opt=nokac #@opt=noiar
  kubectl create namespace $ns --dry-run=client -o yaml | kubectl apply -f -
done
```

> **Why this matters:** The chart has a `createComponentNamespaces` option, but it works through an install-only Helm hook that Argo CD turns into a pre-sync hook and can recreate on every sync. Creating the namespaces once yourself is simpler and safe to re-run.

Choose how the Application gets your CID, API client secret, and registry pull token:

<div data-choice-picker="secrets"></div>

<div data-choice="secrets:inline">

Nothing more to do in this step. The values go straight into the Application in the next step, which is the quickest route for a lab or demo.

</div>

<div data-choice="secrets:k8s">

> **Why this matters:** Values written into the Application are stored in plain text in the `argocd` namespace, and in Git if you keep the manifest there. A Kubernetes Secret keeps them out: the Application only names the secret, and the chart reads it at runtime. A pod can only read secrets in its own namespace, so each Falcon namespace gets its own copy.

Create the CID secret for the sensor and KAC. Both read the CID from the `FALCONCTL_OPT_CID` key of a secret named `falcon-secret`:

```bash
for ns in falcon-system falcon-kac; do #@opt=kac
for ns in falcon-system; do #@opt=nokac
  kubectl create secret generic falcon-secret -n $ns \
    --from-literal=FALCONCTL_OPT_CID=<FALCON_CID> \
    --dry-run=client -o yaml | kubectl apply -f -
done
```

<div data-opt="iar">

Create the Image Analyzer secret. It reads the CID and your API client credentials from the `AGENT_*` keys of a secret with the same name:

```bash
kubectl create secret generic falcon-secret -n falcon-image-analyzer \
  --from-literal=AGENT_CID=<FALCON_CID> \
  --from-literal=AGENT_CLIENT_ID=<FALCON_CLIENT_ID> \
  --from-literal=AGENT_CLIENT_SECRET="$FALCON_CLIENT_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f -
```

</div>

<div data-registry="crowdstrike,generic">

Create the registry pull secret in each namespace. The value is already base64 (it is the Docker config from step 2), so it goes in as is:

```bash
for ns in falcon-system falcon-kac falcon-image-analyzer; do #@opt=kac #@opt=iar
for ns in falcon-system falcon-kac; do #@opt=kac #@opt=noiar
for ns in falcon-system falcon-image-analyzer; do #@opt=nokac #@opt=iar
for ns in falcon-system; do #@opt=nokac #@opt=noiar
kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: falcon-pull-secret
  namespace: $ns
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: $FALCON_PULL_TOKEN #@registry=crowdstrike
  .dockerconfigjson: $REGISTRY_CONFIG_JSON #@registry=generic
EOF
done
```

</div>

Confirm the secrets exist:

```bash
kubectl get secret -A | grep falcon-
```

> **Verify:** `falcon-secret` is listed in every Falcon namespace you created (and `falcon-pull-secret` too if you pull from CrowdStrike or your own username and password registry). If a namespace is missing, re-run step 3's namespace block first. Argo CD cannot create these for you.

</div>

### 4. Create the Argo CD Application

An Argo CD `Application` tells Argo CD to render the `falcon-platform` chart with the values below and apply the result to the `falcon-system` namespace on this cluster. First, write the manifest to a file. The `$` variables are filled in by your shell and the `<...>` values by this page, so the file ends up fully resolved and ready to paste:

> **Note:** Edit the highlighted `SENSOR_TAGS` field (the page replaces it when you click Copy) to group this sensor in the Falcon console. Use comma-separated values; letters, numbers, `-`, `_`, `/` only.

```bash
cat <<EOF > falcon-platform-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: falcon-platform
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://crowdstrike.github.io/falcon-helm
    chart: falcon-platform
    targetRevision: 1.5.1
    helm:
      values: |
        global:
          falcon: #@choice=secrets:inline
            cid: <FALCON_CID> #@choice=secrets:inline
          falconSecret: #@choice=secrets:k8s
            enabled: true #@choice=secrets:k8s
            secretName: falcon-secret #@choice=secrets:k8s
          containerRegistry: #@registry=crowdstrike #@choice=secrets:inline
            configJSON: "$FALCON_PULL_TOKEN" #@registry=crowdstrike #@choice=secrets:inline
          containerRegistry: #@registry=generic #@choice=secrets:inline
            configJSON: "$REGISTRY_CONFIG_JSON" #@registry=generic #@choice=secrets:inline
          containerRegistry: #@registry=crowdstrike,generic #@choice=secrets:k8s
            pullSecret: falcon-pull-secret #@registry=crowdstrike,generic #@choice=secrets:k8s
        falcon-sensor:
          falcon:
            tags: "<SENSOR_TAGS:argocd-daemonset>"
            aph: "<PROXY_HOST>" #@opt=proxy
            app: "<PROXY_PORT>" #@opt=proxy
          node:
            image:
              repository: $DAEMONSET_SENSOR_REGISTRY
              tag: "$DAEMONSET_SENSOR_IMAGE_TAG"
        falcon-kac:
          enabled: false #@opt=nokac
          image: #@opt=kac
            repository: $KAC_REGISTRY #@opt=kac
            tag: "$KAC_IMAGE_TAG" #@opt=kac
          falcon: #@opt=kac #@opt=proxy
            aph: "<PROXY_HOST>" #@opt=kac #@opt=proxy
            app: "<PROXY_PORT>" #@opt=kac #@opt=proxy
        falcon-image-analyzer:
          enabled: false #@opt=noiar
          deployment: #@opt=iar
            enabled: true #@opt=iar
          image: #@opt=iar
            repository: $IAR_REGISTRY #@opt=iar
            tag: "$IAR_IMAGE_TAG" #@opt=iar
          crowdstrikeConfig: #@opt=iar
            clusterName: <CLUSTER_NAME> #@opt=iar
            agentRegion: gov1 #@opt=iar #@region=gov1
            agentRegion: gov2 #@opt=iar #@region=gov2
            clientID: <FALCON_CLIENT_ID> #@opt=iar #@choice=secrets:inline
            clientSecret: "$FALCON_CLIENT_SECRET" #@opt=iar #@choice=secrets:inline
          proxyConfig: #@opt=iar #@opt=proxy
            HTTP_PROXY: http://<PROXY_HOST>:<PROXY_PORT> #@opt=iar #@opt=proxy
            HTTPS_PROXY: http://<PROXY_HOST>:<PROXY_PORT> #@opt=iar #@opt=proxy
  destination:
    server: https://kubernetes.default.svc
    namespace: falcon-system
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - RespectIgnoreDifferences=true
  ignoreDifferences: #@opt=kac
    - kind: Secret #@opt=kac
      name: falcon-kac-tls #@opt=kac
      namespace: falcon-kac #@opt=kac
      jsonPointers: #@opt=kac
        - /data #@opt=kac
    - group: admissionregistration.k8s.io #@opt=kac
      kind: ValidatingWebhookConfiguration #@opt=kac
      jqPathExpressions: #@opt=kac
        - .webhooks[]?.clientConfig.caBundle #@opt=kac
EOF
```

Now create the Application from that file. Pick how you want to do it:

<div data-choice-picker="argo"></div>

<div data-choice="argo:ui">

Print the file so you can copy it:

```bash
cat falcon-platform-app.yaml
```

1. Open the Argo CD UI, go to **Applications**, and click **+ NEW APP**.
2. In the panel that slides in, click **EDIT AS YAML** (top right of the **GENERAL** card). This swaps the form for a raw YAML editor.

<div data-argo-mock="new-app"></div>

3. Select everything in the editor, delete the template, and paste the contents of `falcon-platform-app.yaml`.
4. Click **SAVE** (top right of the editor). The form fields fill in from your YAML.
5. Click **CREATE** at the top of the panel.

<div data-argo-mock="yaml-editor"></div>

</div>

<div data-choice="argo:cli">

Log in to your Argo CD server. Use the server's hostname without `https://` (for example the load balancer address). It prompts for the password:

```bash
argocd login <ARGOCD_SERVER> --username admin --grpc-web
```

> **Tip:** If you have not changed the `admin` password, the initial one is stored in the cluster. Print it with `argocd admin initial-password -n argocd`. Add `--insecure` to the login if the server uses a self-signed certificate.

Create the Application from the file:

```bash
argocd app create -f falcon-platform-app.yaml
```

> **Verify:** The command prints `application 'falcon-platform' created`. If you see `Permission denied` or `Unauthenticated`, run the login again; the session expires.

<details>
<summary>No argocd CLI? Use kubectl</summary>

```bash
kubectl apply -f falcon-platform-app.yaml
```

</details>

</div>

> **Why this matters:** An Argo CD `Application` is itself a Kubernetes object (a custom resource in the `argocd` namespace). The UI, the `argocd` CLI, and `kubectl apply` all create that same object, so use whichever you prefer.

> **Why this matters:** The KAC chart generates a fresh TLS certificate every time it renders, and Argo CD renders without cluster lookups, so each comparison sees a "new" certificate and reports `OutOfSync` forever (with `selfHeal` it would keep re-syncing). The `ignoreDifferences` block tells Argo CD to ignore the generated Secret data and the webhook's `caBundle`, and `RespectIgnoreDifferences=true` keeps syncs from overwriting them. The certificate and the CA are still created together on first sync, so they match.

<div data-choice="secrets:inline">

> **Warning:** This puts the API client secret and the registry pull token inside the `Application` object, readable by anyone who can read Applications in the `argocd` namespace. That is fine for a lab or demo. To keep them out, switch the picker in step 3 to Kubernetes Secrets, or use an external secrets operator or Sealed Secrets.

</div>

<div data-choice="secrets:k8s">

> **Tip:** The Application above holds no credentials, only the Secret names (`falcon-secret`, `falcon-pull-secret`). Argo CD does not manage those Secrets, so they survive an app delete and sync, and you rotate a credential by updating the Secret and restarting the pods. To manage them from Git, use Sealed Secrets or an external secrets operator.

</div>

> **Heads-up:** The chart's `falcon-sensor.container.image.pullSecrets.allNamespaces` option is not supported under Argo CD, which is why this lab uses the DaemonSet sensor with `global.containerRegistry.configJSON`.

### 5. Sync and verify

Argo CD syncs automatically (`automated` is on), so after you create the Application it briefly shows `Missing` and `OutOfSync` until the first sync runs. A manual sync is only needed if you removed `automated` from the manifest, or if it stays `OutOfSync`.

<div data-choice="argo:ui">

In the Argo CD UI, the `falcon-platform` tile appears right after you create it.

<div data-argo-mock="sync"></div>

To sync by hand, click **SYNC** on the tile, then **SYNCHRONIZE** at the top of the panel that slides in. Leave the defaults.

<div data-argo-mock="sync-panel"></div>

</div>

<div data-choice="argo:cli">

To sync by hand and wait for it to finish:

```bash
argocd app sync falcon-platform --grpc-web
```

Then check the status:

```bash
argocd app get falcon-platform --grpc-web
```

> **Verify:** `Sync Status` is `Synced` and `Health Status` is `Healthy`. It shows `Progressing` while images pull, and that is normal. If it stays `OutOfSync` with KAC enabled, confirm the `ignoreDifferences` block was included. If it shows `Degraded`, read the conditions at the bottom of the output.

</div>

<div data-choice="argo:ui">

You can also check from the terminal:

```bash
kubectl get application falcon-platform -n argocd
```

> **Verify:** `SYNC STATUS` is `Synced` and `HEALTH STATUS` is `Healthy`. It shows `Progressing` while images pull, and that is normal. If it stays `OutOfSync` with KAC enabled, confirm the `ignoreDifferences` block was included. If it shows `Degraded`, run `kubectl describe application falcon-platform -n argocd` and read the conditions at the bottom.

</div>

Wait for every Falcon pod to reach `Ready`. Each namespace is checked in parallel, each prints ✅ when all its pods are Ready or ❌ if they aren't within 3 minutes:

```bash
(
for ns in falcon-system falcon-kac falcon-image-analyzer; do #@opt=kac #@opt=iar
for ns in falcon-system falcon-kac; do #@opt=kac #@opt=noiar
for ns in falcon-system falcon-image-analyzer; do #@opt=nokac #@opt=iar
for ns in falcon-system; do #@opt=nokac #@opt=noiar
  (kubectl wait --for=condition=Ready pods --all -n $ns --timeout=180s >/dev/null 2>&1 \
    && echo "✅ $ns: Ready" \
    || echo "❌ $ns: not Ready (run: kubectl get pods -n $ns)") &
done
wait
)
```

> **Heads-up:** The first sensor image pull is ~500 MB per node, so it is normally the slowest part. If you see ❌ right away, the pods may not have been created yet; wait a few seconds and re-run. If a pod shows `ImagePullBackOff` in `kubectl get pods`, the image pull is failing (registry address, tag, or credentials), so don't wait out the timeout.

Then confirm what's running:

```bash
kubectl get pods -A | grep falcon
kubectl get ds -n falcon-system
```

> **Verify:** Every Falcon pod shows `STATUS` `Running` with `READY` at full (for example `1/1`). The DaemonSet shows `DESIRED` = `CURRENT` = `READY` = the number of nodes in your cluster. In the Argo CD UI, the `falcon-platform` tile is green with a tree of the sensor, KAC, and Image Analyzer resources.

> **Note:** If your nodes have taints (common on dedicated or GPU node pools), the sensor DaemonSet will skip them unless you add tolerations via `falcon-sensor.node.daemonset.tolerations` in the Application's values.

### 6. Test a detection (optional)

Deploy the CrowdStrike vulnapp, trigger a simulated attack from its web UI, and confirm the detection lands in the Falcon console.

```bash
kubectl apply -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

Once the pod is running, port-forward to it (this blocks, so leave it running):

```bash
kubectl port-forward svc/vulnerable-example-com 8060:80
```

Open [http://localhost:8060](http://localhost:8060) in your browser and click any attack simulation (for example **Access sensitive files**, **Kill process**) to generate activity the node sensor will detect.

Check **Falcon Console** > **Next-Gen SIEM** > **Monitor and investigate** > **Detections**, then filter **Source product** = **Cloud**. A new detection should appear within a few minutes. Then stop the port-forward (Ctrl+C) and remove the app:

```bash
kubectl delete -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml
```

### 7. Clean up (optional)

Removes everything this guide deployed. Your cluster and Argo CD are not touched.

Remove the vulnapp if it's still running (safe to run if you already deleted it):

```bash
kubectl delete -f https://raw.githubusercontent.com/crowdstrike/vulnapp/main/vulnerable.example.yaml --ignore-not-found
```

Delete the Application. Because it carries the `resources-finalizer` finalizer, Argo CD also deletes the sensor, KAC, and Image Analyzer it created:

```bash
kubectl delete application falcon-platform -n argocd
```

Delete the namespaces you created:

```bash
kubectl delete ns falcon-system falcon-kac falcon-image-analyzer --ignore-not-found
```

Confirm nothing is left:

```bash
kubectl get pods -A | grep falcon
kubectl get application -n argocd | grep falcon
```

> **Verify:** Both commands should print nothing. A pod still listed as `Terminating` is fine; it disappears within a minute.

> **Note:** The host entries stay in the Falcon console for a while after the sensors are gone. If you copied images into your own registry, those images are not removed by this step.

</div>

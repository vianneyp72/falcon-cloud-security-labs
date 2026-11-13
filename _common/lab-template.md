<!--
TEMPLATE: copy to <compute>/<method>/lab.md, then search for "TODO" and "AUTHOR:" and delete every
AUTHOR comment before shipping. Modeled on kubernetes/helm-daemonset/k8s-standard/lab.md.
Feature reference (what every marker does, gate values, gotchas): _common/lab-authoring-features.md
Optional blocks are marked OPTIONAL: delete the ones your method does not need.
-->

# TODO Title — What This Deploys

TODO One-line description: what gets deployed, to what compute type, pulling from where.

<!-- AUTHOR: One Prerequisites blockquote. Nested bullets for API scopes (never comma-separated).
     Split scopes by purpose ("to pull the images" vs "needed at runtime") when they differ.
     No time estimates. Split Quick Deploy vs Full Lab prerequisites when they differ. -->
> **Prerequisites:**
>
> - TODO Tool and version (`tool version` prints a version). Say "X or later", not "X.y only", so newer majors are not turned away
> - TODO CLI the steps call (`kubectl`, `aws`, ...) installed and configured. Mark a tool optional if a console or alternate route exists
> - TODO Docker, Podman, or Skopeo installed **and running**, only if the lab copies images to the reader's registry (`docker info` should print server details, not an error. Start Docker Desktop if it fails)
> - CrowdStrike Falcon API credentials (Client ID + Secret)
>   - Required scopes:
>     - **Sensor Download** (Read)
>     - **Falcon Images Download** (Read)
> - CrowdStrike CID (with checksum)
> - **Quick Deploy path:** an existing TODO compute target with TODO CLI configured (`TODO check command` works)
> - **Full Lab path:** TODO cloud CLI for your provider; Section 1 Step 1 covers install and auth

## Reference Docs

| Source | Link |
| ------ | ---- |
| TODO Official CrowdStrike doc | TODO url |
| TODO GitHub chart / script | TODO url |
| TODO Cloud provider doc | TODO url |

---

## Core Concepts

<!-- AUTHOR: Shared by both modes. Explain each component in one bullet (what it is, where it runs,
     which namespace/resource). Teach the cloud primitive here only if it is needed before step 1;
     otherwise teach it inline at the step where it first bites. -->

TODO One sentence: what the deployment installs and the components it is made of.

- **TODO Component A** (workload type) — what it does, where it runs.
- **TODO Component B** (workload type) — what it does, where it runs.

TODO One sentence on where images come from (CrowdStrike registry vs your own registry).

<!-- AUTHOR: The ASCII block is only a trigger. The rendered diagram comes from a named builder in
     webapp/src/components/FlowDiagram.jsx. Copy the closest canonical builder (see
     _common/lab-authoring-features.md, "Diagrams"), then add a text.includes() detection with
     unique keywords from this block. Delete this block if the lab has fewer than 3 components. -->
```
TODO TITLE — ARCHITECTURE
Unique keyword line 1 | Unique keyword line 2
Component A — role
Component B — role
Image Registry — images
CrowdStrike Cloud — Telemetry
```

---

## Deployment Steps

<!-- AUTHOR: The ModeToggle is injected automatically above any H2 whose text matches
     /deployment steps/i. Keep this heading text exactly. -->

<div data-mode="guide">

<!-- AUTHOR: QUICK DEPLOY. Fastest path to a working deploy on the customer's EXISTING target.
     - As few H3 steps as the method needs (more than 5 is fine when warranted).
     - Numbered "### N. Title" (no "Step").
     - Customer-supplied values are <PLACEHOLDERS> (never concrete demo names).
     - CLI-only is fine here. No checkboxes, no "What & Why", no time markers.
     - One command block = one step. Give each block its own intro line.
     - It must CREATE anything it later depends on (profiles, namespaces); do not assume them. -->

<!-- AUTHOR: VARIABLE METHODOLOGY. Values the reader types (CID, client ID, cluster name, account,
     region, registry host) are shared <PLACEHOLDERS> entered ONCE in a data-fill-fields panel and
     written inline in every command. Never `export` them. Only two things get `export`:
       1. Secrets (FALCON_CLIENT_SECRET): list the secret in the SAME panel as a field so the reader
          cannot miss it (secret names render as password inputs and are never saved), then give it
          one `export` block below the panel because the shell still needs the value.
       2. Runtime-discovered values (image tags, image paths, pull tokens): the page cannot know
          them in advance.
     Registry addresses built from pieces use data-fill-derive (see step 2). -->

### 1. Set credentials

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret,CLUSTER_NAME:Cluster name"></div>

Then copy this to export the API client secret. It is the only value kept as a shell variable, and the page never saves it:

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

### 2. Get the images

<!-- OPTIONAL: registry picker. Delete this whole step body (and the data-registry blocks in the
     deploy step) if the method has a single fixed image source. -->

Choose where the target should pull the Falcon images from. The page below shows only the steps for your choice.

<div data-registry-picker></div>

<div data-registry="crowdstrike">

Generate the registry pull token (the target uses it to authenticate to CrowdStrike's registry):

```bash
export FALCON_PULL_TOKEN=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> \
  --client-secret $FALCON_CLIENT_SECRET \
  --type TODO-image-type \
  --get-pull-token)
echo "FALCON_PULL_TOKEN: $FALCON_PULL_TOKEN"
```

Get each component's image location and split it into registry + tag:

```bash
export COMPONENT_A_IMAGE_PATH=$(curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/refs/heads/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh | bash -s -- \
  --client-id <FALCON_CLIENT_ID> \
  --client-secret $FALCON_CLIENT_SECRET \
  --type TODO-image-type \
  --get-image-path)
echo "COMPONENT_A_IMAGE_PATH: $COMPONENT_A_IMAGE_PATH"
export COMPONENT_A_REGISTRY=$(echo $COMPONENT_A_IMAGE_PATH | cut -d: -f1)
export COMPONENT_A_IMAGE_TAG=$(echo $COMPONENT_A_IMAGE_PATH | cut -d: -f2)
```

</div>

<div data-registry="ecr">

<!-- AUTHOR: A registry address built from pieces is derived, not exported:
     <div data-fill-fields="AWS_ACCOUNT_ID:AWS account ID,AWS_REGION:AWS region"
          data-fill-derive="REGISTRY=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com"></div>
     Then write <REGISTRY> (or the pieces) inline in later commands. -->

<!-- AUTHOR: Copy the ecr-new / ecr-existing / acr / gar / generic / own blocks from
     kubernetes/helm-daemonset/k8s-standard/lab.md (guide step 2) and adapt image names.
     Keep the gate names exactly: crowdstrike | own | ecr | acr | gar | generic | ecr-new |
     ecr-existing | per-image. -->

TODO ECR steps

</div>

Validate every variable the deploy needs was populated (a ✅ means set, a ❌ means missing):

```bash
echo "Client Secret  : $([ -n "$FALCON_CLIENT_SECRET" ] && echo ✅ || echo ❌)"
echo "Pull Token     : $([ -n "$FALCON_PULL_TOKEN" ] && echo ✅ || echo ❌)"  #@registry=crowdstrike
echo "Component A    : $([ -n "$COMPONENT_A_REGISTRY" ] && echo ✅ || echo ❌) ($COMPONENT_A_REGISTRY:$COMPONENT_A_IMAGE_TAG)"
```

### 3. TODO Prepare the deploy tool

```bash
TODO command
```

### 4. Deploy

<!-- OPTIONAL: deploy options (GovCloud, proxy, optional components). Delete the picker and every
     #@opt / #@region marker if the method has none of these. To hide a whole component's step
     (intro line + code block) when it is unchecked, wrap it in <div data-opt="kac"> ... </div>. -->

> **Note:** Open **Additional settings** below for GovCloud, proxy, and which components to deploy. The commands update to match.

<div data-deploy-options></div>

<div data-registry="crowdstrike">

Install, passing the pull token so the target can pull from CrowdStrike's registry:

> **Note:** Edit the highlighted `SENSOR_TAGS` field (the page replaces it when you click Copy) to group this sensor in the Falcon console. Use comma-separated values; letters, numbers, `-`, `_`, `/` only.

```bash
TODO deploy command \
  --set falcon.tags="<SENSOR_TAGS:TODO-default-tag>" \
  --set falcon.cid=<FALCON_CID> \
  --set image.repository=$COMPONENT_A_REGISTRY \
  --set image.tag=$COMPONENT_A_IMAGE_TAG \
  --set falcon.aph=<PROXY_HOST> \ #@opt=proxy
  --set falcon.app=<PROXY_PORT> \ #@opt=proxy
  --set optionalComponent.enabled=false \ #@opt=nokac
  --set optionalComponent.cloud=gov1 \ #@opt=kac #@region=gov1
  --set TODO.lastFlag=true
```

</div>

<div data-registry="ecr,acr,gar">

Install. No registry credentials are passed because the target pulls from your registry with its own cloud identity:

```bash
TODO deploy command without the pull token
```

</div>

### 5. Verify deployment

Wait for every pod to reach `Ready`. Each namespace is checked in parallel and prints ✅ when ready or ❌ if not within 3 minutes:

```bash
(
for ns in TODO-ns-a TODO-ns-b; do
  (kubectl wait --for=condition=Ready pods --all -n $ns --timeout=180s >/dev/null 2>&1 \
    && echo "✅ $ns: Ready" \
    || echo "❌ $ns: not Ready (run: kubectl get pods -n $ns)") &
done
wait
)
```

> **Heads-up:** TODO the one slow or common-failure thing for this method (large first image pull, `ImagePullBackOff` means a registry/tag/credential problem).

Then confirm what's running:

```bash
TODO get command
```

TODO Annotate the output: which column, which value means healthy.

### 6. Test a detection (optional)

TODO Deploy a test workload, trigger activity, and confirm the detection in **Falcon Console** > **Next-Gen SIEM** > **Monitor and investigate** > **Detections** (filter **Source product** = **Cloud**).

### 7. Clean up (optional)

Removes everything this guide deployed. Your TODO target itself is not touched.

```bash
TODO uninstall command
```

> **Verify:** TODO command(s) should print nothing.

> **Note:** Host entries stay in the Falcon console for a while after the sensors are gone. Images copied into your own registry are not removed by this step.

</div>

<div data-mode="lab">

<!-- AUTHOR: FULL LAB. Sections restart at "## 1". Every hands-on action is a "- [ ]" checkbox.
     - "> **What & Why:**" under each H2 and H3 (purpose of the step).
     - "> **Why this matters:**" / "> **Tip:**" where a cloud primitive first bites (IAM role,
       security group, node pool...). Explain it briefly the first time it appears.
     - Console-first, then CLI in <details><summary>CLI equivalent</summary>.
     - Use {{CLUSTER_NAME}} / {{REGION}} directly. Do NOT re-export them as shell variables.
     - Annotate every output: tell them what "good" looks like.
     - One command block = one step. -->

## 1. Provision a Test Target

> **What & Why:** TODO Why this lab needs its own target, and that any provider works.

### Step 1: Install and authenticate your cloud CLI

> **What & Why:** Fresh accounts often hit "command not found" or "API not enabled" on the first provision command. Install and log in first.

<!-- AUTHOR: Lab Variables panel. Needs a `variables` entry in webapp/src/content/manifest.js for
     this lab (see _common/lab-authoring-features.md). Remove the panel and the data-cloud
     blocks if the lab targets a single provider. -->
<div data-lab-variables></div>

<div data-cloud="gke">

**GKE:** [Install `gcloud`](https://cloud.google.com/sdk/docs/install), then:

```bash
gcloud auth login
gcloud projects list                                  # find your project ID
gcloud config set project <YOUR_GCP_PROJECT_ID>
```

</div>

<div data-cloud="eks">

**EKS:** [Install `aws` CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), then:

```bash
aws configure   # or: aws sso login
aws sts get-caller-identity   # confirm you're the expected principal
```

</div>

<div data-cloud="aks">

**AKS:** [Install `az` CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), then:

```bash
az login
az account set --subscription <YOUR_AZURE_SUBSCRIPTION_ID>
```

</div>

### Step 2: Create the target

TODO Note how long provisioning takes and not to Ctrl+C.

<div data-cloud="gke">

**GKE:** *(expect a few minutes)*

- [ ] **Console:** Navigate to **TODO Service** → **TODO Resource** → **Create** → set name `{{CLUSTER_NAME}}`, zone `{{REGION}}` → **Create**

> **Why this matters:** TODO the cloud concept this step exposes, in one or two sentences.

<details>
<summary>CLI equivalent</summary>

```bash
gcloud TODO create {{CLUSTER_NAME}} \
  --zone {{REGION}}
```

</details>

</div>

<div data-cloud="eks">

**EKS:** TODO same pattern.

</div>

<div data-cloud="aks">

**AKS:** TODO same pattern.

</div>

### Step 3: Verify connectivity

- [ ] Confirm the CLI points at the new target (the output should contain `{{CLUSTER_NAME}}`):

```bash
TODO context command
```

- [ ] List the nodes:

```bash
TODO list command
```

You should see TODO N items in `Ready` state:

```
TODO sample output
```

---

## 2. Configure API Credentials

> **What & Why:** TODO Why the API client is needed (pull token + image paths for your CID's cloud region).

### Step 1: Create an API client

- [ ] Navigate to **Falcon Console** > **Support and resources** > **API clients and keys** > **Create API client**
- [ ] Set the following OAuth 2.0 scopes:
  - TODO Scope: **Read**

<details>
<summary>CLI equivalent</summary>

There is no CLI for creating API clients; this must be done in the console.

</details>

### Step 2: Export credentials

- [ ] Enter your values:

<div data-fill-fields="FALCON_CID:CID (with checksum),FALCON_CLIENT_ID:API client ID,FALCON_CLIENT_SECRET:API client secret"></div>

- [ ] Export the API client secret (the only value kept as a shell variable):

```bash
export FALCON_CLIENT_SECRET="<FALCON_CLIENT_SECRET>"
```

---

## 3. Get Pull Token and Image Paths

> **What & Why:** TODO

### Step 1: Generate pull token

- [ ] Run the CrowdStrike pull script with `--get-pull-token`:

```bash
TODO command
```

### Step 2: Get image paths

- [ ] TODO Get each component's image path (one block per component):

```bash
TODO command
echo "COMPONENT_A_IMAGE_PATH: $COMPONENT_A_IMAGE_PATH"
```

<details>
<summary><strong>Example — copy the images to your own registry</strong></summary>

TODO Prereqs, per-cloud `--copy` examples in `data-cloud` blocks, and a `> **Why this matters:**` on dropping the pull token.

</details>

### Step 3: Validate the saved variables

- [ ] Confirm every variable is set (a ✅ means set, a ❌ means missing):

```bash
TODO echo block, same ✅/❌ pattern as Quick Deploy
```

---

## 4. TODO Prepare the Deploy Tool

> **What & Why:** TODO

- [ ] TODO

```bash
TODO command
```

---

## 5. Deploy

> **What & Why:** TODO

### Step 1: Install

- [ ] TODO

```bash
TODO deploy command using {{CLUSTER_NAME}}
```

### Step 2: Wait for pods to be Ready

- [ ] TODO

```bash
TODO wait command
```

---

## 6. Verify Deployment

> **What & Why:** Confirm everything is running in-cluster, then confirm the sensors registered with CrowdStrike.

### Step 1: Confirm all pods are Running

- [ ] TODO

```bash
TODO get command
```

TODO Annotate the output.

### Step 2: Verify in Falcon console

- [ ] Navigate to **Falcon Console** > **Host setup and management** > **Host management**
- [ ] Filter by **Grouping Tags** with the tag you set at deploy time
- [ ] Your hosts should appear within a few minutes

### Step 3: Troubleshooting

| Symptom | Likely cause | Check |
|---------|--------------|-------|
| `ImagePullBackOff` | Pull token expired, missing scope, or wrong region | `TODO describe command`; look at `Events` |
| `CrashLoopBackOff` | TODO | `TODO logs command` |
| Running but no host in console | Egress to Falcon cloud blocked, or still registering | TODO |

---

## 7. Test a Detection (Optional)

> **What & Why:** Hosts registering proves connectivity; a detection proves the sensor is actively monitoring workloads.

### Step 1: TODO Deploy the test workload

- [ ] TODO

```bash
TODO command
```

### Step 2: Trigger and confirm

- [ ] TODO Trigger activity
- [ ] In the Falcon console, go to **Next-Gen SIEM** > **Monitor and investigate** > **Detections**, then filter **Source product** = **Cloud**

---

## 8. Cleanup

> **Destructive:** TODO what this deletes. Run it only when you are finished.

### Step 1: Uninstall the deployment

- [ ] TODO

```bash
TODO uninstall command
```

### Step 2: Delete the test target

<div data-cloud="gke">

```bash
gcloud TODO delete {{CLUSTER_NAME}} --zone {{REGION}} --quiet
```

</div>

<div data-cloud="eks">

```bash
TODO delete command
```

</div>

<div data-cloud="aks">

```bash
TODO delete command
```

</div>

---

## 9. Challenges

### Challenge 1: TODO Guided

**Scenario:** TODO

<details>
<summary>Hint</summary>

TODO

</details>

<details>
<summary>Solution</summary>

TODO

</details>

### Challenge 2: TODO Open-ended

**Scenario:** TODO

<details>
<summary>Solution</summary>

TODO

</details>

---

## Quick Reference

| Action | Console Path | CLI Command |
|--------|-------------|-------------|
| TODO | **TODO** → **TODO** | `TODO` |

</div>

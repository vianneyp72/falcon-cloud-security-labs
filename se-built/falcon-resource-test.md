# Falcon Resource Test — Measure Falcon's CPU and Memory in a Cluster

A read-only, in-cluster tool that shows live CPU, memory, and health for every Falcon component in a Kubernetes cluster, and produces an exportable report a platform team can sign off on. Install it, validate that Falcon isn't too heavy, then remove it.

> **Note:** SE-built, not an official CrowdStrike product.

> **Prerequisites:**
>
> - Kubernetes 1.25 or later <span data-tip="EKS, GKE, AKS, OpenShift, or self-managed. kubectl version should show a server version of 1.25 or newer.">cluster</span>
> - Falcon <span data-tip="DaemonSet Sensor, KAC, IAR, or the sidecar injector, installed with Helm or the Falcon Operator. Without Falcon the tool still runs and shows that nothing was found.">already deployed</span>
> - `kubectl`, `git`, and Helm 3.8+ <span data-tip="Helm 3.8 is the first release that installs charts from OCI registries. Run helm version to check.">installed</span>
> - metrics-server <span data-tip="Provides live pod CPU and memory, the same data as kubectl top. GKE ships it by default. EKS and some AKS clusters do not; the tool detects this and prints the install command.">running in the cluster</span>
> - Permission to <span data-tip="The chart creates a ClusterRole and ClusterRoleBinding, which needs cluster-admin or an equivalent role. The tool itself only ever reads.">create RBAC objects</span>

## Reference Docs

| Source | Link |
|--------|------|
| Tool source, chart, and image | https://github.com/vianneyp72/falcon-resource-test |
| Kubernetes metrics-server | https://github.com/kubernetes-sigs/metrics-server |

## Core Concepts

Falcon Resource Test runs as one small pod (10m CPU and 32Mi memory requested) in its own namespace. It finds the Falcon workloads in the cluster, samples their usage every 15 seconds, and keeps up to 24 hours of history on the pod's disk.

- **Live** shows current usage per Falcon component and per node, a stacked history chart, and health checks such as restarts and how much of their requests the components actually use.
- **Assessments** are either a timed scan (15m, 30m, or 1h) or an instant report over history the tool already collected. Each produces averages, p95, and peaks, and exports as one self-contained HTML file.
- **Setup** checks every permission the tool uses and whether metrics-server answers.

> **Why this matters:** Kubernetes schedules a pod by what it *requests*, not only what it uses. Requests decide how many workloads fit on a node; usage shows the real cost. The report shows both for every Falcon component, which is what a platform team will ask about.

The tool is **read-only**. Kubernetes controls access with RBAC: a **ClusterRole** is a cluster-wide list of what an identity may do, and a ClusterRoleBinding attaches it to the pod's service account. This chart's ClusterRole only lets the tool list pods, nodes, events, DaemonSets, Deployments, webhooks, and metrics. It cannot read Secrets, exec into pods, or change anything. History lives on an `emptyDir` volume (disk that exists only as long as the pod does), so it is lost when the pod restarts or is removed.

---

## Deployment Steps

<div data-mode="guide">

### 1. Install and open the UI

<div data-fill-fields="CLUSTER_NAME:Cluster display name"></div>

Get the source:

```bash
git clone https://github.com/vianneyp72/falcon-resource-test.git
cd falcon-resource-test
```

Install the chart, wait for the pod, and open a port-forward to the UI:

```bash
./scripts/assess.sh --set clusterName=<CLUSTER_NAME>
```

> **Verify:** The script prints `falcon-resource-test is running at http://localhost:8080` and opens that address on the **Live** page. Keep the terminal open; closing it stops the port-forward, not the tool.

<details><summary>Plain Helm equivalent (no clone needed)</summary>

Install the chart straight from the registry:

```bash
helm upgrade --install falcon-resource-test oci://ghcr.io/vianneyp72/charts/falcon-resource-test \
  --namespace falcon-resource-test --create-namespace --wait \
  --set clusterName=<CLUSTER_NAME>
```

Open the UI at `http://localhost:8080`:

```bash
kubectl -n falcon-resource-test port-forward svc/falcon-resource-test 8080:80
```

</details>

> **Heads-up:**
>
> - A metrics banner on **Live** means the cluster has no metrics API. Open **Setup** for the install command, run it, and numbers appear within a minute.
> - If the port-forward fails with `address already in use`, rerun with another port: `LOCAL_PORT=8081 ./scripts/assess.sh --set clusterName=<CLUSTER_NAME>`.
> - If the pod shows `ImagePullBackOff`, the cluster can't reach `ghcr.io`. Use the private registry path in Full Lab section 5.

### 2. Run an assessment

On **Live**, click **Run assessment**. Under **Watch from now**, keep **30m** selected (or pick **15m** or **1h**) and click **Start 30m scan**.

> **Tip:** If the tool has been running a while, use **Or report on data already collected**, pick a **Last** window, and click **Build report** for an instant report.

### 3. Export the report

When the scan finishes, click **Export HTML**. The file has no external links or scripts, so it can be emailed or attached to a change ticket.

> **Look for:** The headline ("Over 30 minutes on 3 nodes, Falcon used ... of cluster CPU and ... of memory, with ... restarts ...") and the checks list. Anything marked **Fail** or **Review** is what to discuss with the customer.

### 4. Clean up

Remove the release and everything it created:

```bash
helm -n falcon-resource-test uninstall falcon-resource-test
```

Delete the now-empty namespace:

```bash
kubectl delete namespace falcon-resource-test
```

> **Verify:** `kubectl get clusterrole falcon-resource-test` prints `Error from server (NotFound)`. Nothing else is left behind.

</div>

<div data-mode="lab">

## 1. Install Falcon Resource Test

> **What & Why:** You install one Deployment, one Service, and read-only RBAC into their own namespace. A separate namespace keeps the tool easy to find and to remove completely.

### Step 1: Confirm cluster access and metrics

- [ ] Confirm `kubectl` points at the cluster you mean to measure:

```bash
kubectl config current-context
```

> **Heads-up:** If this prints the wrong cluster, switch first. On EKS run `aws eks update-kubeconfig --name <CLUSTER_NAME> --region <REGION>`, on GKE `gcloud container clusters get-credentials <CLUSTER_NAME> --region <REGION>`, and on AKS `az aks get-credentials -g <RESOURCE_GROUP> -n <CLUSTER_NAME>`.

- [ ] Check that the metrics API answers (the tool needs it for live usage):

```bash
kubectl top nodes
```

> **Verify:** One row per node with `CPU(cores)` and `MEMORY(bytes)`. If you see `Metrics API not available`, install metrics-server:
>
> `kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml`

> **Why this matters:** metrics-server is the cluster add-on that reports live pod and node usage. GKE ships it by default; EKS and many AKS clusters do not. On EKS you can enable it as a managed add-on instead.

### Step 2: Install the chart

<div data-fill-fields="CLUSTER_NAME:Cluster display name"></div>

- [ ] Clone the repo, which holds the chart and the installer script:

```bash
git clone https://github.com/vianneyp72/falcon-resource-test.git
cd falcon-resource-test
```

- [ ] Run the installer, which installs the chart, waits for the pod, and opens a port-forward to the UI:

```bash
./scripts/assess.sh --set clusterName=<CLUSTER_NAME>
```

> **Verify:** Helm prints `STATUS: deployed`, then the script prints `falcon-resource-test is running at http://localhost:8080`. Leave this terminal open and use a second one for the commands below.

- [ ] In a second terminal, check the pod:

```bash
kubectl -n falcon-resource-test get pods
```

> **Verify:** One pod, `READY` `1/1`, `STATUS` `Running`.

> **Tip:** The pod meets the Kubernetes **restricted** Pod Security Standard, the strictest built-in profile for pod settings: non-root, read-only root filesystem, no added capabilities. Clusters that enforce it accept the pod without exceptions.

> **Why this matters:** A port-forward tunnels one local port to the Service through the Kubernetes API, using your own kubectl credentials. Nothing is exposed outside the cluster, which is why the Service is `ClusterIP` and the Ingress is off by default. The UI has no login of its own, so the chart also adds a **NetworkPolicy** (a firewall rule for pods) that allows only the UI port in and only DNS and the Kubernetes API out.

### Step 3: Troubleshooting

| Symptom | Likely cause | Check |
|---------|--------------|-------|
| `ImagePullBackOff` | Cluster can't reach `ghcr.io` | `kubectl -n falcon-resource-test describe pod`; look at `Events`. Use section 5 for a private registry |
| `address already in use` | Port 8080 is taken locally | Rerun with `LOCAL_PORT=8081 ./scripts/assess.sh --set clusterName=<CLUSTER_NAME>` |
| **Live** shows a metrics banner | No metrics-server | `kubectl top nodes`; install metrics-server (Step 1) |
| Browser shows `403` | Opened through a hostname the tool doesn't allow | Use `http://localhost:8080`, or add the name to `allowedHosts` |
| Pod `Pending` or `Forbidden` on install | Missing RBAC rights or a blocking admission policy | `kubectl auth can-i create clusterrole`; `kubectl -n falcon-resource-test describe pod` |

## 2. Read the Live Page

> **What & Why:** Live answers "what is Falcon costing this cluster right now?" Walk through it with the customer before you start a scan.

- [ ] Open **Setup** and click **Check again**.

> **Verify:** **Kubernetes Metrics API**, **Read-only permissions**, and **Falcon components discovered** pass, and every row in the **Permissions** table says `granted`. The **Used for** column of a `denied` row says which feature is affected.

- [ ] Back on **Live**, read the top row of tiles.

> **Look for:**
>
> - **Falcon CPU** and **Falcon memory**: total usage and its share of cluster allocatable.
> - **DaemonSet Sensor pods**: ready out of desired. It should match the node count.
> - **Restarts (24h)**: should be 0. It only counts from when this tool started, so 0 on a fresh install is not proof of a clean history.

- [ ] Read the **Components** table. Click a row to filter the chart to that component, or click a node under **Nodes, highest Falcon share first** to see one node.

> **Why this matters:** **Request / pod** is what the scheduler sets aside for each pod whether or not it uses it; **CPU** and **Memory** are what Falcon actually consumes. A large gap is capacity the customer can reclaim by lowering requests.

- [ ] Read **Production readiness checks (last hour)**.

> **Note:** **Not measured** means the data isn't available from the cluster (for example, coverage on a cluster with no DaemonSet Sensor). It does not mean something is wrong.

## 3. Run an Assessment and Read the Report

> **What & Why:** Live is a snapshot. An assessment gives averages, p95, and peaks over a window, frozen into a report the customer can keep.

- [ ] Click **Run assessment**. Under **Watch from now**, keep **30m** selected, or pick **15m** for a short call or **1h** to cover a load test, then click **Start 30m scan**.

> **Tip:** Ask the customer to run their normal or peak workload during the window. Falcon's CPU tracks process and network activity, so an idle cluster understates it.

- [ ] Leave the page open or come back later. Closing the tab doesn't stop the scan; it is listed on the **Assessments** page and the report appears there when it ends.

> **Heads-up:** History lives on an emptyDir and is lost if the pod restarts. A scan that was running at that moment shows **interrupted**; start a new one.

- [ ] When the scan ends, read the report top to bottom.

> **Look for:**
>
> - **Headline**: one sentence with Falcon's share of cluster CPU and memory, restarts, and node coverage.
> - **Components**: average, p95, and peak per component, next to requests and limits.
> - **Checks**: each one is **Pass**, **Review**, or **Fail**, with the reason.
> - **Methodology**: the sampling interval and window, so a reviewer can trust the numbers.

- [ ] Click **Export HTML** and share the file.

> **Note:** The export is one HTML file with inline charts, no scripts, and no external links. It opens offline and is safe to attach to a change ticket.

## 4. Install with GitOps (Argo CD or Flux)

> **What & Why:** Platform teams rarely run `helm install` by hand. They commit an Argo CD or Flux object and let the controller install the chart. Hand them the snippet that matches their tool.

- [ ] **Argo CD:** commit this `Application`, which tells Argo CD to install the chart into its own namespace and keep it in sync:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: falcon-resource-test
  namespace: argocd
spec:
  project: default
  source:
    repoURL: ghcr.io/vianneyp72/charts
    chart: falcon-resource-test
    targetRevision: 0.1.0
    helm:
      valuesObject:
        clusterName: <CLUSTER_NAME>
  destination:
    server: https://kubernetes.default.svc
    namespace: falcon-resource-test
  syncPolicy:
    automated: { prune: true }
    syncOptions: [CreateNamespace=true]
```

> **Heads-up:** Argo CD reads OCI charts only when the registry is added as a Helm repository with OCI enabled. If the sync errors with `repository not found`, add it once: `argocd repo add ghcr.io/vianneyp72/charts --type helm --enable-oci --name ghcr-charts`.

- [ ] **Flux:** commit an `OCIRepository` (where the chart lives) and a `HelmRelease` (how to install it):

```yaml
apiVersion: source.toolkit.fluxcd.io/v1beta2
kind: OCIRepository
metadata:
  name: falcon-resource-test
  namespace: flux-system
spec:
  interval: 1h
  url: oci://ghcr.io/vianneyp72/charts/falcon-resource-test
  ref:
    tag: 0.1.0
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: falcon-resource-test
  namespace: flux-system
spec:
  interval: 10m
  chartRef:
    kind: OCIRepository
    name: falcon-resource-test
  targetNamespace: falcon-resource-test
  install:
    createNamespace: true
  values:
    clusterName: <CLUSTER_NAME>
```

> **Verify:** In Argo CD the app shows **Synced** and **Healthy**. In Flux, `flux get helmreleases -n flux-system` shows `falcon-resource-test` with `READY` `True`.

> **Tip:** Pin `targetRevision` / `tag` to a version, not `latest`. The image tag follows the chart version, so one pin fixes both.

## 5. Optional: Private Registry

> **What & Why:** Locked-down or air-gapped clusters can't pull from GHCR. Build the image yourself and point the chart at it.

- [ ] From the cloned repo, build a multi-architecture image and push it to the customer's registry (run `docker login <YOUR_REGISTRY>` first if needed):

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t <YOUR_REGISTRY>/falcon-resource-test:0.1.0 --push .
```

- [ ] Install from the local chart, pointing at that image instead of GHCR:

```bash
helm upgrade --install falcon-resource-test ./chart -n falcon-resource-test --create-namespace \
  --set image.repository=<YOUR_REGISTRY>/falcon-resource-test --set image.tag=0.1.0
```

> **Note:** If the registry needs credentials, create an image pull secret in the `falcon-resource-test` namespace and add `--set imagePullSecrets[0].name=<SECRET_NAME>`.

> **Verify:** `kubectl -n falcon-resource-test get pods` shows `Running`, and `kubectl -n falcon-resource-test get pod -o jsonpath='{.items[0].spec.containers[0].image}'` prints your registry path.

## 6. Clean Up

> **What & Why:** Remove everything the tool created. Falcon itself is not touched.

> **Destructive:** Removing the tool deletes its stored history and saved assessments. Export the reports you need first.

- [ ] Uninstall the release:

```bash
helm -n falcon-resource-test uninstall falcon-resource-test
```

- [ ] Delete the namespace:

```bash
kubectl delete namespace falcon-resource-test
```

> **Verify:** `kubectl get clusterrole,clusterrolebinding falcon-resource-test` returns `NotFound` for both.

## 7. Challenges

### Challenge 1: Load test

**Scenario:** The customer wants to know Falcon's cost under load, not at idle. Measure it.

<details>
<summary>Hint</summary>

Start a **1h** scan first, then generate load in a different namespace.

</details>

<details>
<summary>Solution</summary>

Start the scan, then run `kubectl create deploy stress --image=polinux/stress -- stress --cpu 2`. Compare Falcon's p95 and peak in the report with the idle baseline, then remove the load with `kubectl delete deploy stress`.

</details>

### Challenge 2: Lock down egress

**Scenario:** The customer's security team wants the tool's API access limited to the control plane address only.

<details>
<summary>Hint</summary>

The NetworkPolicy in the chart has a value for the API server's address range. Find the address with `kubectl get endpoints kubernetes -n default`.

</details>

<details>
<summary>Solution</summary>

Upgrade the release with `--set 'networkPolicy.apiServerCIDRs={<API_SERVER_IP>/32}'`, then confirm the **Live** page still updates. If it stops, the address was wrong; set the value back to empty.

</details>

### Challenge 3: Prove it is read-only

**Scenario:** A platform engineer asks you to show the tool can't read Secrets or delete anything.

<details>
<summary>Solution</summary>

Run both checks; each should answer `no`:

```bash
kubectl auth can-i get secrets --as=system:serviceaccount:falcon-resource-test:falcon-resource-test
```

```bash
kubectl auth can-i delete pods --as=system:serviceaccount:falcon-resource-test:falcon-resource-test
```

</details>

---

## Quick Reference

| Task | Command or setting |
|------|--------------------|
| Install | `helm upgrade --install falcon-resource-test oci://ghcr.io/vianneyp72/charts/falcon-resource-test -n falcon-resource-test --create-namespace` |
| Open the UI | `kubectl -n falcon-resource-test port-forward svc/falcon-resource-test 8080:80` |
| Limit discovery | `--set discovery.namespaces={falcon-system,falcon-kac}` |
| Private image | `--set image.repository=<YOUR_REGISTRY>/falcon-resource-test` |
| Logs | `kubectl -n falcon-resource-test logs deploy/falcon-resource-test` |
| Uninstall | `helm -n falcon-resource-test uninstall falcon-resource-test && kubectl delete namespace falcon-resource-test` |

</div>

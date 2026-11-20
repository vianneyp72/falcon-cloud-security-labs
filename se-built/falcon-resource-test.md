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

The tool is **read-only**: it lists pods, nodes, events, DaemonSets, Deployments, webhooks, and metrics. It cannot read Secrets, exec into pods, or change anything. History lives on an `emptyDir` volume (disk that exists only as long as the pod does), so it is lost when the pod restarts or is removed.

---

## Deployment Steps

<div data-mode="guide">

### 1. Install and open the UI

<div data-fill-fields="CLUSTER_NAME:Cluster display name"></div>

```bash
git clone https://github.com/vianneyp72/falcon-resource-test.git
cd falcon-resource-test
```

```bash
./scripts/assess.sh --set clusterName=<CLUSTER_NAME>
```

> **Verify:** The script prints `falcon-resource-test is running` and opens `http://localhost:8080` on the **Live** page. Keep the terminal open; closing it stops the port-forward, not the tool.

<details><summary>Plain Helm equivalent (no clone needed)</summary>

```bash
helm upgrade --install falcon-resource-test oci://ghcr.io/vianneyp72/charts/falcon-resource-test \
  --namespace falcon-resource-test --create-namespace --wait \
  --set clusterName=<CLUSTER_NAME>
```

```bash
kubectl -n falcon-resource-test port-forward svc/falcon-resource-test 8080:80
```

</details>

> **Heads-up:** If the Live page shows a metrics banner, the cluster has no metrics API. Open **Setup** for the install command, run it, and numbers appear within a minute.

### 2. Run an assessment

On **Live**, click **Run assessment**. Under **Watch from now**, keep **30m** selected (or pick **15m** or **1h**) and click **Start 30m scan**.

> **Tip:** If the tool has been running a while, use **Or report on data already collected**, pick a **Last** window, and click **Build report** for an instant report.

### 3. Export the report

When the scan finishes, click **Export HTML**. The file has no external links or scripts, so it can be emailed or attached to a change ticket.

> **Look for:** The headline ("Over 30 minutes on 3 nodes, Falcon used ... of cluster CPU and ... of memory, with ... restarts ...") and the checks list. Anything marked **Fail** or **Review** is what to discuss with the customer.

### 4. Clean up

```bash
helm -n falcon-resource-test uninstall falcon-resource-test
```

```bash
kubectl delete namespace falcon-resource-test
```

> **Verify:** `kubectl get clusterrole falcon-resource-test` returns `NotFound`. Nothing else is left behind.

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

- [ ] Check that the metrics API answers:

```bash
kubectl top nodes
```

> **Verify:** One row per node with `CPU(cores)` and `MEMORY(bytes)`. If you see `Metrics API not available`, install metrics-server:
>
> `kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml`

> **Why this matters:** metrics-server is the cluster add-on that reports live pod and node usage. GKE ships it by default; EKS and many AKS clusters do not. On EKS you can enable it as a managed add-on instead.

### Step 2: Install the chart

<div data-fill-fields="CLUSTER_NAME:Cluster display name"></div>

- [ ] Get the source and run the installer, which installs the chart, waits for the pod, and opens a port-forward to the UI:

```bash
git clone https://github.com/vianneyp72/falcon-resource-test.git
cd falcon-resource-test
```

```bash
./scripts/assess.sh --set clusterName=<CLUSTER_NAME>
```

> **Verify:** Helm prints `STATUS: deployed`, then the script prints `falcon-resource-test is running at http://localhost:8080`. Leave this terminal open and use a second one for the commands below.

- [ ] In a second terminal, check the pod:

```bash
kubectl -n falcon-resource-test get pods
```

> **Verify:** One pod, `READY` `1/1`, `STATUS` `Running`.

> **Tip:** The pod meets the Kubernetes **restricted** Pod Security Standard: non-root, read-only root filesystem, no added capabilities. Clusters that enforce restricted admission accept it without exceptions.

> **Why this matters:** A port-forward tunnels one local port to the Service through the Kubernetes API, using your own kubectl credentials. Nothing is exposed outside the cluster, which is why the Service is `ClusterIP` and the Ingress is off by default. The UI has no login of its own.

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

- [ ] Leave the page open or come back later. Closing the tab doesn't stop the scan; it is listed on the **Assessments** page.

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

- [ ] **Argo CD:** commit this `Application`:

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

- [ ] **Flux:** commit an `OCIRepository` and a `HelmRelease`:

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

- [ ] From the cloned repo, build the image and push it to the customer's registry:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t <YOUR_REGISTRY>/falcon-resource-test:0.1.0 --push .
```

- [ ] Install from the local chart, pointing at that image:

```bash
helm upgrade --install falcon-resource-test ./chart -n falcon-resource-test --create-namespace \
  --set image.repository=<YOUR_REGISTRY>/falcon-resource-test --set image.tag=0.1.0
```

> **Note:** If the registry needs credentials, create a pull secret in `falcon-resource-test` and add `--set imagePullSecrets[0].name=<SECRET_NAME>`.

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

## Challenges

1. **Load test.** Start a **1h** scan, then run a CPU-heavy workload in another namespace (for example `kubectl create deploy stress --image=polinux/stress -- stress --cpu 2`). Compare Falcon's p95 and peak with the idle baseline, then delete the deployment.
2. **Lock down egress.** Find the API server's IP (`kubectl get endpoints kubernetes -n default`) and set `networkPolicy.apiServerCIDRs` to it. Confirm the Live page still updates.
3. **Prove it's read-only.** Run `kubectl auth can-i get secrets --as=system:serviceaccount:falcon-resource-test:falcon-resource-test` and `kubectl auth can-i delete pods --as=system:serviceaccount:falcon-resource-test:falcon-resource-test`. Both should answer `no`.

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

# Kubernetes Deployments

This section covers deploying the CrowdStrike Falcon sensor to Kubernetes clusters using Helm charts or the Falcon Operator.

## Which Method Should I Use?

There are three primary deployment methods:

1. **Helm DaemonSet** — Deploys the Falcon sensor as a privileged DaemonSet that runs on every node. This is the standard approach for any cluster with regular node pools (EKS, GKE Standard, AKS, on-prem).

2. **Helm Sidecar (Injector)** — Deploys a mutating admission webhook that injects the sensor container as a sidecar into each pod. Required for serverless/nodeless Kubernetes (EKS Fargate, AKS virtual nodes).

3. **Falcon Operator** — A Kubernetes operator that manages the sensor lifecycle declaratively via custom resources (`FalconNodeSensor`, `FalconContainer`). Recommended for GitOps-friendly management and automated upgrades.

## Cluster Type to Method Mapping

| Cluster Type | Recommended Method | Notes |
|--------------|--------------------|-------|
| EKS (EC2 node groups) | Helm DaemonSet | Standard privileged workloads |
| EKS (Fargate profiles) | Helm Sidecar | No DaemonSet support on Fargate |
| EKS (EC2 + Fargate hybrid) | DaemonSet + Sidecar | Both methods in one cluster |
| GKE Standard | Helm DaemonSet | Standard privileged workloads |
| GKE Autopilot | Helm DaemonSet (bpf mode) | Requires allowlist-synchronizer |
| AKS | Helm DaemonSet | Standard privileged workloads |
| AKS (virtual nodes) | Helm Sidecar | No DaemonSet on virtual nodes |
| On-prem (kubeadm, Rancher, k3s) | Helm DaemonSet or Operator | Full node access available |
| OpenShift | Operator | Best compatibility with SCCs |

## Guides

### Helm DaemonSet

| Guide | Description |
|-------|-------------|
| [k8s-standard/](helm-daemonset/k8s-standard/) | Any standard cluster (EKS, GKE, AKS, on-prem) — pull from CrowdStrike registry |
| [eks-hybrid/](helm-daemonset/eks-hybrid/) | EKS with both EC2 and Fargate in the same cluster |
| [gke-autopilot/](helm-daemonset/gke-autopilot/) | GKE Autopilot (requires bpf backend + allowlist-synchronizer) |

### Helm Sidecar

| Guide | Description |
|-------|-------------|
| [eks-fargate/](helm-sidecar/eks-fargate/) | EKS Fargate-only clusters |
| [aks-virtual-nodes/](helm-sidecar/aks-virtual-nodes/) | AKS with virtual node pools |

### Operator

| Guide | Description |
|-------|-------------|
| [generic/](operator/generic/) | Standard Falcon Operator deployment |
| [openshift/](operator/openshift/) | OpenShift-specific operator deployment |
| [tainted-nodes/](operator/tainted-nodes/) | Operator with taint tolerations |

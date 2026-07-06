# CrowdStrike Falcon Cloud Security Labs

This repository contains step-by-step lab guides for CrowdStrike Falcon Cloud Security across cloud workloads — sensor deployments, cloud account registration, container protection, and more. Each guide is a self-contained lab folder with instructions and (where applicable) Terraform files for reproducible environments.

## Decision Matrix

Find the right guide: "I have X compute type" → follow the link.

| I have... | Method | Guide |
|-----------|--------|-------|
| **EKS, GKE Standard, AKS, on-prem** | Helm DaemonSet | [kubernetes/helm-daemonset/k8s-standard/](kubernetes/helm-daemonset/k8s-standard/) |
| **EKS (EC2 + Fargate hybrid)** | DaemonSet + Sidecar Injector | [kubernetes/helm-daemonset/eks-hybrid/](kubernetes/helm-daemonset/eks-hybrid/) |
| **EKS (Fargate only)** | Helm Sidecar Injection | [kubernetes/helm-sidecar/eks-fargate/](kubernetes/helm-sidecar/eks-fargate/) |
| **GKE Autopilot** | Helm DaemonSet (bpf + allowlists) | [kubernetes/helm-daemonset/gke-autopilot/](kubernetes/helm-daemonset/gke-autopilot/) |
| **Any K8s** (CRD-based) | Falcon Operator | [kubernetes/operator/](kubernetes/operator/) |
| **ECS Fargate** | Task definition patching | [ecs/fargate-task-patching/](ecs/fargate-task-patching/) |
| **ECS Fargate** (falcon-utility) | Falcon utility sidecar | [ecs/fargate-falcon-utility/](ecs/fargate-falcon-utility/) |
| **ECS EC2** | Daemon service | [ecs/ec2-daemon-service/](ecs/ec2-daemon-service/) |
| **Linux VMs** | Manual, SSM, Ansible, startup script | [vms/linux/](vms/linux/) |
| **Windows VMs** | Manual, SSM, GPO, Intune | [vms/windows/](vms/windows/) |
| **Serverless containers** (Cloud Run, ACI) | Container image patching | [serverless-containers/](serverless-containers/) |
| **Container images** (build-time) | falconutil patch-image | [container-image-patching/](container-image-patching/) |
| **Serverless functions** (Lambda, etc.) | Agentless — no sensor deployed | [serverless-functions/](serverless-functions/) |

## Shared Prerequisites

Before starting any lab, review the shared setup steps in [`_common/`](_common/):

- [API Credentials](_common/api-credentials.md) — Create API clients and required scopes
- [Pull Sensor Images](_common/pull-sensor-images.md) — Download sensor images from CrowdStrike registry
- [Registry Setup](_common/registry-setup/) — Push images to ECR, GAR, ACR, or generic OCI registries
- [GitOps Delivery](_common/gitops/) — ArgoCD, Flux, Terraform patterns
- [Verification](_common/verification.md) — Confirm sensor connectivity

## Repository Structure

```
falcon-cloud-security-labs/
├── README.md
├── _common/                          # Shared prerequisites and utilities
│   ├── api-credentials.md
│   ├── pull-sensor-images.md
│   ├── falcon-container-sensor-pull.sh
│   ├── registry-setup/
│   │   ├── ecr.md, gar.md, acr.md, generic-oci.md
│   ├── gitops/
│   │   ├── argocd.md, flux.md, terraform-helm-release.md
│   └── verification.md
├── kubernetes/                       # All K8s deployments
│   ├── helm-daemonset/               # Node-level sensor via Helm
│   │   ├── k8s-standard/, eks-hybrid/, gke-autopilot/
│   ├── helm-sidecar/                 # Container sensor via sidecar injection
│   │   ├── eks-fargate/, aks-virtual-nodes/
│   └── operator/                     # Falcon Operator (CRD-based)
│       ├── generic/, openshift/, tainted-nodes/
├── ecs/                              # AWS ECS
│   ├── fargate-task-patching/
│   ├── fargate-falcon-utility/
│   └── ec2-daemon-service/
├── vms/                              # Virtual machines
│   ├── linux/
│   │   ├── manual-cli/, aws-ssm/, gce-startup-script/
│   │   ├── ansible/, packer-ami/, terraform-userdata/
│   │   ├── puppet/, chef/
│   └── windows/
│       ├── manual-cli/, aws-ssm/, packer-ami/
│       ├── gpo/, sccm/, intune/
├── serverless-containers/            # Cloud Run, ACI, Container Apps
├── container-image-patching/         # Build-time falconutil
│   ├── local-docker/, github-actions/, gitlab-ci/, jenkins/
└── serverless-functions/             # Agentless (no sensor deployed)
```

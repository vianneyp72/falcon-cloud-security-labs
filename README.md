# CrowdStrike Falcon Cloud Security Labs

This repository contains step-by-step lab guides for CrowdStrike Falcon Cloud Security across cloud workloads — sensor deployments, cloud account registration, container protection, and more. Each guide is a self-contained lab folder with instructions and (where applicable) Terraform files for reproducible environments.

## Browsing the site

The lab site is organized **cloud first** (AWS, Azure, Google Cloud, Any Cloud / Tooling), then by service and OS, and every cloud has an Account Registration section. Generic guides such as the standard Kubernetes Helm lab appear under each cloud but are the same page. A **Modernization Roadmap** page tracks which labs meet the current lab standard (Modernized) and which are still Legacy or not yet written. The folders in this repo stay organized by compute type, as in the matrix below.

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
| **ECS Fargate** (Terraform) | CrowdStrike Terraform module | [ecs/fargate-terraform-module/](ecs/fargate-terraform-module/) |
| **ECS EC2** | Daemon service | [ecs/ec2-daemon-service/](ecs/ec2-daemon-service/) |
| **Linux VMs** | Manual, SSM, Ansible, startup script | [vms/linux/](vms/linux/) |
| **Windows VMs** | Manual, SSM, GPO, Intune | [vms/windows/](vms/windows/) |
| **Serverless containers** (Cloud Run, ACI, Container Apps) | Container image patching | [serverless-containers/](serverless-containers/) |
| **Container images** (build-time) | falconutil patch-image | [container-image-patching/](container-image-patching/) |
| **FCS CLI** (CI image scanning) | GitHub Actions | [fcs-cli/](fcs-cli/) |
| **Cloud account registration** (AWS, Azure, GCP) | Terraform, CloudFormation, Bicep, Resource Manager | [cspm/account-registration/](cspm/account-registration/) |

## Shared Prerequisites

Before starting any lab, review the shared setup steps in [`_common/`](_common/):

- [API Credentials](_common/api-credentials.md) — Create API clients and required scopes
- [Pull Sensor Images](_common/pull-sensor-images.md) — Download sensor images from CrowdStrike registry
- [Verification](_common/verification.md) — Confirm sensor connectivity

## Repository Structure

```
falcon-cloud-security-labs/
├── README.md
├── _common/                          # Shared prerequisites and authoring references
│   ├── api-credentials.md
│   ├── pull-sensor-images.md
│   ├── verification.md
│   ├── lab-template.md               # Copy-and-fill starting point for every lab
│   └── lab-authoring-features.md     # Interactive markers the webapp understands
├── kubernetes/                       # All K8s deployments
│   ├── helm-daemonset/               # Node-level sensor via Helm
│   │   ├── k8s-standard/, eks-hybrid/, gke-autopilot/
│   ├── helm-sidecar/                 # Container sensor via sidecar injection
│   │   ├── eks-fargate/
│   └── operator/                     # Falcon Operator (CRD-based)
│       ├── generic/, openshift/
├── ecs/                              # AWS ECS
│   ├── fargate-task-patching/, fargate-falcon-utility/
│   ├── fargate-terraform-module/
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
├── fcs-cli/                          # FCS CLI in CI
│   └── github-actions-image-scan/
├── cspm/account-registration/        # Cloud account registration
│   ├── aws/ (terraform, cloudformation)
│   ├── azure/ (terraform, bicep)
│   └── gcp/ (terraform, resource-manager)
├── se-built/                         # SE-built tools and references
└── webapp/                           # React site that renders the labs
```

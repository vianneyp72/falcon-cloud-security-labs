# Falcon Sensor on Azure Arc-enabled Kubernetes

> **Status:** Steps not yet written. Use the [Falcon Helm chart docs](https://github.com/CrowdStrike/falcon-helm) and [Azure Arc-enabled Kubernetes overview](https://learn.microsoft.com/azure/azure-arc/kubernetes/overview) in the meantime.

## Overview

Azure Arc-enabled Kubernetes projects any CNCF-conformant cluster (on-prem, edge, or another cloud) into Azure. Customers use it for central management, GitOps (Flux), and Azure Policy. The Falcon sensor still deploys with the standard Helm DaemonSet; Arc is the management plane around it.

> **Note:** Unverified. The Falcon docs do not describe an Arc-specific install. Confirm whether to deliver through a Flux configuration or plain Helm before writing steps.

## Planned scope

- Connecting a cluster to Azure Arc
- Installing the Falcon Helm chart directly and via an Arc Flux configuration
- Verifying the cluster and nodes in the Falcon console

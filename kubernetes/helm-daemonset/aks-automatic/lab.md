# Falcon Sensor on AKS Automatic

> **Status:** Steps not yet written. Use the [Falcon Helm chart docs](https://github.com/CrowdStrike/falcon-helm) and [AKS Automatic overview](https://learn.microsoft.com/azure/aks/intro-aks-automatic) in the meantime.

## Overview

AKS Automatic is the managed flavor of AKS: Microsoft runs the node pools (node auto-provisioning), and it ships with Deployment Safeguards and the baseline Pod Security Standards always enforced. The Falcon node sensor runs as a privileged DaemonSet, which baseline Pod Security Standards block by default.

> **Note:** Unverified. The Falcon docs do not mention AKS Automatic. The expected path is the standard Helm DaemonSet with the Falcon namespaces excluded from Deployment Safeguards (`az aks safeguards update --excluded-ns`). Validate on a real Automatic cluster before writing steps.

## Planned scope

- Why the sensor is blocked by default and how to exclude the Falcon namespaces
- Helm install of the node sensor, KAC, and IAR on an Automatic cluster
- Node auto-provisioning behavior: sensor lands on nodes as they scale up
- Verification in the Falcon console

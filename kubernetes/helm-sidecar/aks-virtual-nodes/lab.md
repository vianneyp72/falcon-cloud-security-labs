# Falcon Sensor on AKS Virtual Nodes

> **Status:** Steps not yet written. Use the [Falcon Helm chart docs](https://github.com/CrowdStrike/falcon-helm) and [AKS virtual nodes overview](https://learn.microsoft.com/azure/aks/virtual-nodes) in the meantime.

## Overview

AKS virtual nodes run pods on Azure Container Instances instead of VM nodes. There is no host to install on and DaemonSets are not supported, so pods on virtual nodes are protected with the Falcon Container sensor (sidecar injector) or by embedding the sensor in the image.

> **Note:** Virtual nodes v2 is in preview and does not support DaemonSets or Windows. Pair this lab with the Standard AKS lab to cover regular node pools in the same cluster.

## Planned scope

- Enabling virtual nodes and scheduling a workload onto them
- Helm install of the sidecar injector and namespace selection
- Verifying the injected sensor on a virtual-node pod

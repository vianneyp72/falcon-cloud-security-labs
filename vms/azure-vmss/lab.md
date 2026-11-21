# Falcon Sensor on Azure Virtual Machine Scale Sets

> **Status:** Steps not yet written. Use the [CrowdStrike azure-vm-extension repository](https://github.com/CrowdStrike/azure-vm-extension) in the meantime.

## Overview

Add the Falcon VM extension to the scale set model (`extensionProfile`) so every new instance installs the sensor as it scales out, or apply it through Azure Policy.

> **Note:** Not supported on scale sets that back AKS node pools; use the AKS labs for those. Outbound rules on the load balancer must allow access to the Falcon cloud.

## Planned scope

- Adding the extension to an existing scale set
- Rolling the change out to existing instances
- Verifying new instances register in the Falcon console

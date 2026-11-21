# Falcon Sensor at Scale with Azure Policy

> **Status:** Steps not yet written. Use the [azure-vm-extension policy README](https://github.com/CrowdStrike/azure-vm-extension/blob/main/policy/README.md) in the meantime.

## Overview

Azure Policy with a DeployIfNotExists effect installs the Falcon VM extension on every matching VM, scale set, and Arc server in a subscription or management group, and remediation tasks cover machines that already exist. This is the "make it automatic for the whole tenant" option.

## Planned scope

- Deploying the policy definitions and initiative with Bicep
- Managed identity and role assignments the policy needs
- Running a remediation task for existing VMs
- Verifying compliance in Azure Policy and hosts in the Falcon console

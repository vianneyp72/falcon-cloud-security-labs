# Falcon Sensor on Azure Windows VMs (VM Extension)

> **Status:** Steps not yet written. Use the [CrowdStrike azure-vm-extension repository](https://github.com/CrowdStrike/azure-vm-extension) in the meantime.

## Overview

Install the Falcon sensor on Windows VMs through the Falcon VM extension (Azure Marketplace publisher `Crowdstrike.Falcon`, type `FalconSensorWindows`). Same flow as the Linux extension lab, with Windows-only settings for VDI and delayed start.

## Planned scope

- Portal install from the VM Extensions + applications blade
- CLI equivalent with `az vm extension set`
- Credentials from Key Vault with a managed identity
- Verifying the host in the Falcon console

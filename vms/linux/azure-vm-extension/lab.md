# Falcon Sensor on Azure Linux VMs (VM Extension)

> **Status:** Steps not yet written. Use the [CrowdStrike azure-vm-extension repository](https://github.com/CrowdStrike/azure-vm-extension) in the meantime.

## Overview

Install the Falcon sensor on Linux VMs through the Falcon VM extension (Azure Marketplace publisher `Crowdstrike.Falcon`, type `FalconSensorLinux`). Azure installs and configures the sensor from the VM blade or `az vm extension set`, with credentials supplied directly or looked up from Azure Key Vault.

> **Note:** The repository describes the extension as community-maintained rather than an official CrowdStrike product. Mention that to customers.

## Planned scope

- Portal install from the VM Extensions + applications blade
- CLI equivalent with `az vm extension set`
- Credentials from Key Vault with a managed identity
- Verifying the host in the Falcon console

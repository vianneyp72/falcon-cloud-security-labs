# Falcon Sensor on Azure Arc-enabled Servers

> **Status:** Steps not yet written. Use the [CrowdStrike azure-vm-extension repository](https://github.com/CrowdStrike/azure-vm-extension) in the meantime.

## Overview

Azure Arc-enabled servers bring on-prem and other-cloud machines into Azure as managed resources. CrowdStrike publishes separate Arc extension listings for Linux and Windows, deployed with `az connectedmachine extension create`.

> **Note:** Arc caps extension commands at 5% CPU, so the repository recommends `disable_provisioning_wait=true` for the sensor install.

## Planned scope

- Onboarding a server to Azure Arc
- Installing the Falcon Arc extension for Linux and Windows
- Verifying the host in the Falcon console

# Falcon Sensor on Windows VMs with a GCE Startup Script

> **Status:** Steps not yet written. Use the [Falcon sensor PowerShell install script docs](https://developer.crowdstrike.com/falcon-sensor/scripts/powershell/install/) in the meantime.

## Overview

Compute Engine runs a PowerShell script from the `windows-startup-script-ps1` metadata key every time a Windows VM boots. Putting the CrowdStrike PowerShell install script there installs the sensor on every new VM, including those created from instance templates and managed instance groups. This is the Windows counterpart of the Linux GCE Startup Script lab.

> **Note:** The metadata key and the install script are well documented, but the end-to-end flow (secret handling for the API client, idempotency on reboot) is not yet verified for this lab.

## Planned scope

- Storing the Falcon API client secret in Secret Manager instead of metadata
- Adding the install script as `windows-startup-script-ps1` on a VM and on an instance template
- Making the script safe to re-run on every boot
- Verifying the host in the Falcon console

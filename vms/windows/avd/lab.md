# Falcon Sensor on Azure Virtual Desktop

> **Status:** Steps not yet written. Use the [CrowdStrike Cloud-Azure repository](https://github.com/CrowdStrike/Cloud-Azure) in the meantime.

## Overview

Azure Virtual Desktop session hosts are often non-persistent, so the sensor must be prepared for VDI (no duplicate host IDs when images are cloned). CrowdStrike's Cloud-Azure repository covers an AVD deployment through Intune, and the Windows VM extension exposes VDI-related settings.

> **Note:** Unverified. Confirm the VDI install flags against the Falcon Windows sensor docs before writing steps.

## Planned scope

- VDI-safe sensor install on a golden image or via Intune
- Host naming and host-group handling for non-persistent sessions
- Verifying session hosts in the Falcon console

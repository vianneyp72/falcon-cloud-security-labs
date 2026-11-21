# Falcon Sensor in Golden Images (Azure Image Builder)

> **Status:** Steps not yet written. Use the [CrowdStrike Cloud-Azure repository](https://github.com/CrowdStrike/Cloud-Azure) in the meantime.

## Overview

Bake the Falcon sensor into a VM image with Azure Image Builder and publish it to an Azure Compute Gallery, so every VM or scale set created from the image is protected at first boot. The sensor is installed in image-prep mode so cloned machines do not share a host identity.

> **Note:** Unverified. CrowdStrike's Cloud-Azure repository lists an Image Builder folder that has not been reviewed yet. Packer's `azure-arm` builder is an alternative.

## Planned scope

- Image template with the Falcon install step
- Publishing to Azure Compute Gallery
- Launching a VM from the image and verifying it in the Falcon console

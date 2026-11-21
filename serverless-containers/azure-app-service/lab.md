# Falcon Sensor on Azure App Service (Containers)

> **Status:** Steps not yet written. Use the [Falcon Container sensor docs for Azure Container Apps](https://github.com/CrowdStrike/falcon-container-sensor-pull) as the closest reference in the meantime.

## Overview

Azure App Service can run a custom Linux container. Like Container Apps and ACI there is no host access, so the sensor would be embedded in the image at build time with `falconutil patch-image`.

> **Note:** Unverified. The Falcon docs cover Azure Container Instances and Azure Container Apps but not App Service. Test a patched image on a Linux App Service plan before writing steps, and state clearly if it is unsupported.

## Planned scope

- Patching the app image and pushing it to Azure Container Registry
- Pointing a Linux web app at the patched image
- Verifying the container in the Falcon console

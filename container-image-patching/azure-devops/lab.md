# Image Patching with Azure Pipelines

> **Status:** Steps not yet written. Use [Container Image Patching](../README.md) and the [Falcon container sensor pull script](https://github.com/CrowdStrike/falcon-container-sensor-pull) in the meantime.

## Overview

Run `falconutil patch-image` inside an Azure Pipelines job so every build pushes a Falcon-patched image to Azure Container Registry, ready for ACI, Container Apps, or AKS virtual nodes. Same flow as the GitHub Actions, GitLab CI, and Jenkins labs, using an Azure DevOps service connection for ACR.

## Planned scope

- Pipeline variables and secure storage for Falcon API credentials
- Pull the sensor image, patch the app image, push to ACR
- Verifying the patched image runs with the sensor

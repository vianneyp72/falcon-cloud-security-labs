# Container Image Patching in Jenkins Pipelines

> **Status:** Steps not yet written. Use [CrowdStrike falconutil-action GitHub](https://github.com/CrowdStrike/falconutil-action) in the meantime.

## Overview

Integrate CrowdStrike Falcon sensor patching into Jenkins CI/CD pipelines. This method uses `falconutil` to automatically patch container images with the Falcon sensor during the build stage, ensuring every image pushed to your registry includes runtime protection without modifying application Dockerfiles.

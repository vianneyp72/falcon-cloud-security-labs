# Falcon on GKE with Auto-protection

> **Status:** Steps not yet written. Use the [CrowdStrike Cloud-GCP repo](https://github.com/CrowdStrike/Cloud-GCP) in the meantime.

## Overview

CrowdStrike lists GKE Auto-protection in its Cloud-GCP repo as a way to protect GKE clusters automatically, as opposed to installing the sensor by hand with Helm. This stub tracks it so SEs can compare it with the Standard and Autopilot Helm labs.

> **Note:** Unverified. The Cloud-GCP README names the feature with a one-line description and no steps. Confirm what it automates, which cluster modes it supports, and what it needs in the Falcon console before writing this lab.

## Planned scope

- What auto-protection does and how it differs from the Helm DaemonSet lab
- Prerequisites and permissions
- Enabling it and verifying new clusters are covered
- Verifying hosts in the Falcon console

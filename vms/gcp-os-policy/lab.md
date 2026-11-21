# Falcon Sensor at Scale with GCP VM Manager (OS Policy)

> **Status:** Steps not yet written. Use the [gcp-vm-manager-os-policy repo](https://github.com/CrowdStrike/gcp-vm-manager-os-policy) in the meantime.

## Overview

VM Manager's OS Config service can enforce an OS policy on every matching Compute Engine VM in a zone. CrowdStrike's `cs-policy` helper downloads the Falcon sensor, stages it in a Cloud Storage bucket, generates the OS policy, and creates the policy assignment, so new and existing VMs converge on the sensor without per-host work. This is the "make it automatic for the whole project" option for Compute Engine.

> **Note:** Per the repo README, the tool targets Linux (RHEL, Oracle Linux, CentOS, SLES, Ubuntu, Debian) and Windows VMs, needs an API client with the **Sensor Download: Read** scope, and can target only labeled VMs. Confirm OS coverage and the OS Config agent prerequisite before writing steps.

## Planned scope

- Enabling the OS Config API and confirming the OS Config agent on target VMs
- Creating a Cloud Storage bucket and running `cs-policy` to generate and assign the policy
- Scoping the assignment by zone and VM label
- Verifying policy compliance in VM Manager and hosts in the Falcon console

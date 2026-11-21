# Falcon Sensor on OCI Compute with Run Command

> **Status:** Steps not yet written. Use the [Cloud-OCI runcommand repo](https://github.com/CrowdStrike/Cloud-OCI/tree/main/runcommand) in the meantime.

## Overview

The OCI Compute Instance Run Command feature runs a command on an instance through the Oracle Cloud Agent, with no SSH or open inbound port. CrowdStrike's Cloud-OCI repo provides a `runcommand` method that uses it to install the Falcon sensor, which suits private instances with no public IP.

> **Note:** The repo README does not list supported operating systems or whether Windows instances are covered. Verify both, and the IAM policy the Run Command plugin needs, before writing steps.

## Planned scope

- Enabling the Run Command plugin in Oracle Cloud Agent and the IAM policy it requires
- Running the install command on one instance from the console
- Running it across instances with the OCI CLI
- Verifying the host in the Falcon console

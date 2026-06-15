# Falcon Sensor Baked into Windows AMI with Packer

> **Status:** Steps not yet written. Use [CrowdStrike Falcon Scripts GitHub](https://github.com/CrowdStrike/falcon-scripts) in the meantime.

## Overview

Pre-install the CrowdStrike Falcon sensor into a Windows Amazon Machine Image (AMI) using HashiCorp Packer. This "golden image" approach ensures every Windows EC2 instance launched from the AMI is protected from first boot, with the sensor already installed and configured before any workloads run.

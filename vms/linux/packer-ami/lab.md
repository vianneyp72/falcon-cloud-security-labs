# Falcon Sensor Baked into AMI with Packer

> **Status:** Steps not yet written. Use [CrowdStrike Falcon Scripts GitHub](https://github.com/CrowdStrike/falcon-scripts) in the meantime.

## Overview

Pre-install the CrowdStrike Falcon sensor into a Linux Amazon Machine Image (AMI) using HashiCorp Packer. This "golden image" approach ensures every EC2 instance launched from the AMI is protected from first boot, eliminating the delay of post-launch installation and reducing dependencies on network connectivity at startup.

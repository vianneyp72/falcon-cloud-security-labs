# Falcon Sensor on Azure Container Instances

> **Status:** Steps not yet written. Use [CrowdStrike Falcon container deployment docs](https://docs.crowdstrike.com/r/en-US/iopiipqy/ba83eb6c) in the meantime.

## Overview

Deploy the CrowdStrike Falcon sensor on Azure Container Instances (ACI). Since ACI is a serverless container platform without host-level access, the sensor is integrated into the container image at build time (image patching) or injected as a sidecar container to provide runtime protection for ACI workloads.

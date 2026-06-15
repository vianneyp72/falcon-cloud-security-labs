# Falcon Sensor on Azure Container Apps

> **Status:** Steps not yet written. Use [CrowdStrike Falcon container deployment docs](https://docs.crowdstrike.com/r/en-US/iopiipqy/ba83eb6c) in the meantime.

## Overview

Deploy the CrowdStrike Falcon sensor on Azure Container Apps. Since Container Apps is a fully managed serverless container platform built on Kubernetes without direct host access, the sensor is integrated into the container image at build time (image patching) to provide runtime protection for Container Apps workloads.

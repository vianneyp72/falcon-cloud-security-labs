# Falcon Sensor on Google Cloud Run

> **Status:** Steps not yet written. Use [CrowdStrike Falcon container deployment docs](https://docs.crowdstrike.com/r/en-US/iopiipqy/ba83eb6c) in the meantime.

## Overview

Deploy the CrowdStrike Falcon sensor on Google Cloud Run services. Since Cloud Run is a fully managed serverless container platform without host-level access, the sensor is integrated into the container image at build time (image patching) to provide runtime protection for Cloud Run workloads.

# Falcon Sensor on ECS EC2 via Daemon Service

> **Status:** Steps not yet written. Use [CrowdStrike Falcon ECS deployment docs](https://docs.crowdstrike.com/r/en-US/iopiipqy/ba83eb6c) in the meantime.

## Overview

Deploy the CrowdStrike Falcon sensor on Amazon ECS clusters backed by EC2 instances using the ECS daemon service scheduling strategy. This runs exactly one sensor container on every EC2 container instance in the cluster, providing kernel-level visibility into all tasks running on that host.

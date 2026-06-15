# Falcon Sensor on ECS Fargate via Falcon Utility Image

> **Status:** Steps not yet written. Use [CrowdStrike Falcon ECS deployment docs](https://docs.crowdstrike.com/r/en-US/iopiipqy/ba83eb6c) in the meantime.

## Overview

Deploy the CrowdStrike Falcon sensor on Amazon ECS Fargate tasks using the Falcon utility image pattern. Since Fargate tasks do not support host-level agents, the Falcon sensor is added as an additional container in the task definition that patches the application container at startup, providing runtime protection for serverless ECS workloads.

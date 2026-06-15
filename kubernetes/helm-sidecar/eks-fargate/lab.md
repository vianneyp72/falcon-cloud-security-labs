# Falcon Sidecar Injection on EKS Fargate

> **Status:** Steps not yet written. Use [CrowdStrike Falcon Helm Sidecar docs](https://docs.crowdstrike.com/r/en-US/qg0ygdwl/l303c850) in the meantime.

## Overview

Deploy the CrowdStrike Falcon sensor as an injected sidecar container on Amazon EKS Fargate. Because Fargate does not support DaemonSets or privileged containers, the sensor is injected into each pod as a sidecar using a mutating admission webhook. This provides user-space visibility into Fargate workloads.

# Falcon Platform on Argo CD — ApplicationSet

> **Status:** Steps not yet written. Use the [ApplicationSet documentation](https://argo-cd.readthedocs.io/en/stable/operator-manual/applicationset/) and the [falcon-platform chart](https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-platform) in the meantime.

## Overview

An **ApplicationSet** generates one Argo CD `Application` per target from a template. With a cluster generator, a single definition deploys Falcon to every cluster registered in Argo CD, and a new cluster gets the sensor automatically. Pick this to roll Falcon out across a fleet.

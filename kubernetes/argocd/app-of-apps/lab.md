# Falcon Platform on Argo CD — App of Apps

> **Status:** Steps not yet written. Use the [Argo CD cluster bootstrapping guide](https://argo-cd.readthedocs.io/en/stable/operator-manual/cluster-bootstrapping/) and the [falcon-platform chart](https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-platform) in the meantime.

## Overview

The **App of Apps** pattern uses one parent Argo CD `Application` that points at a Git folder of child `Application` manifests. Add Falcon as one child, next to the rest of your platform components, and a single sync bootstraps the whole cluster. Pick this when your platform team already manages cluster add-ons from a Git repo.

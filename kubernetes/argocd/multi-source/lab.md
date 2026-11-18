# Falcon Platform on Argo CD — Multi-Source (Chart + Git Values)

> **Status:** Steps not yet written. Use the [Argo CD multiple sources guide](https://argo-cd.readthedocs.io/en/stable/user-guide/multiple_sources/) and the [falcon-platform chart](https://github.com/CrowdStrike/falcon-helm/tree/main/helm-charts/falcon-platform) in the meantime.

## Overview

A **multi-source Application** pulls the `falcon-platform` chart from CrowdStrike's Helm repo and the values file from your own Git repo (`$values/...` reference). The chart stays upstream while configuration is versioned and reviewed in Git, so values changes are pull requests instead of edits to a live Application. Pick this when you want GitOps without forking the chart.

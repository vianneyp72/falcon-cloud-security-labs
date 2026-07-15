# Yet Another Sensor Installer — One-Command Falcon on Kubernetes

A community/SE-built deployment simplifier that installs the full Falcon platform on any Kubernetes cluster with a single command and only **3 environment variables**.

> **Note:** Community/SE-built — **not** an official CrowdStrike tool. Test in non-production first. For official tooling, use the [CrowdStrike Falcon Helm charts](https://github.com/CrowdStrike/falcon-helm).

| Source     | Owner                                              | Link                                                          |
| ---------- | -------------------------------------------------- | ------------------------------------------------------------- |
| Repository | [@mikedzikowski](https://github.com/mikedzikowski) | https://github.com/mikedzikowski/yet-another-sensor-installer |

## What It Does

Wraps the standard pull-token + image-path + Helm workflow into a single `quick-deploy.sh` script that auto-discovers everything it can from your API credentials:

- **3 required env vars** — `FALCON_CLIENT_ID`, `FALCON_CLIENT_SECRET`, `CLUSTERNAME`.
- **Auto-discovery** — resolves your CID, generates the registry pull token, and detects the Falcon cloud region (US-1, US-2, EU-1, Gov) automatically.
- **Deploys three components** — Falcon Sensor (eBPF user mode by default), Kubernetes Admission Controller (KAC), and Image Analyzer (IAR).
- **Optional SHRA** — Self-Hosted Registry Assessment for scanning private container registries.
- **Multi-platform** — EKS, AKS, GKE Standard, and GKE Autopilot.
- **Cleanup** — bundled `uninstall-falcon.sh` removes all components.

## Required API Scopes

- Falcon Container CLI: **Write**
- Falcon Container Image: **Read/Write**
- Falcon Images Download: **Read**
- Sensor Download: **Read**
- Installation Tokens: **Read**

## Basic Usage

```bash
export FALCON_CLIENT_ID="<YOUR_FALCON_CLIENT_ID>"
export FALCON_CLIENT_SECRET="<YOUR_FALCON_CLIENT_SECRET>"
export CLUSTERNAME="<YOUR_CLUSTER_NAME>"

curl -sSL https://raw.githubusercontent.com/mikedzikowski/yet-another-sensor-installer/main/quick-deploy.sh | bash
```

<details>
<summary>Download and run interactively</summary>

```bash
curl -sSL https://raw.githubusercontent.com/mikedzikowski/yet-another-sensor-installer/main/quick-deploy.sh -o quick-deploy.sh
chmod +x quick-deploy.sh
./quick-deploy.sh
```

</details>

## Cleanup

```bash
curl -sSL https://raw.githubusercontent.com/mikedzikowski/yet-another-sensor-installer/main/uninstall-falcon.sh | bash
```

# Falcon Sensor Install - GCE Linux VM via Startup Script

Install the CrowdStrike Falcon sensor on a GCE Linux VM using startup scripts with credentials pulled from Secret Manager.

https://github.com/CrowdStrike/falcon-scripts/blob/main/bash/install/falcon-linux-install.sh

## Components Deployed

- **Falcon Linux Sensor** - Installed via `falcon-linux-install.sh` startup script

## Prerequisites

- GCE VM running a supported Linux distro
- CrowdStrike Falcon API credentials (Client ID + Secret) stored in Secret Manager
  - Required API scope: **Sensor Download** (Read)
- VM service account with `roles/secretmanager.secretAccessor` on the secrets
- Firewall rule allowing SSH from your IP (for verification)

## Deployment Steps

### 1. Create firewall rule for SSH access

```bash
gcloud compute firewall-rules create allow-ssh-my-ip \
  --network=<YOUR_VPC_NETWORK> \
  --allow=tcp:22 \
  --source-ranges="<YOUR_IP_CIDR>" \
  --target-tags=ssh-allowed \
  --description="Allow SSH from my IP range only"
```

### 2. Tag the instance

```bash
gcloud compute instances add-tags <YOUR_INSTANCE_NAME> \
  --zone=<YOUR_ZONE> \
  --tags=ssh-allowed
```

### 3. Grant VM service account access to secrets

```bash
gcloud secrets add-iam-policy-binding FALCON_CLIENT_ID \
  --member="serviceAccount:<YOUR_PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding FALCON_CLIENT_SECRET \
  --member="serviceAccount:<YOUR_PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 4. Ensure VM has `cloud-platform` access scope

> **Important:** The default compute scope does NOT include Secret Manager. You must set `cloud-platform` scope (requires stop/start).

```bash
gcloud compute instances stop <YOUR_INSTANCE_NAME> --zone=<YOUR_ZONE>

gcloud compute instances set-service-account <YOUR_INSTANCE_NAME> \
  --zone=<YOUR_ZONE> \
  --scopes=cloud-platform

gcloud compute instances start <YOUR_INSTANCE_NAME> --zone=<YOUR_ZONE>
```

### 5. Set startup script to download and run the installer

> **Note:** The install script reads `FALCON_CLIENT_ID` and `FALCON_CLIENT_SECRET` as environment variables. Do NOT use `--client-id` flags.
> Use `curl` + metadata token to access secrets (not `gcloud` CLI, which may cache stale tokens).

Create `startup-script.sh`:

```bash
#!/bin/bash
TOKEN=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
export FALCON_CLIENT_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "https://secretmanager.googleapis.com/v1/projects/<YOUR_GCP_PROJECT_NUMBER>/secrets/FALCON_CLIENT_ID/versions/latest:access" | python3 -c "import sys,json,base64; print(base64.b64decode(json.load(sys.stdin)['payload']['data']).decode())")
export FALCON_CLIENT_SECRET=$(curl -s -H "Authorization: Bearer $TOKEN" "https://secretmanager.googleapis.com/v1/projects/<YOUR_GCP_PROJECT_NUMBER>/secrets/FALCON_CLIENT_SECRET/versions/latest:access" | python3 -c "import sys,json,base64; print(base64.b64decode(json.load(sys.stdin)['payload']['data']).decode())")
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/main/bash/install/falcon-linux-install.sh -o /tmp/falcon-linux-install.sh
chmod +x /tmp/falcon-linux-install.sh
/tmp/falcon-linux-install.sh
```

Apply it:

```bash
gcloud compute instances add-metadata <YOUR_INSTANCE_NAME> \
  --zone=<YOUR_ZONE> \
  --metadata-from-file=startup-script=startup-script.sh
```

### 6. Stop/start the instance to trigger the startup script

```bash
gcloud compute instances stop <YOUR_INSTANCE_NAME> --zone=<YOUR_ZONE>
gcloud compute instances start <YOUR_INSTANCE_NAME> --zone=<YOUR_ZONE>
```

### 7. Verify installation

```bash
gcloud compute ssh <YOUR_INSTANCE_NAME> --zone=<YOUR_ZONE> \
  --command="sudo journalctl -u google-startup-scripts --no-pager -n 50"
```

```bash
gcloud compute ssh <YOUR_INSTANCE_NAME> --zone=<YOUR_ZONE> \
  --command="sudo /opt/CrowdStrike/falconctl -g --cid"
```

```bash
gcloud compute ssh <YOUR_INSTANCE_NAME> --zone=<YOUR_ZONE> \
  --command="sudo systemctl status falcon-sensor --no-pager"
```

## Notes

- Startup scripts run on **every boot** — the installer script is idempotent so re-runs are safe
- Secrets are fetched at runtime from Secret Manager — no credentials stored in metadata
- The VM's default compute service account (`<YOUR_PROJECT_NUMBER>-compute@developer.gserviceaccount.com`) needs `cloud-platform` access scope
- Secret paths: `projects/<YOUR_GCP_PROJECT_NUMBER>/secrets/FALCON_CLIENT_ID`, `projects/<YOUR_GCP_PROJECT_NUMBER>/secrets/FALCON_CLIENT_SECRET`

## Gotchas

- **Access scopes:** Default GCE VMs do NOT have Secret Manager scope — you must set `cloud-platform` and stop/start the VM
- **gcloud vs curl:** The `gcloud` CLI inside the VM can cache stale tokens after a scope change. Use `curl` against the metadata server + secrets REST API instead
- **Env vars not flags:** `falcon-linux-install.sh` reads `FALCON_CLIENT_ID` and `FALCON_CLIENT_SECRET` as environment variables — do NOT pass them as `--client-id`/`--client-secret` flags
- **metadata-from-file:** Use `--metadata-from-file=startup-script=file.sh` to avoid shell escaping issues with inline `--metadata=startup-script='...'`

#!/bin/bash
CLIENT_ID=$(gcloud secrets versions access latest --secret=FALCON_CLIENT_ID)
CLIENT_SECRET=$(gcloud secrets versions access latest --secret=FALCON_CLIENT_SECRET)
curl -sSL https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/main/bash/install/falcon-linux-install.sh -o /tmp/falcon-linux-install.sh
chmod +x /tmp/falcon-linux-install.sh
/tmp/falcon-linux-install.sh --client-id="$CLIENT_ID" --client-secret="$CLIENT_SECRET"
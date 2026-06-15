# Pushing Falcon Sensor Images to Google Artifact Registry

## Create a GAR Repository

```bash
gcloud artifacts repositories create falcon-sensor \
  --repository-format=docker \
  --location=us-central1 \
  --description="CrowdStrike Falcon sensor images"
```

The resulting registry path will be: `us-central1-docker.pkg.dev/PROJECT_ID/falcon-sensor`

## Authenticate with GAR

```bash
gcloud auth configure-docker us-central1-docker.pkg.dev
```

This updates your Docker config to use `gcloud` as a credential helper for the specified registry host.

## Pull from CrowdStrike and Push to GAR

Use the `falcon-container-sensor-pull` script:

```bash
falcon-container-sensor-pull \
  --client-id "$FALCON_CLIENT_ID" \
  --client-secret "$FALCON_CLIENT_SECRET" \
  --region "$FALCON_CLOUD" \
  --type falcon-container \
  --copy "us-central1-docker.pkg.dev/$PROJECT_ID/falcon-sensor"
```

Or manually tag and push:

```bash
docker tag falcon-sensor:latest \
  us-central1-docker.pkg.dev/my-project/falcon-sensor/falcon-sensor:latest

docker push us-central1-docker.pkg.dev/my-project/falcon-sensor/falcon-sensor:latest
```

## Important: Do NOT Use `--copy-omit-image-name`

Google Artifact Registry requires the image name as part of the path. GAR repository paths follow the structure:

```
LOCATION-docker.pkg.dev/PROJECT/REPOSITORY/IMAGE:TAG
```

If you use `--copy-omit-image-name`, the push will fail or place the image at an unexpected path. Always let the tool append the image name naturally when targeting GAR.

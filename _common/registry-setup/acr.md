# Pushing Falcon Sensor Images to Azure Container Registry

## Create an ACR Instance

```bash
az acr create \
  --resource-group myResourceGroup \
  --name myfalconregistry \
  --sku Standard
```

The login server will be: `myfalconregistry.azurecr.io`

## Authenticate to ACR

```bash
az acr login --name myfalconregistry
```

## Pull from CrowdStrike and Push to ACR

Use the `falcon-container-sensor-pull` script:

```bash
falcon-container-sensor-pull \
  --client-id "$FALCON_CLIENT_ID" \
  --client-secret "$FALCON_CLIENT_SECRET" \
  --region "$FALCON_CLOUD" \
  --type falcon-container \
  --copy "myfalconregistry.azurecr.io/falcon-sensor"
```

Or manually tag and push:

```bash
docker tag falcon-sensor:latest \
  myfalconregistry.azurecr.io/falcon-sensor:latest

docker push myfalconregistry.azurecr.io/falcon-sensor:latest
```

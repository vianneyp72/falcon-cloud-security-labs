# Pushing Falcon Sensor Images to a Generic OCI Registry

This guide applies to any OCI-compliant container registry, including JFrog Artifactory, Harbor, Quay, and others.

## Authenticate

```bash
docker login <registry-host> \
  --username <username> \
  --password <password-or-token>
```

## Pull from CrowdStrike and Push

Use the `falcon-container-sensor-pull` script:

```bash
falcon-container-sensor-pull \
  --client-id "$FALCON_CLIENT_ID" \
  --client-secret "$FALCON_CLIENT_SECRET" \
  --region "$FALCON_CLOUD" \
  --type falcon-container \
  --copy "<registry-host>/<repository-path>"
```

Or manually tag and push:

```bash
docker tag falcon-sensor:latest \
  <registry-host>/<repository-path>/falcon-sensor:latest

docker push <registry-host>/<repository-path>/falcon-sensor:latest
```

## Notes

- Check your registry's documentation for whether nested repository paths are supported. This determines whether `--copy-omit-image-name` is appropriate.
- Some registries (e.g., JFrog Artifactory) require the repository to be pre-created; others (e.g., Harbor) create it on first push.
- For registries behind a corporate proxy, ensure your Docker daemon is configured with the appropriate proxy settings.

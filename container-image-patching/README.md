# Container Image Patching

Container image patching injects the Falcon sensor into a container image at build time. The resulting patched image contains the sensor binary and is configured to start the sensor alongside the application entrypoint at runtime.

## When to Use Image Patching

Use this approach when:

- The runtime environment does not support privileged DaemonSets or host-level agents (e.g., serverless containers like Cloud Run or Azure Container Instances).
- You want sensor deployment managed entirely within your CI/CD pipeline rather than at the orchestration layer.
- You need to protect individual container images regardless of where they run.

## How It Works

1. Pull the base application image.
2. Run the CrowdStrike `falcon-container-sensor-pull` or patching utility to layer the sensor into the image.
3. Push the patched image to your registry.
4. Deploy the patched image as usual -- the sensor starts automatically at container launch.

## Guides

- [Local Docker](local-docker/) -- Patch images locally using Docker and the CrowdStrike patching utility
- [CI/CD Integration](cicd/) -- Integrate image patching into GitHub Actions, GitLab CI, or other pipelines (stub)

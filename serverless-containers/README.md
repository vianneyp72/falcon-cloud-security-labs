# Serverless Container Deployments

Serverless container platforms run your container images without exposing the underlying host or allowing DaemonSet-style agents. For these environments, **container image patching is the only supported deployment path** for the Falcon sensor.

The sensor is baked into the container image at build time. At runtime, the sensor starts alongside your application process and provides protection from within the container.

Refer to [container-image-patching/](../container-image-patching/) for the core patching workflow, then follow the platform-specific guidance below for deployment considerations.

## Supported Platforms

- [Google Cloud Run](cloud-run/) -- Deploy patched images to Cloud Run services
- [Azure Container Instances (ACI)](aci/) -- Deploy patched images to ACI
- [Azure Container Apps](azure-container-apps/) -- Deploy patched images to Azure Container Apps

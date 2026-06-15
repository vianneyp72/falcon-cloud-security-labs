# AWS ECS Deployments

This section covers deploying the CrowdStrike Falcon sensor to workloads running on Amazon Elastic Container Service (ECS).

## Which Method Should I Use?

The deployment method depends on the ECS launch type:

### ECS on Fargate

Fargate tasks do not have access to the underlying host, so the sensor must be injected into the task itself. Two approaches:

1. **Task definition patching** -- Modify the task definition to include the falcon-sensor container and shared volumes. This is the most common approach.
2. **falcon-utility sidecar** -- Add the `falcon-utility` init container to copy the sensor binary into the application container's filesystem at startup.

### ECS on EC2

EC2-backed ECS clusters give you access to the underlying host instances. Deploy the sensor as a **daemon service** (an ECS service with the `DAEMON` scheduling strategy) so that one sensor task runs on every container instance.

Alternatively, install the sensor directly on the EC2 instances using the same methods documented in [vms/linux/](../vms/linux/).

## Guides

- [Fargate](fargate/) -- Task definition patching and falcon-utility sidecar
- [EC2](ec2/) -- Daemon service deployment on EC2-backed clusters

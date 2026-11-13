# AWS ECS Deployments

This section covers deploying the CrowdStrike Falcon sensor to workloads running on Amazon Elastic Container Service (ECS).

## Which Method Should I Use?

The deployment method depends on the ECS launch type:

### ECS on Fargate

Fargate tasks do not have access to the underlying host, so the sensor must be injected into the task itself. Three approaches:

1. **Task definition patching** -- Modify the task definition to include the falcon-sensor container and shared volumes. This is the most common approach.
2. **Terraform module** -- CrowdStrike's official `terraform-aws-ecs-fargate` module builds the patched task definition for you. Best when you already manage ECS with Terraform.
3. **falcon-utility sidecar** -- Add the `falcon-utility` init container to copy the sensor binary into the application container's filesystem at startup.

### ECS on EC2

EC2-backed ECS clusters give you access to the underlying host instances. Deploy the sensor as a **daemon service** (an ECS service with the `DAEMON` scheduling strategy) so that one sensor task runs on every container instance.

Alternatively, install the sensor directly on the EC2 instances using the same methods documented in [vms/linux/](../vms/linux/).

## Guides

- [Fargate task patching](fargate-task-patching/) -- Patch the task definition with the sensor container
- [Fargate falcon-utility](fargate-falcon-utility/) -- Falcon utility init container sidecar
- [Fargate Terraform module](fargate-terraform-module/) -- CrowdStrike's official Terraform module
- [EC2 daemon service](ec2-daemon-service/) -- Daemon service deployment on EC2-backed clusters

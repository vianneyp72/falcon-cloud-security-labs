# AWS ECS Deployments

This section covers deploying the CrowdStrike Falcon sensor to workloads running on Amazon Elastic Container Service (ECS).

## Which Method Should I Use?

The deployment method depends on the ECS launch type:

### ECS on Fargate

Fargate tasks do not have access to the underlying host, so the sensor must be injected into the task itself. Three approaches:

1. **Task definition patching** -- Patch your existing task definition with the sensor using the `falcon-ecs-patch` script, which wraps CrowdStrike's official patching utility. Best when you want a repeatable step for CI/CD or have no Terraform.
2. **Terraform module** -- CrowdStrike's official `terraform-aws-ecs-fargate` module builds the patched task definition for you. Best when you already manage ECS with Terraform.
3. **Image patching** -- Run `falconutil patch-image` to build the sensor into your application image, push it to ECR, and point the task definition at it. Best when you own the image build.

### ECS on EC2

Two lab options, depending on who runs the instances. Both put one sensor on every instance, but they use different ECS features and different CrowdStrike CloudFormation templates.

**Self-managed EC2:** you launch and patch the instances, so you have access to the host. Deploy the sensor as a **daemon service** (an ECS service with the `DAEMON` scheduling strategy). Alternatively, install the sensor directly on the EC2 instances using the methods in [vms/linux/](../vms/linux/).

**ECS Managed Instances:** AWS launches, patches, and replaces the EC2 instances for you (Bottlerocket, no SSH, replaced at least every 14 days). Because you cannot touch the host, use CrowdStrike's separate **Managed** CloudFormation template, which creates an ECS managed daemon instead of a `DAEMON` service. Not sure which you have? If your capacity provider has a `managedInstancesProvider`, use this method; if you run your own Auto Scaling group of instances, use the self-managed EC2 daemon service above.

## Guides

- [Fargate task patching](fargate-task-patching/) -- Patch the task definition with the `falcon-ecs-patch` script
- [Fargate image patching](fargate-falcon-utility/) -- Patch the application image with `falconutil`
- [Fargate Terraform module](fargate-terraform-module/) -- CrowdStrike's official Terraform module
- [Self-Managed EC2 (Daemon Service)](ec2-daemon-service/) -- You run the EC2 instances; the sensor is an ECS daemon service, deployed with CrowdStrike's CloudFormation stack
- [Managed Instances (Managed Daemon)](managed-instances-daemon/) -- AWS runs the instances; the sensor is an ECS managed daemon, deployed with CrowdStrike's Managed CloudFormation template

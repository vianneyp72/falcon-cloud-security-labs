# Virtual Machine Deployments

This section covers installing the CrowdStrike Falcon sensor on Linux and Windows virtual machines (or bare-metal servers).

## Which Method Should I Use?

### Linux

| Method | Best For |
|--------|----------|
| Manual package install (rpm/deb) | One-off installs, testing |
| AWS Systems Manager (SSM) | AWS-managed fleets, Run Command or Distributor |
| Ansible | Configuration-managed environments |
| Cloud-init / startup script | Auto-scaling groups, immutable infrastructure |
| Packer (bake into AMI/image) | Golden image pipelines |

### Windows

| Method | Best For |
|--------|----------|
| Manual MSI install | One-off installs, testing |
| AWS Systems Manager (SSM) | AWS-managed Windows fleets |
| Group Policy (GPO) | Active Directory-managed environments |
| Startup script (userdata) | Auto-scaling groups |
| Packer (bake into AMI/image) | Golden image pipelines |

## Guides

- [Linux](linux/) -- All Linux installation methods
- [Windows](windows/) -- All Windows installation methods

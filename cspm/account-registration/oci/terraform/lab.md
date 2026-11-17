# OCI CSPM Account Registration — Terraform (Resource Manager)

> **Status:** Steps not yet written. Use the [CrowdStrike OCI Terraform repo](https://github.com/CrowdStrike/cs-oci-integration-terraform) and the Falcon console registration wizard in the meantime.

## Overview

Register an Oracle Cloud Infrastructure (OCI) tenancy with CrowdStrike Falcon Cloud Security using the Terraform template the Falcon console generates. You run the template as an OCI Resource Manager stack (or with Terraform CLI), then paste the resulting `user_ocid` back into the Falcon wizard.

The template creates a dedicated IAM user, group, policy, and API key that give CrowdStrike read-only access to the whole tenancy for asset inventory and indicators of misconfiguration (IOMs).

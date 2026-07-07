# Simple Rego Examples — CSPM Custom IOM Policy Library

A community/SE-built collection of **61 Rego policy examples** for CrowdStrike Falcon Cloud Security Posture Management (CSPM), organized by complexity and mapped to major compliance frameworks. A ready-made reference for writing Custom Indicators of Misconfiguration (IOMs).

> **Note:** Community/SE-built — **not** an official CrowdStrike tool. Built for educational and reference purposes. For production-ready policies and official support, use the [official CrowdStrike documentation](https://falcon.crowdstrike.com/documentation).

| Source | Owner | Link |
|--------|-------|------|
| Repository | [@mikedzikowski](https://github.com/mikedzikowski) | https://github.com/mikedzikowski/simple-rego-examples |

## What It Does

Provides a browsable, copy-paste-able library of Rego policies that evaluate cloud resource configurations against the CrowdStrike CSPM API schema. Every policy follows the same security-first pattern: default to `fail`, `skip` irrelevant resource types, and `pass` only when the secure configuration is confirmed.

The examples are grouped into three tiers:

- **8 Basic Examples** — Minimal policies for learning Rego fundamentals (single-condition checks).
- **5 Advanced Examples** — Helper functions, multi-layer checks, and violation reporting.
- **48 Compliance Examples** — Framework-mapped policies across CIS, NIST 800-53, SOC2, and PCI-DSS.

## Coverage

**Clouds:** AWS, Azure, GCP, OCI

**Frameworks:**

| Framework | Controls | Purpose |
|-----------|----------|---------|
| CIS Benchmarks | 15 | Industry baseline security compliance |
| NIST 800-53 | 15 | Government/enterprise compliance |
| SOC2 | 12 | Vendor assurance & audit readiness |
| PCI-DSS | 6 | Financial data protection compliance |

## Directory Structure

```
examples/
├── basic/          # Simple learning examples
│   ├── aws/        # 3 AWS basic policies
│   ├── azure/      # 2 Azure basic policies
│   ├── gcp/        # 2 GCP basic policies
│   └── oci/        # 1 OCI basic policy
├── advanced/       # Helper functions + violation reporting
│   ├── aws/        # 2 policies
│   ├── azure/      # 1 policy
│   ├── gcp/        # 1 policy
│   └── oci/        # 1 policy
└── compliance/     # Framework-mapped policies
    ├── aws/        # 19 policies across 6 resource types
    ├── azure/      # 14 policies across 4 resource types
    ├── gcp/        # 9 policies across 3 resource types
    └── oci/        # 6 policies across 2 resource types
```

## The Core Pattern

Every policy uses the same three-outcome structure. Here's the basic S3 public access check:

```rego
package crowdstrike

# Simple S3 Public Access Check
# Description: Basic example to check if S3 bucket allows public access

default result := "fail"

# Skip non-S3 resources
result = "skip" if {
    input.resource_type != "AWS::S3::Bucket"
}

# Pass if public access is blocked
result = "pass" if {
    input.resource_type == "AWS::S3::Bucket"
    input.supplementaryConfiguration.BucketPublicAccessBlockConfiguration.blockPublicAcls == true
}
```

- **Default to fail** — security-first; a resource is non-compliant until proven otherwise.
- **Resource filtering** — `skip` anything that isn't the target resource type.
- **Clear validation** — `pass` only on the explicit secure condition.

## Basic Usage

Clone the repo and browse by category, or jump straight to a policy to adapt for your own Custom IOM.

```bash
git clone https://github.com/mikedzikowski/simple-rego-examples.git
cd simple-rego-examples/examples
```

Start with the basics (e.g. `basic/aws/simple_s3_public_access.rego`), then explore the advanced examples (e.g. `advanced/aws/enhanced_s3_security.rego`) for helper functions and richer violation reporting. Use the `compliance/` policies as starting points when you need audit-mapped controls.

> **Tip:** Compliance policy filenames encode their mapping — e.g. `aws_s3_bucket_cis_cis_2_1_1_high_001.rego` is the CIS 2.1.1 (High) control for `AWS::S3::Bucket`.

## Using These in Falcon CSPM

These policies target CrowdStrike's Cloud Security Posture Management API and are written for the Custom IOM workflow. Each policy includes resource-type validation against the actual CrowdStrike resource schema, real configuration checks, framework control mappings, and modern Rego syntax.

To build and deploy your own from these examples, pair this library with the CSPM Custom IOM policy workflow (resource discovery → sample asset data → Rego authoring → test against live assets → deploy).

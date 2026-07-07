# Azure FCS Pre-Reqs Checker — Validate Azure Before Onboarding

A community/SE-built PowerShell script that validates an Azure environment meets the prerequisites for onboarding to CrowdStrike Falcon Cloud Security. It runs comprehensive permission, provider, diagnostic, and policy checks across the tenant root management group and each subscription, then prints color-coded readiness indicators.

> **Note:** Community/SE-built — **not** an official CrowdStrike tool. The project has since **moved to an officially maintained repo:** [CrowdStrike/azure-readiness-check](https://github.com/CrowdStrike/azure-readiness-check). Prefer the official repo for current work; this entry documents the original SE-built tool.

| Source | Link |
|--------|------|
| Original Repository | https://github.com/mikedzikowski/AzureFalconCloudSecurityPreReqs |
| Official Successor | https://github.com/CrowdStrike/azure-readiness-check |

## What It Does

Runs `Get-PreReqs.ps1` to check whether the signed-in Azure identity and environment are ready for FCS onboarding. It surfaces blockers (missing roles, unregistered providers, conflicting policies) **before** you start registration, so onboarding doesn't fail midway.

### Tenant Root Level

- **Owner status** — verifies required owner permissions at the tenant level.
- **Global Administrator** — checks for the Global Administrator role.
- **User Access Administrator** — verifies the role or elevated access.
- **Policy assignments** — identifies potential policy conflicts at tenant level.

### Subscription Level

- **Owner status** — verifies required owner permissions.
- **Provider registration** — validates required providers are registered:
  - `Microsoft.Insights`
  - `Microsoft.Management`
  - `Microsoft.EventHub`
  - `Microsoft.PolicyInsights`
- **Diagnostic settings** — checks activity-log export configuration (optimal: fewer than 5 logs).
- **Policy assignments** — identifies potential policy conflicts (tag-required, allowed-locations, allowed-resource-types, etc.).

## Readiness Indicators

| State | Meaning |
|-------|---------|
| 🟢 Ready | Owner: True · Global Admin: True · User Access Admin: True · Providers: Registered · Diagnostic settings < 5 · Policies: False (no conflicts) |
| 🔴 Needs attention | Owner: False · Global Admin: False · Providers: not registered · Diagnostic settings ≥ 5 · Policies: True (conflicts present) |

## Prerequisites

- Azure PowerShell module installed (for local execution)
- Permissions sufficient to read tenant/subscription configurations
- An active Azure subscription

## Basic Usage

### Local execution

```powershell
./Get-PreReqs.ps1
```

### Azure Cloud Shell (recommended — modules pre-installed)

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/mikedzikowski/AzureFalconCloudSecurityPreReqs/main/Get-PreReqs.ps1" -OutFile "Get-PreReqs.ps1"
./Get-PreReqs.ps1
```

> **Caution:** Downloading and running a remote script executes unreviewed code. For anything beyond a throwaway check, read `Get-PreReqs.ps1` before running it — and prefer the [official successor repo](https://github.com/CrowdStrike/azure-readiness-check).

## Sample Output

```
=== Checking Tenant Root Management Group ===
Owner Check:
  ✓ Is Owner: True
Global Administrator Check:
  ✓ Is Global Administrator: True
User Access Administrator Check:
  ✓ Is User Access Administrator: True

=== Checking Subscription ===
Provider Checks:
  ✓ Provider Microsoft.Insights is registered
  ✓ Provider Microsoft.Management is registered
  ✓ Provider Microsoft.EventHub is registered
  ✓ Provider Microsoft.PolicyInsights is registered
Diagnostic Settings Check:
  ✓ Activity Logs Exported: 2
```

## Troubleshooting

- **Is Global Administrator: False** — manage roles in [Azure AD Roles](https://portal.azure.com/#view/Microsoft_AAD_IAM/RolesManagementMenuBlade/~/AllRoles).
- **Is User Access Administrator: False** — enable elevated access in [Azure AD Properties](https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/Properties).
- **Activity Logs Exported ≥ 5** — review [Diagnostic Settings](https://portal.azure.com/#view/Microsoft_Azure_Monitoring/DiagnosticsLogsBlade/).

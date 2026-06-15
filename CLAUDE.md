# falcon-sensor-installs

Documentation repository containing hands-on lab guides for deploying CrowdStrike Falcon sensors across cloud workloads. No application code, no tests, no builds — just markdown, shell scripts, and Terraform files.

## Taxonomy

Primary axis: **compute type** (what you're deploying TO)
Secondary axis: **deployment method** (how you're deploying)

```
kubernetes/helm-daemonset/k8s-standard/   ← compute/method/variant
ecs/fargate-task-patching/                ← compute/method
vms/linux/ansible/                        ← compute/os/method
```

Shared prerequisites live in `_common/` (underscore prefix sorts first).

## Lab Format

Every deployment method is a folder with `lab.md` as the primary document. Follow this style (modeled after `kubernetes/helm-daemonset/k8s-standard/lab.md`):

```markdown
# Title — What This Deploys

One-line description of what this does.

Official GH: <github link>
Official Docs: <docs link>

## Components Deployed
- **Component** - Brief description

## Prerequisites
- Bullet list of what's needed
- Required API scopes in bold

## Deployment Steps
### 1. Step title
Code blocks with commands. No excessive prose.

### 2. Next step
...
```

**Key rules:**
- Platform-agnostic where possible (one guide covers EKS + GKE + AKS)
- Keep steps as copy-paste-able commands
- Use environment variables for user-specific values
- No emojis in content

## When to use the full lab template (longer guides)

For comprehensive labs (like `container-image-patching/local-docker/lab.md` or `vms/linux/ansible/lab.md`), use the extended format:

- `> **~X min | Difficulty**` time markers per section
- `> **What & Why:**` blockquotes explaining each step's purpose
- `- [ ]` checkboxes for every hands-on action
- `<details><summary>CLI equivalent</summary>` for console-first steps
- `<details><summary>Hint/Solution</summary>` for challenges
- Reference Docs table at top
- Quick Reference table at bottom
- 2-3 progressive challenges with hints/solutions

## Stubs

Unwritten guides use this pattern:

```markdown
# Title

> **Status:** Steps not yet written. Use [link to official docs] in the meantime.

## Overview
Brief explanation of what this method is.
```

## File conventions

- `lab.md` — Instructions (every method folder has one)
- `*.tf` — Terraform files (providers.tf, main.tf, variables.tf, outputs.tf)
- `terraform.tfvars` — User values (gitignored)
- `scripts/` — Shell scripts for the method
- `_common/` — Shared reference docs, not labs

## Do NOT

- Create separate folders per cloud provider when the steps are identical (use `k8s-standard/` not `eks/` + `gke/` + `aks/`)
- Put secrets or real credentials in any file (use env var placeholders)
- Add README.md files inside individual lab folders (the `lab.md` IS the guide)
- Rewrite existing content from scratch when reformatting — preserve the steps, add structure around them

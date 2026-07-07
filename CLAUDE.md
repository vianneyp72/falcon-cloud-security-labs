# falcon-cloud-security-labs

Documentation repository containing hands-on lab guides for CrowdStrike Falcon Cloud Security across cloud workloads — sensor deployments, FCS CLI, cloud account registration, container protection, and more. No application code, no tests, no builds — just markdown, shell scripts, and Terraform files.

## Taxonomy

Primary axis: **compute type** (what you're deploying TO)
Secondary axis: **deployment method** (how you're deploying)

```
kubernetes/helm-daemonset/k8s-standard/   ← compute/method/variant
ecs/fargate-task-patching/                ← compute/method
vms/linux/ansible/                        ← compute/os/method
```

Shared prerequisites live in `_common/` (underscore prefix sorts first).

## Lab Format (Dual-Mode Standard)

Every deployment method is a folder with `lab.md` as the primary document. All labs use a **dual-mode structure** with two views:

- `<div data-mode="guide">` — **Quick Deploy** (fast path, max 5 steps)
- `<div data-mode="lab">` — **Full Lab** (comprehensive walkthrough)

The webapp's mode toggle switches between these views. Reference lab: `serverless-containers/cloud-run/lab.md`.

### Content placement

**Above the mode split (shared by both views):**
- Title and one-line description
- Performance notes / callouts
- Prerequisites blockquote (tools, APIs, scopes)
- Reference Docs table (Source | Link)
- Core concepts and architecture diagrams

**Below the split (inside mode divs):**
- All hands-on deployment steps

### Skeleton

```markdown
# Title — What This Deploys

One-line description.

> **Prerequisites:**
> - Required tools, APIs, scopes

| Source | Link |
|--------|------|
| Official Docs | <url> |

## Core Concepts

Brief explanation of key ideas and architecture.

---

## Deployment Steps

<div data-mode="guide">

### 1. First step
### 2. Second step
### 3. Third step
### 4. Fourth step
### 5. Verify

</div>

<div data-mode="lab">

## N. Section Title

### Step 1: ...

</div>
```

### Quick Deploy mode rules

- Use as few H3 numbered steps as the method allows — the goal is the simplest path to get a customer up and running fast. More than 5 steps is fine when the method genuinely needs them (don't artificially merge or omit steps).
- Console-first: describe the UI navigation, then collapse CLI into `<details><summary>CLI equivalent</summary>`
- No checkboxes, no time/difficulty markers, no `> **What & Why:**` blocks
- Minimal prose — get to the point

### Full Lab mode rules

- H2 numbered sections (restart at `## 1` after the shared `## Core Concepts`)
- `> **What & Why:**` blockquotes before each step explaining purpose
- `- [ ]` checkboxes for every hands-on action
- Console-first with `<details><summary>CLI equivalent</summary>`
- Challenges section (2-3 progressive) + Quick Reference table at end

### General rules

- Platform-agnostic where possible (one guide covers EKS + GKE + AKS)
- Keep steps as copy-paste-able commands
- Use environment variables for user-specific values
- No emojis in content
- Console-first applies to BOTH modes (UI navigation as primary, CLI in collapsible details)

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

## Webapp dependency management

When you add new packages locally, just run `npm run fix-lockfile` before committing to rewrite the Artifactory URLs back to public ones.

## Do NOT

- Create separate folders per cloud provider when the steps are identical (use `k8s-standard/` not `eks/` + `gke/` + `aks/`)
- Put secrets or real credentials in any file (use env var placeholders)
- Add README.md files inside individual lab folders (the `lab.md` IS the guide)
- Rewrite existing content from scratch when reformatting — preserve the steps, add structure around them

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

## Audience & Voice

**Every lab is written for a CrowdStrike Sales Engineer who is new to cloud.** This is the single most important lens for every choice — flow, wording, callouts, and level of detail. Evaluate every step, sentence, and note against this reader before shipping.

### What this means in practice

- **Assume Falcon fluency, not cloud fluency.** They know the Falcon platform (CID, sensor, KAC, IAR, detections) but may not know what an IAM role, security group, node pool, Fargate profile, or service principal actually IS. Explain the cloud-native primitive briefly the first time it appears in a lab; don't re-explain Falcon terms.
- **Never assume prior console familiarity for the cloud provider.** The AWS/GCP/Azure console layout is unfamiliar territory for a first-time SE. Guide them to the exact service, then the exact button — console-first is not optional, it's the primary learning surface.
- **Cut fluff, keep insight.** Zero tolerance for filler ("In this step, we will now proceed to…"). But DO include a short teaching note where a cloud concept genuinely helps them understand what they just did — e.g. "The pod execution role is what lets Fargate pull from ECR; you don't attach it to pods yourself, EKS does it for you." Aim for one or two-sentence insight callouts, not paragraphs.
- **Use `> **Note:**` / `> **Why this matters:**` blockquotes to teach cloud concepts inline** — placed AT the step where the concept first bites, not lumped into a background section they'll skip. In Full Lab mode this pairs naturally with the existing `> **What & Why:**` block (What & Why = purpose of this step; Note/Why this matters = the cloud concept the step exposes).
- **Name the cloud-provider term the same way the console does.** If AWS calls it a "trust relationship", don't rename it "trust policy" mid-lab. Consistency with the console reduces the cognitive load of translating.
- **Never hand-wave errors.** If a command commonly fails for a first-timer (missing region, wrong context, expired token, un-enabled API), pre-empt it with a one-line "If you see X, run Y" note at the point of failure — not in a troubleshooting appendix.
- **Explain outputs, not just inputs.** After a `kubectl get pods` / `az container show` / `gcloud … list`, tell them what to look for in the output ("STATUS should be `Running` and READY should be `1/1` or `2/2` if injected"). A first-timer stares at output and doesn't know what "good" looks like.
- **Keep the happy path clean.** Edge cases, alternate paths, and provider-specific quirks go in scoped inline notes or Challenges — not woven into the main flow.

### Voice checklist before shipping any lab or edit

- [ ] Would a first-time-in-cloud SE finish this without getting stuck or context-switching to Google?
- [ ] Does every command have a one-line intent line above it (what will happen / why)?
- [ ] Are the cloud primitives that appear (IAM role, security group, service account, resource group, etc.) explained briefly at first use?
- [ ] Are outputs annotated so they know what "success" looks like?
- [ ] Is every explanatory sentence earning its place, or is it filler?
- [ ] Are teaching notes short and inline (at the step), not batched into a background wall?

## Callout Patterns

Every `> **Bold-lede:**` blockquote is auto-classified into a color-coded callout by the webapp. **Pick the pattern that matches the intent** — the color reinforces the meaning at a glance and helps SEs new to cloud scan for the parts they need. Renderer + CSS details live in `webapp/CLAUDE.md`; this section is the authoring vocabulary.

| When to reach for it | Pattern (lede in the blockquote) | Color |
|---|---|---|
| Explain the purpose of a step or how something works | `> **What & Why:** …` / `> **How this works:** …` | Blue (info) |
| Teach a cloud concept inline — the "aha" for a new-to-cloud SE | `> **Tip:** …` / `> **Why this matters:** …` | Teal (tip) |
| Flag something a first-timer commonly gets wrong | `> **Warning:** …` / `> **Caution:** …` / `> **Heads-up:** …` | Yellow (warning) |
| Destructive / irreversible / cost-incurring action | `> **Destructive:** …` / `> **Do NOT:** …` / `> **Costs money:** …` | Red (danger) |
| Tell them what "good" output looks like | `> **Verify:** …` / `> **Look for:** …` / `> **Confirm:** …` | Green (success) |
| Prerequisites, status markers, side notes | `> **Prerequisites:** …` / `> **Note:** …` / `> **Status:** …` | Purple (note) |

**Rules of thumb:**

- **Tip vs What & Why** — `> **What & Why:**` explains the *step's purpose* (why we run this command). `> **Tip:**` / `> **Why this matters:**` teaches the *underlying cloud concept* (e.g. "The pod execution role is what lets Fargate pull from ECR — you don't attach it to pods yourself, EKS does it"). Both can appear near the same step; they answer different questions.
- **Warning vs Danger** — `> **Warning:**` is "you might hit this snag" (yellow, cautionary). `> **Danger:**` is "this action is destructive / irreversible / costs real money" (red, high-impact). Reserve red for *real* stakes so it retains meaning.
- **One lede per callout.** Don't stack `> **Prerequisites, Warning, and Note:** …` — pick the strongest and split if needed.
- **The lede must be bold and end with `:`** (e.g. `> **Verify:**`). The classifier sniffs the whole callout text, but the bold lede is what makes it readable to authors and to the SE.
- **Don't fake a variant with hex colors or emojis.** Use the pattern; the webapp handles the styling. Emojis in the lede are OK if they aid the SE (⚠️ triggers `warning`) but not required.

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

**Auto-injected — do NOT add to `lab.md`:**
A maintainer disclaimer ("Maintained by minh.pham@crowdstrike.com...") is rendered automatically by the webapp at the top of every lab (directly above the H1 title, and directly below the status badge on stubs). Source: `webapp/src/components/LabDisclaimer.jsx`. To change the wording, edit that component — never duplicate it into individual `lab.md` files.

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

- Keep explanations simple and concise — these guides are meant to be quick, to the point, and easy to deploy. Explain only what a customer needs to act; cut background, exhaustive lists, and repetition.
- Platform-agnostic where possible (one guide covers EKS + GKE + AKS)
- Don't assume the reader's local OS. Write happy-path explanations that hold for any host (Linux/macOS/Windows). Keep OS-specific quirks (e.g. Docker Desktop `credsStore` on macOS/Windows, Apple Silicon `--platform` auto-detection) out of the main prose — if one genuinely matters, call it out as a short scoped gotcha at its point of use ("On Apple Silicon…"), not as the default framing. Don't add a big multi-OS notes block unless the user asks for it.
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

# Lab Authoring Features

Reference for the interactive markers the webapp understands. Start from [`lab-template.md`](lab-template.md); the canonical live example is `kubernetes/helm-daemonset/k8s-standard/lab.md`. Voice, callout vocabulary, and mode rules live in the repo `CLAUDE.md`.

## Quick index

| Feature | Marker | Where it works | Defined in |
|---|---|---|---|
| Mode split | `<div data-mode="guide">` / `<div data-mode="lab">` | Top level | `ModeToggle.jsx` |
| Registry picker | `<div data-registry-picker></div>` | Guide mode | `RegistryChoice.jsx` |
| Registry block gate | `<div data-registry="ecr,acr">` | Anywhere | `RegistryChoice.jsx` |
| Deploy options picker | `<div data-deploy-options></div>` | Guide mode | `DeployOptions.jsx` |
| Line gate in code | trailing `#@registry=` / `#@region=` / `#@opt=` | Code blocks | `LabRenderer.jsx` |
| Option block gate | `<div data-opt="kac">` | Anywhere | `LabRenderer.jsx` |
| Method picker + gate | `<div data-profile-picker>` / `<div data-profile="awscli">` | Both modes | `ProfileMethod.jsx` |
| Fill-in panel | `<div data-fill-fields="NAME:Label,...">` | Anywhere | `FillFields.jsx` |
| Lab Variables panel | `<div data-lab-variables></div>` + manifest `variables` | Lab mode | `LabVariables.jsx` |
| Cloud block gate | `<div data-cloud="gke">` | Lab mode | `LabRenderer.jsx` |
| Variable substitution | `{{CLUSTER_NAME}}`, `{{REGION}}` | Code blocks | `LabRenderer.jsx` |
| Editable placeholder | `<NAME>` or `<NAME:default>` | Code blocks | `CodeBlock.jsx` |
| Checkboxes | `- [ ] text` | Lab mode | `useProgress.js` |
| Callouts | `> **Lede:** text` | Anywhere | `LabRenderer.jsx` |
| Diagrams | ASCII trigger block | Core Concepts | `FlowDiagram.jsx` |

## Mode split

- The toggle is injected automatically above the H2 whose text matches `deployment steps` (case-insensitive). Keep that heading.
- Leave a blank line after each opening `<div ...>` and before each closing `</div>`, or markdown inside will not render.
- Checkbox progress is stored per mode, so Quick Deploy and Full Lab track separately.
- **Quick Deploy only:** omit the `data-mode="lab"` block entirely. The webapp then hides the toggle and always shows the guide half, even if the reader's stored mode is Full Lab (`contentHasLabMode` / `resolveMode` in `ModeToggle.jsx`). Example: `ecs/fargate-terraform-module/lab.md`.

## Pickers (Quick Deploy)

Both pickers store the reader's choice in localStorage and every gated block updates live.

**Registry picker** (`data-registry-picker`) sets: source (`crowdstrike` or `own`), registry type (`ecr`, `acr`, `gar`, `generic`), and for ECR, `new` vs `existing` repo.

Gate values for `data-registry` and `#@registry=` (comma list means any match):

| Value | Active when |
|---|---|
| `crowdstrike` | Pulling from CrowdStrike's registry |
| `own` | Any own-registry choice |
| `ecr` / `acr` / `gar` / `generic` | That registry type |
| `ecr-new` / `ecr-existing` | ECR with per-image repos / one existing repo |
| `per-image` | Own registry where each image gets its own repo (everything except ECR existing) |

**Deploy options** (`data-deploy-options`) sets: Commercial vs GovCloud (US-GOV-1 / US-GOV-2), optional component toggles, and HTTP proxy.

## Line gates in code blocks

Append a marker to the end of a line. The marker is stripped from what the reader sees; the line is dropped if the gate does not match. Markers stack and **all must match**.

```text
--set falcon-kac.enabled=false \ #@opt=nokac
--set falcon-kac.falcon.aph=<PROXY_HOST> \ #@opt=kac #@opt=proxy
--set agentRegion=gov1 \ #@opt=iar #@region=gov1
```

| Marker | Values |
|---|---|
| `#@opt=` | `kac`, `nokac`, `iar`, `noiar`, `proxy` |
| `#@region=` | `commercial`, `gov`, `gov1`, `gov2` |
| `#@registry=` | see the registry table above |

Gotchas:

- Keep the trailing `\` BEFORE the marker so the copied command still continues correctly.
- A line that is only a marker (such as `#@opt=kac` alone) is kept or dropped as an empty line; use it to gate a blank spacer.
- To vary a `for` loop by component, write one `for` line per combination (see `kac`/`noiar` rows in k8s-standard), each with its own gates.
- Component names `kac` and `iar` are hardcoded in `DeployOptions.jsx`. A lab with different optional components needs that component extended first.

## Option block gates

`<div data-opt="kac">` shows its contents only when that Additional-settings option is active (same values as `#@opt=`: `kac`, `nokac`, `iar`, `noiar`, `proxy`; comma list means any match). Use it to hide a whole install step, intro line and code block together, when a component is unchecked. Blank lines after the opening tag and before `</div>` are required. See the KAC and Image Analyzer installs in `kubernetes/helm-sidecar/eks-fargate/lab.md`.

## Method picker (Fargate profile)

`<div data-profile-picker></div>` renders an "AWS Console / AWS CLI / eksctl" toggle (default AWS CLI, stored in localStorage). Wrap each variant in `<div data-profile="console">`, `"awscli"` or `"eksctl"` (comma list means any match), with blank lines after the opening tag and before `</div>`. Used in `kubernetes/helm-sidecar/eks-fargate/lab.md` and `kubernetes/helm-daemonset/eks-hybrid/lab.md` (Quick Deploy and Full Lab) so Quick Deploy does not require installing `eksctl`. The method names are hardcoded in `ProfileMethod.jsx`; extend that file to reuse the pattern for another choice.

## Fill-in panel

`<div data-fill-fields="FALCON_CID:CID (with checksum),AWS_REGION:AWS region"></div>` renders a labeled form for shared `<NAME>` placeholders so the reader enters them once, outside any copy block. Format is `NAME:Label` pairs separated by commas (no commas inside a label). The inputs read and write the same values as inline `<NAME>` fields, so every code block using that name updates live. Names containing `SECRET`, `PASSWORD`, `TOKEN`, or `PRIVATE` render as password inputs and are never saved. Keep secrets in an `export` line below the panel, since a secret placeholder still needs to land in a shell variable. Also list the secret as a field in the panel (`FALCON_CLIENT_SECRET:API client secret`) so the reader enters every credential in one place and cannot miss it; the `export` block below then picks up what they typed.

**Derived placeholders.** Add `data-fill-derive="NAME=<A>.suffix.<B>"` (several allowed, separated by `;`) to compose one placeholder from others. `REGISTRY` below is rebuilt live as the reader types and is empty until every piece is filled:

```html
<div data-fill-fields="AWS_ACCOUNT_ID:AWS account ID,AWS_REGION:AWS region"
     data-fill-derive="REGISTRY=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com"></div>
```

### Variable methodology (use this in every lab)

| Kind of value | How to write it | Why |
|---|---|---|
| Reader-supplied (CID, client ID, cluster name, account, region, registry host) | Shared `<NAME>` placeholder, entered once in a `data-fill-fields` panel, written inline in every command | One entry, no re-exporting, nothing to forget after a shell restart |
| Built from other reader values (registry address) | `data-fill-derive` | Reader never assembles the string |
| Secrets (`*SECRET*`, `*PASSWORD*`, `*TOKEN*`, `*PRIVATE*`) | A field in the `data-fill-fields` panel (password input) AND `export X="<X>"` in its own block below | Reader enters every credential in one place; secret placeholders are never saved to localStorage; the shell needs the value |
| Discovered at run time (image tags, image paths, pull tokens) | `export`, computed by a command | The page cannot know them in advance |
| Full Lab cluster name and region | `{{CLUSTER_NAME}}` / `{{REGION}}` from the Lab Variables panel | Already shared across the lab |

Do not `export` a value the reader typed unless it is a secret. Validate blocks then check only the secret and the discovered values.

## Lab Variables panel (Full Lab)

1. Add `<div data-lab-variables></div>` once, under the Step 1 that first needs it.
2. Register the fields on the lab's entry in the `LABS` array in `webapp/src/content/manifest.js`:

```js
{
  id: 'category/method', label: 'Title', area: 'Category', md: 'category/method/lab.md',
  variables: {
    modes: ['lab'],
    fields: [
      { key: 'CLOUD', label: 'Cloud', type: 'select', default: 'gke',
        options: [{ value: 'gke', label: 'GKE', regionLabel: 'Zone', regionDefault: 'us-central1-a' }] },
      { key: 'CLUSTER_NAME', label: 'Cluster name', type: 'text', default: 'falcon-helm-lab' },
      { key: 'REGION', label: 'Region', type: 'text' },
    ],
  },
},
```

3. Use `{{CLUSTER_NAME}}` / `{{REGION}}` directly in commands. Do NOT also `export` them.
4. `CLOUD` is special: it drives `data-cloud` blocks, relabels `REGION` via `regionLabel`, and resets `REGION` to `regionDefault`. Single-provider labs can omit `CLOUD` and `data-cloud` blocks.

## Editable placeholders

`<NAME>` (uppercase, digits, `_`) in a fenced code block becomes an inline input; `<NAME:default>` pre-fills a default (no spaces, quotes, or angle brackets in the default). Blocks that share a name stay in sync across the lab. Names containing `SECRET`, `PASSWORD`, `TOKEN`, or `PRIVATE` are kept in memory only and never saved to localStorage.

- Use for values the customer must supply (`<YOUR_CLUSTER_NAME>`, `<ACR_NAME>`).
- Lowercase angle brackets (`<node-1>` in sample output) are not matched and stay literal.

## Diagrams

1. Add a fenced block (no language) with box-drawing or keyword text unique to this lab.
2. In `webapp/src/components/FlowDiagram.jsx`, copy the closest builder: `buildK8sDaemonsetDiagram` (standard cluster), `buildEksHybridDiagram` (sidecar plus node DaemonSet), `buildGkeAutopilotDiagram` (admission gate), `buildCloudRunPipelineDiagram` (build or deploy pipeline).
3. Add a `text.includes(...)` route in `buildDiagramFromContent()`, more specific matches first.
4. Do not add a second expand button, and add a `[data-theme="light"]` override for any new node variant (see `webapp/CLAUDE.md`).

## Registering a new lab

In `webapp/src/content/manifest.js`: add the `?raw` import and `labs` map entry, a `LABS` entry, and at least one nav placement under a cloud (steps in `webapp/CLAUDE.md`, "Adding a New Lab"). Until `modernized: true` is set the lab shows as Legacy or Roadmap. Then run `npm run build` in `webapp/`.

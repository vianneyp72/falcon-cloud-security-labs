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

## Fill-in panel

`<div data-fill-fields="FALCON_CID:CID (with checksum),AWS_REGION:AWS region"></div>` renders a labeled form for shared `<NAME>` placeholders so the reader enters them once, outside any copy block. Format is `NAME:Label` pairs separated by commas (no commas inside a label). The inputs read and write the same values as inline `<NAME>` fields, so every code block using that name updates live. Names containing `SECRET`, `PASSWORD`, `TOKEN`, or `PRIVATE` render as password inputs and are never saved. Keep secrets in an `export` line below the panel, since a secret placeholder still needs to land in a shell variable.

## Lab Variables panel (Full Lab)

1. Add `<div data-lab-variables></div>` once, under the Step 1 that first needs it.
2. Register the fields on the lab in `webapp/src/content/manifest.js`:

```js
lab('Title', 'route', 'category/method/lab.md', {
  variables: {
    modes: ['lab'],
    fields: [
      { key: 'CLOUD', label: 'Cloud', type: 'select', default: 'gke',
        options: [{ value: 'gke', label: 'GKE', regionLabel: 'Zone', regionDefault: 'us-central1-a' }] },
      { key: 'CLUSTER_NAME', label: 'Cluster name', type: 'text', default: 'falcon-helm-lab' },
      { key: 'REGION', label: 'Region', type: 'text' },
    ],
  },
}),
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

Add the `?raw` import, the `labs` map entry, and the tree entry in `webapp/src/content/manifest.js` (steps in `webapp/CLAUDE.md`, "Adding a New Lab"). Then run `npm run build` in `webapp/`.

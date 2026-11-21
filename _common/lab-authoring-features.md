# Lab Authoring Features

Reference for the interactive markers the webapp understands. Start from [`lab-template.md`](lab-template.md); the canonical live example is `kubernetes/helm-daemonset/k8s-standard/lab.md`. Voice, callout vocabulary, and mode rules live in the repo `CLAUDE.md`.

## Quick index

| Feature | Marker | Where it works | Defined in |
|---|---|---|---|
| Mode split | `<div data-mode="guide">` / `<div data-mode="lab">` | Top level | `ModeToggle.jsx` |
| Registry picker | `<div data-registry-picker></div>` | Guide mode | `RegistryChoice.jsx` |
| Registry block gate | `<div data-registry="ecr,acr">` | Anywhere | `RegistryChoice.jsx` |
| Deploy options picker | `<div data-deploy-options></div>` | Guide mode | `DeployOptions.jsx` |
| Line gate in code | trailing `#@registry=` / `#@region=` / `#@opt=` / `#@choice=` | Code blocks | `LabRenderer.jsx` |
| Option block gate | `<div data-opt="kac">` | Anywhere | `LabRenderer.jsx` |
| Method picker + gate | `<div data-profile-picker>` / `<div data-profile="awscli">` | Both modes | `ProfileMethod.jsx` |
| Test-target picker + gate | `<div data-test-target-picker>` / `<div data-test-target="ec2">` | Both modes | `TestTarget.jsx` |
| Fill-in panel | `<div data-fill-fields="NAME:Label,...">` | Anywhere | `FillFields.jsx` |
| Lab Variables panel | `<div data-lab-variables></div>` + manifest `variables` | Lab mode | `LabVariables.jsx` |
| Cloud block gate | `<div data-cloud="gke">` | Lab mode | `LabRenderer.jsx` |
| Collapsible section | `<details class="lab-section">` + `## H2` in `<summary>` | Anywhere | `content.css` |
| Choice picker + gate | `<div data-choice-picker="os">` / `<div data-choice="os:linux">` | Anywhere | `ChoicePicker.jsx` |
| Detection matrix | `<div data-detection-matrix="Chip,Chip">` around a table | Anywhere | `DetectionMatrix.jsx` |
| Argo CD UI mockup | `<div data-argo-mock="new-app"></div>`, `"yaml-editor"`, `"sync"`, or `"sync-panel"` | Anywhere | `ArgoMockup.jsx` |
| Expandable image | Any markdown image (`![alt](/images/...)`) | Anywhere | `Expandable.jsx` |
| In-page link | `[text](#heading-slug)` | Anywhere | `LabRenderer.jsx` + `lib/scrollToId.js` |
| Variable substitution | `{{CLUSTER_NAME}}`, `{{REGION}}` | Code blocks | `LabRenderer.jsx` |
| Editable placeholder | `<NAME>` or `<NAME:default>` | Code blocks | `CodeBlock.jsx` |
| Checkboxes | `- [ ] text` | Lab mode | `useProgress.js` |
| Callouts | `> **Lede:** text` | Anywhere | `LabRenderer.jsx` |
| Hover tooltip | `<span data-tip="detail">term</span>` | Anywhere (Prerequisites especially) | `LabRenderer.jsx` + `content.css` |
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
| `#@choice=` | `key:option` from the Choice picker table (comma list of options means any match), for example `#@choice=secrets:k8s` |
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

## Test-target picker (EC2 or Fargate)

`<div data-test-target-picker></div>` renders a "Test the app on: Fargate (sidecar) / EC2 (DaemonSet)" toggle (default Fargate, stored in localStorage). Wrap each variant in `<div data-test-target="fargate">` or `"ec2"` (comma list means any match), with blank lines after the opening tag and before `</div>`. Gates can nest inside `data-profile` blocks, so a cleanup step can vary by both. Used in `kubernetes/helm-daemonset/eks-hybrid/lab.md` (Quick Deploy step 7 and Full Lab section 6) because a hybrid cluster protects the same test app differently on each compute type. The two values are hardcoded in `TestTarget.jsx`; extend that file to reuse the pattern for another choice.

## Fill-in panel

`<div data-fill-fields="FALCON_CID:CID (with checksum),AWS_REGION:AWS region"></div>` renders a labeled form for shared `<NAME>` placeholders so the reader enters them once, outside any copy block. Format is `NAME:Label` pairs separated by commas (no commas inside a label). Add `|target-id` after a label (`EXECUTION_ROLE_ARN:Execution role ARN|execution-role-help`) to turn it into a hover tooltip that jumps to the element with that `id` and opens it if it is a `<details>`; use `<details id="execution-role-help">` for the target. The inputs read and write the same values as inline `<NAME>` fields, so every code block using that name updates live. Names containing `SECRET`, `PASSWORD`, `TOKEN`, or `PRIVATE` render as password inputs and are never saved. Keep secrets in an `export` line below the panel, since a secret placeholder still needs to land in a shell variable. Also list the secret as a field in the panel (`FALCON_CLIENT_SECRET:API client secret`) so the reader enters every credential in one place and cannot miss it; the `export` block below then picks up what they typed.

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

## Collapsible sections and in-page links

Wrap a long H2 section so it starts closed:

```markdown
<details class="lab-section">
<summary>

## Linux

</summary>

### First sample
...

</details>
```

Blank lines around the `## H2` inside `<summary>` are required, so it still renders as a heading with an `id` and shows in the TOC. Link to any heading with `[text](#heading-slug)` (the slug is the lowercased heading text with punctuation removed and spaces turned into `-`). The router owns the URL hash, so these links scroll instead of navigating. Inside a section, wrap each item in `<details class="detection-card">` with its `### H3` in the `<summary>` (same blank-line rule) to get a collapsible card per item; an open card gets a red left border. Both in-page links and TOC clicks open every closed section and card that holds the target first. Example: `detections/quick-detection-samples.md`.

## Choice picker (OS, Linux distribution)

`<div data-choice-picker="KEY"></div>` renders a segmented toggle; `<div data-choice="KEY:option">` shows its contents only while that option is selected (comma list means any match). Blank lines after the opening tag and before `</div>` are required. Keys and options live in `CHOICES` in `ChoicePicker.jsx`:

| Key | Options | Default |
|-----|---------|---------|
| `os` | `windows`, `linux` | `linux` |
| `distro` | `debian` (Debian / Ubuntu), `rhel` (RHEL / Fedora), `amazon` (Amazon Linux) | `debian` |
| `argo` | `ui` (Argo CD UI), `cli` (Argo CD CLI) | `ui` |
| `secrets` | `inline` (values in the Application), `k8s` (Kubernetes Secrets) | `inline` |
| `falconcloud` | `commercial`, `govcloud-1`, `govcloud-2` | `commercial` |
| `ecrrepo` | `new`, `existing` | `new` |
| `runfrom` | `local` (My terminal), `pipeline` (CI pipeline) | `local` |

Every picker for a key shares one value, saved in localStorage, so the reader picks once and every gated block on the page (and on other pages) follows. Put one picker per key at the top of a section or card, not before every step. Gate shared steps with a comma list (`distro:rhel,amazon`). Once a step is gated, drop any prose that only explains another option ("on Linux use `-c`", "on Amazon Linux use dnf instead"); the reader never sees the other variant. Use it instead of stacking `Debian / Ubuntu:` / `RHEL:` labels over two blocks: each step then stays one visible block. Gates nest, so wrap the `distro` picker in `<div data-choice="os:linux">` when the card also has an `os` picker. Add a new key to `CHOICES` to reuse the pattern for another choice. Example: `detections/quick-detection-samples.md`.

## Detection matrix

Wrap a markdown table in `<div data-detection-matrix="Sensor health,Ransomware,...">` (blank lines inside the div are required) to render it as a filterable matrix: a search box, one-click use-case chips (the attribute value), Platform and Outcome toggles, and one dot column per platform. The table must have exactly these columns, in order:

| Column | Format |
|--------|--------|
| Sample | `[Name](#heading-slug)` linking to the sample's `### H3` |
| Platforms | Comma list of `Windows`, `Linux`, `macOS`, `Container` |
| Severity | `Critical`, `High`, `Medium`, `Low`, `Informational`, or free text |
| Result | `Detect`, `Blocked`, or `Killed` (Blocked/Killed count as Prevent) |
| Tactic | Shown under the sample name |
| Use cases | Comma list of use-case keywords, searched but not shown |

Search matches every word: fuzzily against the sample name (typos work), and as a substring against tactic, use cases, platform, and result. Chips set the search to their text, so each chip should appear in the Use cases of the rows it should match. Example: `detections/quick-detection-samples.md`.

## Argo CD UI mockups and expandable images

`<div data-argo-mock="new-app"></div>` renders a vector replica of the real Argo CD v3.4.5 **+ NEW APP** panel with **EDIT AS YAML**; `"yaml-editor"` shows the YAML editor with **SAVE** / **CREATE**; `"sync"` shows the `falcon-platform` tile before and after sync; `"sync-panel"` shows the **SYNCHRONIZE** slide-in. Numbered badges mark click order. They are drawn in code (not screenshots), use fixed Argo colors in both site themes (the real product does not theme), and stay sharp at any size. Add another mock by adding an entry to `MOCKS` in `ArgoMockup.jsx`. Example: `kubernetes/argocd/helm-application/lab.md`.

Every mockup, and every markdown image, gets an expand button (top right on hover) that opens a full-screen view; Esc, the close button, or a click outside closes it. Images whose path starts with `/images/` load from `webapp/public/images/`. Prefer a vector mockup over a raster screenshot for UI walkthroughs.

## Hover tooltips (terse prerequisites)

Keep visible text straight to the point and move the detail into a tooltip: `<span data-tip="detail text">key term</span>`. The reader sees a dotted underline; hover or keyboard focus shows the bubble. Required for every bullet in the **Prerequisites** blockquote; use it elsewhere for one-off definitions that would otherwise clutter a sentence.

- Put it on the most informative word (tool name, scope group, credential), one per bullet, 1-2 short sentences.
- Plain text only: no markdown, backticks, newlines, or double quotes (use single quotes; write `&amp;` for `&`). It is an HTML attribute, so none of it is rendered as markdown.
- Never hide a hard requirement or a command the reader must run only in a tooltip. Tooltips are for "how to check" and "why", not the requirement itself.
- Tooltip text is not part of the callout classifier's input, so it can safely contain words like "check" or "warning".
- Touch devices have no hover; the span is focusable, so a tap shows it.

## Diagrams

1. Add a fenced block (no language) with box-drawing or keyword text unique to this lab.
2. In `webapp/src/components/FlowDiagram.jsx`, copy the closest builder: `buildK8sDaemonsetDiagram` (standard cluster), `buildEksHybridDiagram` (sidecar plus node DaemonSet), `buildGkeAutopilotDiagram` (admission gate), `buildCloudRunPipelineDiagram` (build or deploy pipeline).
3. Add a `text.includes(...)` route in `buildDiagramFromContent()`, more specific matches first.
4. Do not add a second expand button, and add a `[data-theme="light"]` override for any new node variant (see `webapp/CLAUDE.md`).

## Registering a new lab

In `webapp/src/content/manifest.js`: add the `?raw` import and `labs` map entry, a `LABS` entry, and at least one nav placement under a cloud (steps in `webapp/CLAUDE.md`, "Adding a New Lab"). Until `modernized: true` is set the lab shows as Legacy or Roadmap. Then run `npm run build` in `webapp/`.

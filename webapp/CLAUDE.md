# Webapp — Falcon Cloud Security Labs Portal

Interactive React webapp that renders the repo's `lab.md` files as a polished documentation site mirroring the CrowdStrike Developer Center design.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Build | Vite 6 |
| UI | React 19 + React Router v7 (HashRouter) |
| Markdown | react-markdown v10 + remark-gfm + rehype-raw |
| Diagrams | @xyflow/react (React Flow v12) |
| Syntax | highlight.js (manual language registration) |
| Styling | CSS custom properties (no Tailwind) |
| State | localStorage (checkbox progress) |
| Deploy | GitHub Pages (static, HashRouter for SPA) |

## Architecture

```
src/
├── main.jsx              ← Entry, HashRouter wrap
├── App.jsx               ← Routes (sections/groups/leaves from manifest)
├── content/
│   └── manifest.js       ← Central registry: imports, tree structure, status detection
├── components/
│   ├── Layout.jsx        ← Grid shell: header + sidebar + content + TOC + ThemeToggle
│   ├── Sidebar.jsx       ← Collapsible tree nav (recursive)
│   ├── LabRenderer.jsx   ← Markdown → interactive page (custom renderers)
│   ├── CodeBlock.jsx     ← Terminal dots + copy button + highlight.js
│   ├── FlowDiagram.jsx   ← ASCII art → React Flow diagrams (with built-in expand button)
│   ├── ThemeToggle.jsx   ← 32×32 header button, sun/moon SVG, toggles data-theme
│   ├── TableOfContents.jsx ← Right-side scroll-spy TOC
│   ├── ReadingProgress.jsx ← Scroll progress bar under header
│   ├── OverviewPage.jsx  ← Category landing pages with card grid
│   ├── ProgressBar.jsx   ← Global completion bar
│   ├── StatusBadge.jsx   ← Complete/Stub/Empty indicators
│   └── LabDisclaimer.jsx ← Maintainer disclaimer auto-rendered on every lab
├── hooks/
│   ├── useProgress.js    ← localStorage checkbox persistence
│   ├── useTheme.js       ← Theme state: localStorage.theme + prefers-color-scheme fallback, applies data-theme to <html>
│   └── useHeadings.js    ← Extract h2/h3 from DOM for TOC
└── styles/
    ├── global.css        ← @font-face (Sharp Sans), :root tokens, [data-theme="light"] overrides, layout grid, header, ThemeToggle, prefers-reduced-motion guard
    ├── sidebar.css       ← Nav tree, arrows, status dots
    ├── content.css       ← Prose, callouts, TOC, cards, inline code, lab variables, mode toggle
    └── code-blocks.css   ← Terminal blocks, syntax colors, React Flow diagram styles + [data-theme="light"] diagram overrides
```

Fonts live in `public/fonts/` (7 Sharp Sans WOFF2 weights). Brand logos live in `public/logos/` (Red Falcon for dark theme, Black Falcon for light).

## Content Loading

Lab markdown files live in the parent repo (not in `webapp/`). They're imported at build time as raw strings:

```js
import content from '@content/path/to/lab.md?raw'
```

The `@content` alias resolves to the repo root (`..`). Vite's `server.fs.allow` permits access. All imports are explicit in `manifest.js` — no dynamic glob.

## Adding a New Lab

1. Create `lab.md` in the appropriate repo folder
2. In `src/content/manifest.js`:
   - Add the import: `import newLab from '@content/category/method/lab.md?raw'`
   - Add to `labs` map: `'category/method': newLab`
   - Add to the tree in `manifest`: `lab('method', 'Friendly Name', 'category/method')`
3. The status (complete/stub/empty) is auto-detected from content

Do NOT paste the maintainer disclaimer into `lab.md` — `LabRenderer` auto-injects `<LabDisclaimer />` at the top of the content area (above the H1 title, and below the status badge on stubs). Edit `LabDisclaimer.jsx` to change the wording.

## Adding a New Diagram

ASCII diagrams in code blocks are auto-detected by `isAsciiDiagram()` (checks for box-drawing chars + arrows). For known diagrams, add a named builder function in `FlowDiagram.jsx`:

```js
function buildMyDiagram(text) {
  const nodes = [ /* { id, position, data, type: 'custom', style } */ ]
  const edges = [ /* { id, source, target, type: 'smoothstep', style, label } */ ]
  return { nodes, edges }
}
```

Then add detection in `buildDiagramFromContent()`:
```js
if (text.includes('unique string')) return buildMyDiagram(text)
```

Node data supports: `label`, `sublabel`, `isContainer`, `isCloud`, `isPhase`, `isApi`, `items[]`

## Custom Markdown Renderers (LabRenderer.jsx)

| Element | Behavior |
|---------|----------|
| `code` blocks | ASCII diagrams → FlowDiagram; otherwise → CodeBlock with highlight.js |
| `input[checkbox]` | Persistent via localStorage, keyed by `labRoute:index` |
| `li` (task list) | Styled with strikethrough on complete |
| `blockquote` | Auto-classified into callout variants by content keywords |
| `h1/h2/h3` | Get slugified `id` for TOC anchors |

## Callout Variants

Blockquotes are auto-classified by matching text content. Every `.callout--*` rule lives under `.content-area .callout--*` so it wins the specificity fight against the base blockquote rule — do NOT drop that `.content-area` scope when adding new variants, or the base's red will override the variant color.

| Variant | Trigger keywords (case-insensitive, any position) | Color |
|---------|-----------------|-------|
| `info` | "what & why", "how this works" | Blue (`--accent-blue`) |
| `tip` | "tip:", "why this matters" | Teal (`--accent-teal`) — SE teaching notes |
| `warning` | "warning", "caution", "important", "heads-up", ⚠️ | Yellow (`--accent-yellow`) |
| `danger` | "destructive", "do not", "costs money", "deletes all", "irreversible" | Red (`--cs-red`, 10% tint) — reserved for destructive/high-cost actions |
| `success` | "verify", "look for", "confirm", "check" | Green (`--accent-green`) |
| `note` | "prerequisites", "status", "note" | Purple (`#a371f7`) |
| `time` | "~X min" | Neutral gray |

Classifier order (in `LabRenderer.jsx` blockquote handler) goes most-specific → most-broad: `danger` → `tip` → `info` → `warning` → `success` → `note` → `time`. **Default fallback is `info` (blue), NOT red** — red is reserved for the explicit `danger` variant only. If you add a new variant, insert its regex ahead of the broader ones so it isn't swallowed.

**Authoring guidance for which pattern lab writers should use lives in the repo root `CLAUDE.md`** (Callout Patterns section) — this section documents the renderer/CSS side only.

## Design System — CrowdStrike Mode A brand

The webapp uses the **Mode A** direction from `~/projects/claude_skillz/frontend-design`: dark-first, warm-tinted, CrowdStrike red (`#ED1C24`) as the sole chromatic accent. Every color in the app comes from a CSS custom property so light/dark themes work automatically — **never hardcode a color in a new component unless it's inside a code block** (see rule below).

### Design tokens (see `global.css :root` for the full list)

| Token | Dark | Light | Purpose |
|-------|------|-------|---------|
| `--bg-primary` | `#171520` | `#f8f6f3` | Page background |
| `--bg-card` | `#23202e` | `#ffffff` | Cards, panels, table headers |
| `--bg-sidebar` | `#13111c` | `#f4f2ef` | Sidebar, header |
| `--bg-code` | `#12101a` | `#12101a` | **Stays dark in both themes** (brand rule) |
| `--text-primary` | `#dcd8e8` | `#2d2a36` | Body text |
| `--text-bright` | `#f0ecfa` | `#1a1724` | H1/H2/H3, emphasized text |
| `--text-muted` | `#8f8a9e` | `#6b6675` | Muted/secondary text |
| `--border` | `#2e2a3a` | `#e5e0d8` | Card + input borders |
| `--cs-red` | `#ED1C24` | `#ED1C24` | Brand red — CTAs, active states, brand moments only |
| `--accent-green` | `#34d27b` | same | Success semantics |
| `--accent-blue` | `#5b9cf5` | same | Info + links |
| `--accent-yellow` | `#f0a830` | same | Warning semantics |
| `--accent-teal` | `#3ecfba` | same | Tip / SE teaching-note semantics |
| `--radius-{sm,md,lg,xl}` | `6/10/14/20px` | same | Consistent corner rounding |
| `--motion-{fast,normal,slow}` | `150/250/400ms` | same | Consistent easing |
| `--font-body` | `'CrowdStrike Sharp Sans', 'Inter', system-ui` | same | Sans typography |
| `--font-mono` | `'JetBrains Mono', 'Fira Code', ui-monospace` | same | Code + inputs |

Legacy aliases (`--accent`, `--bg`, `--nav-bg`, `--text`, `--code-bg`, `--card-border`, `--success`, `--warning`) map onto the new tokens so older selectors don't need renaming.

### Theming rules — CRITICAL when adding any new component or CSS

1. **Use tokens, never hex.** Every color, radius, and motion value goes through a CSS custom property. If a property doesn't exist yet, add one to `:root` + `[data-theme="light"]` rather than hardcoding.
2. **Code blocks stay dark in BOTH themes.** `.code-block` uses `var(--bg-code)` which does NOT flip in light mode — this is intentional per the brand skill. Inside code blocks it's fine to use hardcoded light foreground colors (e.g. highlight.js tokens `#ff7b72`, `#a5d6ff`) because the surface is always dark.
3. **Everything else must flip.** If your component uses a dark surface, ensure the paired text color is theme-aware. The bug we hit: `background: var(--bg-code)` + `color: var(--text-bright)` = dark-on-dark in light mode because `--text-bright` flips to near-black. Fix: use `var(--bg-card)` (theme-aware) OR pair a fixed dark bg with a fixed light text (`.code-block` pattern).
4. **FlowDiagrams need explicit light-theme overrides.** React Flow markup is populated at runtime and doesn't inherit page colors. All `.flow-*` selectors in `code-blocks.css` have a matching `[data-theme="light"] .flow-*` block. **If you add new node variants, add both dark defaults AND a light override.**
5. **`prefers-reduced-motion` is respected globally** — animations/transitions collapse to `0.01ms` when the user opts out. New components using `transition:` will inherit this automatically; no per-component work needed.
6. **`prefers-color-scheme` seeds first-visit theme.** `useTheme` reads `localStorage.theme` first, falls back to the OS setting. Once the user toggles, their choice sticks across reloads.

### Where things live

| Concern | File |
|---------|------|
| Tokens + font-face + reduced-motion guard + `[data-theme="light"]` block | `global.css` |
| Prose (h1/h2/h3, tables, callouts, inline code, cards, TOC, checkboxes, lab-vars, mode toggle) | `content.css` |
| Sidebar nav | `sidebar.css` |
| Code blocks + FlowDiagram + light-theme diagram overrides | `code-blocks.css` |
| `useTheme` hook (localStorage + matchMedia + `data-theme` on `<html>`) | `hooks/useTheme.js` |
| ThemeToggle button (32×32, sun/moon SVG, header) | `components/ThemeToggle.jsx` |

### Adding a new visual pattern — checklist

- [ ] Class name follows BEM-ish convention: `.thing`, `.thing__part`, `.thing--modifier`
- [ ] Every color / radius / motion value references a token
- [ ] If it introduces a new surface, verify contrast in BOTH themes (toggle via header button)
- [ ] If it uses accent colors, prefer semantic tokens (`--accent-green` for success, etc.) over `--cs-red` — red is reserved for brand/CTA moments, not decoration
- [ ] If a token doesn't exist for what you need, add it to `:root` AND `[data-theme="light"]`
- [ ] Run `npm run build` before committing — bundle size delta should be minimal (<2KB CSS for a small component)

## FlowDiagrams — expand + theming rules

Every FlowDiagram automatically gets:

1. **Expand button** (top-right, 28×28, glass surface) — click to enter a fixed-viewport overlay (`inset: 1rem`, `z-index: 200`). Esc key or ✕ button closes. Body scroll locks while open. React Flow re-fits view via `fitView()` on state change so nodes fill the new canvas size.
2. **Theme-aware surfaces** — dark defaults in `.flow-*` selectors, light overrides in `[data-theme="light"] .flow-*` selectors, both in `code-blocks.css`.
3. **Semantic node variants** with corresponding light overrides:
   - `isContainer` → red-outlined group container
   - `isCloud` → green accent (falcon platform / cloud services)
   - `isPhase` → dashed purple outline (workflow phases)
   - `isApi` → purple accent
   - `danger` → red accent (destructive / high-risk callouts)

**When adding a new node variant:** define the dark colors in the base `.flow-node--myvariant` rule AND add a matching `[data-theme="light"] .flow-node--myvariant` override, or the diagram will render dark ink on a cream card in light mode.

**Do NOT wrap or duplicate the expand button** in a new diagram builder — it's rendered by the shared `FlowDiagram` component wrapper, not per-builder.

## Commands

```bash
npm run dev      # Start dev server (localhost:5173+)
npm run build    # Production build to dist/
npm run preview  # Preview production build locally
```

## Do NOT

- Use Tailwind or any CSS framework — this is all custom properties
- Add new npm dependencies without good reason (the bundle is intentionally lean)
- Use dynamic imports for markdown (breaks GitHub Pages static deploy)
- Put lab content inside `webapp/` — content lives in the parent repo
- Add scrollbars (they're hidden globally by design)
- Use unicode escape sequences in JSX text (use CSS or actual unicode chars)
- **Hardcode colors, radii, motion durations, or font stacks in a new component** — always reference a token from `global.css`. If the token doesn't exist yet, add it to both `:root` AND `[data-theme="light"]`.
- **Use `var(--bg-code)` for anything other than actual code surfaces.** That token intentionally stays dark in both themes; pairing it with a theme-flipping text color creates dark-on-dark in light mode.
- **Use `--cs-red` decoratively.** Red is reserved for CTAs, active states, brand moments (logo, focus rings, active-tab highlight, checked checkbox). For status/info/warning/success, use the semantic accents (`--accent-green`, `--accent-blue`, `--accent-yellow`).
- **Add a new FlowDiagram node variant without a matching `[data-theme="light"]` override.** React Flow markup doesn't inherit page colors — new variants render dark-on-cream in light mode until you add the light-theme rule.
- **Duplicate the FlowDiagram expand button** in a diagram builder — the wrapper component adds it to every diagram automatically.

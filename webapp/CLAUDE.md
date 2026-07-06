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
│   ├── Layout.jsx        ← Grid shell: header + sidebar + content + TOC
│   ├── Sidebar.jsx       ← Collapsible tree nav (recursive)
│   ├── LabRenderer.jsx   ← Markdown → interactive page (custom renderers)
│   ├── CodeBlock.jsx     ← Terminal dots + copy button + highlight.js
│   ├── FlowDiagram.jsx   ← ASCII art → React Flow diagrams
│   ├── TableOfContents.jsx ← Right-side scroll-spy TOC
│   ├── ReadingProgress.jsx ← Scroll progress bar under header
│   ├── OverviewPage.jsx  ← Category landing pages with card grid
│   ├── ProgressBar.jsx   ← Global completion bar
│   └── StatusBadge.jsx   ← Complete/Stub/Empty indicators
├── hooks/
│   ├── useProgress.js    ← localStorage checkbox persistence
│   └── useHeadings.js    ← Extract h2/h3 from DOM for TOC
└── styles/
    ├── global.css        ← Design tokens, layout grid, header, responsive
    ├── sidebar.css       ← Nav tree, arrows, status dots
    ├── content.css       ← Prose, callouts, TOC, cards, progress bars
    └── code-blocks.css   ← Terminal blocks, syntax colors, React Flow diagram styles
```

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

Blockquotes are auto-classified by matching text content:

| Variant | Trigger keywords | Color |
|---------|-----------------|-------|
| `info` | "What & Why", "How this works" | Teal |
| `warning` | "warning", "caution", "important" | Orange |
| `success` | "Look for", "verify", "confirm" | Green |
| `note` | "Prerequisites", "Status", "Note" | Purple |
| `time` | "~X min" | Neutral gray |

## Design Tokens

Defined in `global.css :root`:
- Accent: `#61C4C9` (teal)
- Background: `#17181c`
- Nav/Sidebar: `#0d1117`
- Text: `#d0d0d5`
- Borders: `#212929`
- Code BG: `rgb(1, 4, 9)`
- Fonts: Inter (body), JetBrains Mono (code)

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

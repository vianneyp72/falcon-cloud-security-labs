import { useRef, useMemo, useContext, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { getLabContent, getLabMeta, getStatusKey } from '../content/manifest'
import { useProgress } from '../hooks/useProgress'
import { useHeadings } from '../hooks/useHeadings'
import { useLabVariables } from '../hooks/useLabVariables'
import { usePlaceholderValues } from '../hooks/usePlaceholderValues'
import { PlaceholderContext } from './placeholderContext'
import TableOfContents from './TableOfContents'
import CodeBlock from './CodeBlock'
import FlowDiagram, { isAsciiDiagram } from './FlowDiagram'
import StatusBadge from './StatusBadge'
import ModeToggle, { useModeToggle, contentHasMode, contentHasLabMode, resolveMode } from './ModeToggle'
import LabDisclaimer from './LabDisclaimer'
import LabVariables from './LabVariables'
import FillFields from './FillFields'
import RegistryChoice, { useRegistryChoice, registryMatches } from './RegistryChoice'
import DeployOptions, { useDeployOptions, markerMatches } from './DeployOptions'
import ProfileMethod, { useProfileMethod, profileMatches } from './ProfileMethod'
import { LabVarsContext } from './labVarsContext'

// Noop config passed to the hook when a lab has no variables — keeps hook order stable.
const NO_VARIABLES = { fields: [] }

// Stable module-level plugin arrays so react-markdown doesn't re-parse on every
// parent render.
const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeRaw]

function substituteTokens(content, values) {
  if (!content) return content
  let out = content
  for (const [key, val] of Object.entries(values)) {
    if (val === undefined || val === null) continue
    out = out.split(`{{${key}}}`).join(String(val))
  }
  return out
}

// Wrapper that subscribes to LabVarsContext and substitutes {{TOKEN}} in the
// code content on every values change. Kept as a separate component so the
// components map passed to <Markdown> stays stable across keystrokes and
// react-markdown doesn't rebuild its tree.
function TokenSubstitutingCodeBlock({ language, children }) {
  const ctx = useContext(LabVarsContext)
  const substituted = ctx?.values
    ? substituteTokens(children, ctx.values)
    : children
  return <CodeBlock language={language}>{substituted}</CodeBlock>
}

// Wrapper for `<div data-cloud="...">` blocks. Reads the selected cloud from
// context so it updates on CLOUD change without needing to be in the outer
// `components` deps (which would remount LabVariables and lose scroll-anchor
// state).
function CloudBlockGate({ cloud, children, ...props }) {
  const ctx = useContext(LabVarsContext)
  const selectedCloud = ctx?.values?.CLOUD
  if (selectedCloud && cloud !== selectedCloud) {
    return <div className="mode-content--hidden" />
  }
  return <div {...props}>{children}</div>
}

// Shows its children only when the reader's registry choice (RegistryChoice picker) matches.
function RegistryBlockGate({ registry, children, ...props }) {
  const choice = useRegistryChoice()
  if (!registryMatches(registry, choice)) {
    return <div className="mode-content--hidden" />
  }
  return <div {...props}>{children}</div>
}

// Shows its children only when the reader's Additional settings (DeployOptions picker) match,
// e.g. data-opt="kac" hides a block when KAC is unchecked.
function OptBlockGate({ opt, children, ...props }) {
  const deploy = useDeployOptions()
  if (!markerMatches('opt', opt, deploy)) {
    return <div className="mode-content--hidden" />
  }
  return <div {...props}>{children}</div>
}

// Shows its children only when the reader's ProfileMethod choice (console | eksctl) matches.
function ProfileBlockGate({ profile, children, ...props }) {
  const [method] = useProfileMethod()
  if (!profileMatches(profile, method)) {
    return <div className="mode-content--hidden" />
  }
  return <div {...props}>{children}</div>
}

// Per-line gating inside a code block: trailing `#@registry=<gate>`, `#@region=<gate>` or
// `#@opt=<gate>` markers (stackable, all must match) keep the line with the markers stripped,
// otherwise the line is dropped.
const LINE_MARKER_RE = /\s*#@(registry|region|opt)=(\S+)\s*$/
function RegistryFilteredCodeBlock({ language, hasVariables, children }) {
  const registry = useRegistryChoice()
  const deploy = useDeployOptions()
  const filtered = children
    .split('\n')
    .flatMap(line => {
      let rest = line
      let keep = true
      let m
      while ((m = LINE_MARKER_RE.exec(rest))) {
        const [, kind, gate] = m
        if (kind === 'registry' ? !registryMatches(gate, registry) : !markerMatches(kind, gate, deploy)) keep = false
        rest = rest.slice(0, m.index)
      }
      return keep ? [rest] : []
    })
    .join('\n')
  const Block = hasVariables ? TokenSubstitutingCodeBlock : CodeBlock
  return <Block language={language}>{filtered}</Block>
}

export default function LabRenderer({ labKey: route }) {
  const rawContent = getLabContent(route)
  const meta = getLabMeta(route)
  // Progress, variables and placeholders are keyed by the canonical lab id so
  // every nav placement of the same lab (e.g. AWS/Azure/GCP -> Standard) shares state.
  const labKey = meta?.id || route
  const contentRef = useRef(null)
  const { isChecked, toggleCheckbox } = useProgress()
  const [storedMode, setActiveMode] = useModeToggle()
  const activeMode = resolveMode(rawContent, storedMode)
  const varsConfig = meta?.variables || NO_VARIABLES
  const { values: varValues, setValue: setVarValue, resetToDefaults: resetVars } =
    useLabVariables(labKey, varsConfig)
  const placeholders = usePlaceholderValues(labKey)
  const hasVariables = !!meta?.variables
  const showVariablesPanel = hasVariables &&
    (!meta.variables.modes || meta.variables.modes.includes(activeMode))
  const content = rawContent
  const headings = useHeadings(contentRef, content, activeMode)
  const checkboxIndex = useRef(0)
  const hasMode = contentHasMode(content)
  const hasLabMode = contentHasLabMode(content)

  // Landing on a cloud-specific placement (AWS -> EKS -> Standard) pre-selects that cloud
  // once per visit, without overriding a manual change made afterwards.
  const presetApplied = useRef(null)
  useEffect(() => {
    if (!meta?.cloudPreset || !hasVariables) return
    if (presetApplied.current === route) return
    presetApplied.current = route
    if (varValues.CLOUD !== meta.cloudPreset) setVarValue('CLOUD', meta.cloudPreset)
  }, [route, meta?.cloudPreset, hasVariables, varValues.CLOUD, setVarValue])

  // Reset checkbox index on each render
  checkboxIndex.current = 0

  // Live values + setters flow to LabVariables and TokenSubstitutingCodeBlock
  // via context so they can update on keystroke without changing the
  // `components` reference passed to <Markdown> (which would remount the
  // text input and lose focus).
  const labVarsContextValue = useMemo(() => (
    hasVariables
      ? {
          config: meta?.variables,
          values: varValues,
          setValue: setVarValue,
          resetToDefaults: resetVars,
        }
      : null
  ), [hasVariables, meta?.variables, varValues, setVarValue, resetVars])

  // Memoize components with only STRUCTURAL deps — NOT varValues. Live values
  // are consumed inside child components via LabVarsContext. This keeps every
  // renderer function reference stable across keystrokes so react-markdown's
  // element types stay identical → no remount → input keeps focus.
  const components = useMemo(() => ({
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '')
      const codeContent = String(children).replace(/\n$/, '')
      if (!inline && (match || codeContent.includes('\n'))) {
        if (isAsciiDiagram(codeContent)) {
          return <FlowDiagram content={codeContent} />
        }
        if (/#@(registry|region|opt)=/.test(codeContent)) {
          return (
            <RegistryFilteredCodeBlock language={match ? match[1] : ''} hasVariables={hasVariables}>
              {codeContent}
            </RegistryFilteredCodeBlock>
          )
        }
        if (hasVariables) {
          return (
            <TokenSubstitutingCodeBlock language={match ? match[1] : ''}>
              {codeContent}
            </TokenSubstitutingCodeBlock>
          )
        }
        return (
          <CodeBlock language={match ? match[1] : ''}>
            {codeContent}
          </CodeBlock>
        )
      }
      return <code className={className} {...props}>{children}</code>
    },
    pre({ children }) {
      return <>{children}</>
    },
    div({ node, children, ...props }) {
      const dataMode = node?.properties?.dataMode
      const dataCloud = node?.properties?.dataCloud
      const dataLabVariables = node?.properties?.dataLabVariables !== undefined
      if (dataLabVariables) {
        return showVariablesPanel ? <LabVariables /> : null
      }
      if (node?.properties?.dataRegistryPicker !== undefined) {
        return <RegistryChoice />
      }
      if (node?.properties?.dataDeployOptions !== undefined) {
        return <DeployOptions />
      }
      if (node?.properties?.dataProfilePicker !== undefined) {
        return <ProfileMethod />
      }
      if (node?.properties?.dataFillFields) {
        return <FillFields spec={node.properties.dataFillFields} derive={node.properties.dataFillDerive} />
      }
      if (dataMode && dataMode !== activeMode) {
        return <div className="mode-content--hidden" />
      }
      const dataRegistry = node?.properties?.dataRegistry
      if (dataRegistry) {
        return <RegistryBlockGate registry={dataRegistry} {...props}>{children}</RegistryBlockGate>
      }
      const dataProfile = node?.properties?.dataProfile
      if (dataProfile) {
        return <ProfileBlockGate profile={dataProfile} {...props}>{children}</ProfileBlockGate>
      }
      const dataOpt = node?.properties?.dataOpt
      if (dataOpt) {
        return <OptBlockGate opt={dataOpt} {...props}>{children}</OptBlockGate>
      }
      if (dataCloud) {
        return <CloudBlockGate cloud={dataCloud} {...props}>{children}</CloudBlockGate>
      }
      return <div {...props}>{children}</div>
    },
    input({ type, checked, disabled, node, ...props }) {
      if (type === 'checkbox') {
        const idx = checkboxIndex.current++
        const key = hasMode ? `${labKey}:${activeMode}:${idx}` : `${labKey}:${idx}`
        const isComplete = isChecked(key)
        return (
          <input
            type="checkbox"
            checked={isComplete}
            onChange={() => toggleCheckbox(key)}
          />
        )
      }
      return <input type={type} checked={checked} disabled={disabled} {...props} />
    },
    li({ node, children, className, ...props }) {
      // Check if this li contains a checkbox (task list item)
      const hasCheckbox = node?.properties?.className?.includes('task-list-item') ||
        (node?.children?.[0]?.tagName === 'input' ||
         (node?.children?.[0]?.type === 'element' && node?.children?.[0]?.tagName === 'p' &&
          node?.children?.[0]?.children?.[0]?.tagName === 'input'))

      if (hasCheckbox) {
        const idx = checkboxIndex.current // peek (input renderer will increment)
        const key = hasMode ? `${labKey}:${activeMode}:${idx}` : `${labKey}:${idx}`
        const isComplete = isChecked(key)
        return (
          <li className={`lab-checkbox ${isComplete ? 'checked' : ''}`} {...props}>
            {children}
          </li>
        )
      }
      return <li className={className} {...props}>{children}</li>
    },
    blockquote({ children, ...props }) {
      const text = getTextContent(children)
      let variant = 'info'
      // Order matters: most-specific / highest-impact triggers first.
      if (/destructive|do\s*not|costs\s+money|deletes\s+all|irreversible/i.test(text)) variant = 'danger'
      else if (/(^|\s)tip:|why this matters/i.test(text)) variant = 'tip'
      else if (/what\s*&\s*why|how this works/i.test(text)) variant = 'info'
      else if (/⚠️|warning|caution|important|heads-up|heads\s+up/i.test(text)) variant = 'warning'
      else if (/verify|look for|confirm|check/i.test(text)) variant = 'success'
      else if (/prerequisites|status|note/i.test(text)) variant = 'note'
      else if (/~\d+\s*min/i.test(text)) variant = 'time'
      return <blockquote className={`callout callout--${variant}`} {...props}>{children}</blockquote>
    },
    h1({ children, ...props }) {
      const id = slugify(children)
      return <h1 id={id} {...props}>{children}</h1>
    },
    h2({ children, ...props }) {
      const id = slugify(children)
      const text = typeof children === 'string' ? children : Array.isArray(children)
        ? children.map(c => (typeof c === 'string' ? c : '')).join('') : ''
      if (hasMode && hasLabMode && /deployment steps/i.test(text)) {
        return (
          <>
            <ModeToggle activeMode={activeMode} setActiveMode={setActiveMode} />
            <h2 id={id} {...props}>{children}</h2>
          </>
        )
      }
      return <h2 id={id} {...props}>{children}</h2>
    },
    h3({ children, ...props }) {
      const id = slugify(children)
      return <h3 id={id} {...props}>{children}</h3>
    },
  }), [
    activeMode,
    hasMode,
    hasLabMode,
    hasVariables,
    showVariablesPanel,
    labKey,
    isChecked,
    toggleCheckbox,
    setActiveMode,
  ])

  if (!content || content.trim().length === 0) {
    return (
      <>
        <main className="content-area" ref={contentRef}>
          <h1>{meta?.label || 'Lab'}</h1>
          <StatusBadge meta={meta} />
          <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>
            This lab has not been written yet.
          </p>
        </main>
        <aside className="toc-aside" />
      </>
    )
  }

  if (meta?.contentKind === 'stub') {
    return (
      <>
        <main className="content-area" ref={contentRef}>
          <StatusBadge meta={meta} />
          <LabDisclaimer />
          <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
            {content}
          </Markdown>
        </main>
        <aside className="toc-aside" />
      </>
    )
  }

  return (
    <>
      <main className="content-area" ref={contentRef}>
        <LabDisclaimer />
        {getStatusKey(meta) === 'legacy' && (
          <blockquote className="callout callout--warning">
            <p>
              <strong>Legacy:</strong> this lab has not been updated to the current lab standard yet
              and is queued on the <Link to="/roadmap">modernization roadmap</Link>. Steps may be out of date.
            </p>
          </blockquote>
        )}
        <LabVarsContext.Provider value={labVarsContextValue}>
          <PlaceholderContext.Provider value={placeholders}>
            <Markdown
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={REHYPE_PLUGINS}
              components={components}
            >
              {content}
            </Markdown>
          </PlaceholderContext.Provider>
        </LabVarsContext.Provider>
      </main>
      <TableOfContents headings={headings} />
    </>
  )
}

function slugify(children) {
  const text = typeof children === 'string'
    ? children
    : Array.isArray(children)
      ? children.map(c => (typeof c === 'string' ? c : c?.props?.children || '')).join('')
      : ''
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

function getTextContent(children) {
  if (typeof children === 'string') return children
  if (!children) return ''
  if (Array.isArray(children)) {
    return children.map(c => getTextContent(c)).join('')
  }
  if (children.props?.children) {
    return getTextContent(children.props.children)
  }
  return ''
}

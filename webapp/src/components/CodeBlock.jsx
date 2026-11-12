import { useState, useContext, useMemo, Fragment, createElement } from 'react'
import { PlaceholderContext } from './placeholderContext'
import { isSecretName } from '../hooks/usePlaceholderValues'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import yaml from 'highlight.js/lib/languages/yaml'
import json from 'highlight.js/lib/languages/json'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import python from 'highlight.js/lib/languages/python'
import hcl from 'highlight.js/lib/languages/go'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('json', json)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('python', python)
hljs.registerLanguage('hcl', hcl)
hljs.registerLanguage('terraform', hcl)
hljs.registerLanguage('tf', hcl)

const PLACEHOLDER_RE = /<([A-Z][A-Z0-9_]*)(?::([^<>\s"']*))?>/g
const SENTINEL_RE = /ZZPHZ(\d+)ZZ/g
const SENTINEL_SPLIT = /ZZPHZ(\d+)ZZ/

// Swap each <NAME> / <NAME:default> for an alphanumeric sentinel so highlight.js
// sees ordinary text; the sentinels become inline inputs after highlighting.
function parsePlaceholders(source) {
  const tokens = []
  const text = source.replace(PLACEHOLDER_RE, (match, name, def) => {
    tokens.push({ name, def: def ?? '', match })
    return `ZZPHZ${tokens.length - 1}ZZ`
  })
  return { text, tokens }
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlight(text, language) {
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(text, { language }).value
    }
    return hljs.highlightAuto(text).value
  } catch {
    return escapeHtml(text)
  }
}

// Highlighted HTML -> plain tree, so placeholder text can be swapped for React inputs.
// <template> (unlike DOMParser) keeps leading whitespace.
function htmlToTree(html) {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const walk = node => {
    if (node.nodeType === 3) return node.textContent
    if (node.nodeType === 1) {
      return {
        tag: node.tagName.toLowerCase(),
        cls: node.getAttribute('class'),
        kids: Array.from(node.childNodes).map(walk),
      }
    }
    return ''
  }
  return Array.from(tpl.content.childNodes).map(walk)
}

function renderTree(tree, renderToken) {
  return tree.map((node, i) => {
    if (typeof node === 'string') {
      const parts = node.split(SENTINEL_SPLIT)
      if (parts.length === 1) return node
      return (
        <Fragment key={i}>
          {parts.map((p, j) => (j % 2 ? renderToken(Number(p)) : p))}
        </Fragment>
      )
    }
    return createElement(
      node.tag,
      { key: i, className: node.cls || undefined },
      renderTree(node.kids, renderToken)
    )
  })
}

export default function CodeBlock({ language, children }) {
  const [copied, setCopied] = useState(false)
  const [localValues, setLocalValues] = useState({})
  const shared = useContext(PlaceholderContext)

  const { text, tokens } = useMemo(() => parsePlaceholders(children), [children])
  const tree = useMemo(
    () => (tokens.length ? htmlToTree(highlight(text, language)) : null),
    [text, tokens.length, language]
  )
  const plainHtml = useMemo(
    () => (tokens.length ? null : highlight(children, language)),
    [children, tokens.length, language]
  )

  const values = shared ? shared.values : localValues
  const setValue = shared
    ? shared.setValue
    : (name, value) => setLocalValues(prev => ({ ...prev, [name]: value }))

  const names = [...new Set(tokens.map(t => t.name))]
  const modified = tokens.some(t => values[t.name] !== undefined && values[t.name] !== t.def)

  const handleReset = () => {
    if (shared) {
      shared.reset(names)
    } else {
      setLocalValues({})
    }
  }

  const handleCopy = async () => {
    const out = text.replace(SENTINEL_RE, (_, i) => {
      const t = tokens[Number(i)]
      return values[t.name] || t.def || t.match
    })
    await navigator.clipboard.writeText(out)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const renderToken = i => {
    const t = tokens[i]
    const value = values[t.name] ?? t.def
    const hint = t.def || t.name
    return (
      <input
        key={`ph-${i}`}
        className="code-block__field"
        type={isSecretName(t.name) ? 'password' : 'text'}
        value={value}
        placeholder={hint}
        aria-label={t.name}
        spellCheck={false}
        autoComplete="off"
        style={{ width: `${Math.max(value.length, hint.length, 4) + 0.3}ch` }}
        onChange={e => setValue(t.name, e.target.value)}
      />
    )
  }

  return (
    <div className="code-block">
      <div className="code-block__header">
        <div className="code-block__dots">
          <span className="code-block__dot code-block__dot--red" />
          <span className="code-block__dot code-block__dot--yellow" />
          <span className="code-block__dot code-block__dot--green" />
        </div>
        <div className="code-block__actions">
          {language && <span className="code-block__lang">{language}</span>}
          {modified && (
            <button className="code-block__copy" onClick={handleReset}>
              Reset
            </button>
          )}
          <button
            className={`code-block__copy ${copied ? 'code-block__copy--copied' : ''}`}
            onClick={handleCopy}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      <pre>
        {tree ? (
          <code>{renderTree(tree, renderToken)}</code>
        ) : (
          <code dangerouslySetInnerHTML={{ __html: plainHtml }} />
        )}
      </pre>
    </div>
  )
}


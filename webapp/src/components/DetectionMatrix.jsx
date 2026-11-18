import { useMemo, useState } from 'react'
import { fuzzyMatch } from '../lib/fuzzy'
import { scrollToId } from '../lib/scrollToId'

// Filterable matrix for `<div data-detection-matrix="Chip,Chip">` wrapping a markdown table with
// columns: Sample (a [name](#anchor) link) | Platforms | Severity | Result | Tactic | Use cases.
// The table stays the source of truth (it still reads as a plain table on GitHub); this reads the
// rows from the hast node react-markdown hands us.

const PLATFORMS = ['Windows', 'Linux', 'macOS', 'Container']
const OUTCOMES = [
  { key: 'detect', label: 'Detect' },
  { key: 'prevent', label: 'Prevent' },
]

const text = n => (n.type === 'text' ? n.value : (n.children || []).map(text).join(''))
const find = (n, tag) => (n.tagName === tag ? n : (n.children || []).map(c => find(c, tag)).find(Boolean))
const findAll = (n, tag) => (n.tagName === tag ? [n] : (n.children || []).flatMap(c => findAll(c, tag)))
const split = s => s.split(',').map(x => x.trim()).filter(Boolean)

function parseRows(node) {
  const tbody = find(node, 'tbody')
  if (!tbody) return []
  return findAll(tbody, 'tr').map(tr => {
    const cells = findAll(tr, 'td')
    const link = find(cells[0], 'a')
    const [name, platforms, severity, result, tactic, useCases] = cells.map(c => text(c).trim())
    return {
      name,
      anchor: link?.properties?.href?.replace(/^#/, '') || '',
      platforms: split(platforms || ''),
      severity: severity || '',
      result: result || '',
      prevents: /block|kill/i.test(result || ''),
      tactic: tactic || '',
      useCases: split(useCases || ''),
    }
  })
}

// Every whitespace token must match. The sample name is matched fuzzily (typos still work); tactic
// and use cases are substring-only so short tokens don't smear across unrelated rows.
function matches(row, query) {
  const haystack = `${row.tactic} ${row.useCases.join(' ')} ${row.platforms.join(' ')} ${row.result}`
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(t => fuzzyMatch(t, row.name) || fuzzyMatch(t, haystack, { substringOnly: true }))
}

function Toggle({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`detection-matrix__toggle ${active ? 'detection-matrix__toggle--active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default function DetectionMatrix({ node, chips }) {
  const rows = useMemo(() => parseRows(node), [node])
  const chipList = useMemo(() => split(chips || ''), [chips])
  const [query, setQuery] = useState('')
  const [platforms, setPlatforms] = useState([])
  const [outcome, setOutcome] = useState('')

  const flip = (list, set, v) => set(list.includes(v) ? list.filter(x => x !== v) : [...list, v])

  const visible = useMemo(() => {
    // Filter only; keep page order (grouped by OS) so results stay easy to scan.
    return rows
      .filter(row => matches(row, query))
      .filter(row => !platforms.length || platforms.some(p => row.platforms.includes(p)))
      .filter(row => !outcome || (outcome === 'prevent') === row.prevents)
  }, [rows, query, platforms, outcome])

  const filtered = query || platforms.length || outcome
  const reset = () => {
    setQuery('')
    setPlatforms([])
    setOutcome('')
  }

  return (
    <div className="detection-matrix">
      <div className="detection-matrix__search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="What do you want to test? e.g. ransomware, credential theft, kubernetes"
          aria-label="Filter detection samples"
        />
      </div>

      {chipList.length > 0 && (
        <div className="detection-matrix__chips" role="group" aria-label="Common use cases">
          {chipList.map(c => (
            <Toggle
              key={c}
              active={query.toLowerCase() === c.toLowerCase()}
              onClick={() => setQuery(query.toLowerCase() === c.toLowerCase() ? '' : c)}
            >
              {c}
            </Toggle>
          ))}
        </div>
      )}

      <div className="detection-matrix__filters">
        <div className="detection-matrix__group" role="group" aria-label="Platform">
          <span className="detection-matrix__label">Platform</span>
          {PLATFORMS.map(p => (
            <Toggle key={p} active={platforms.includes(p)} onClick={() => flip(platforms, setPlatforms, p)}>
              {p}
            </Toggle>
          ))}
        </div>
        <div className="detection-matrix__group" role="group" aria-label="Outcome">
          <span className="detection-matrix__label">Outcome</span>
          {OUTCOMES.map(o => (
            <Toggle key={o.key} active={outcome === o.key} onClick={() => setOutcome(outcome === o.key ? '' : o.key)}>
              {o.label}
            </Toggle>
          ))}
        </div>
        <span className="detection-matrix__count">
          {visible.length} of {rows.length}
          {filtered && (
            <button type="button" className="detection-matrix__reset" onClick={reset}>
              Clear
            </button>
          )}
        </span>
      </div>

      <div className="detection-matrix__table-wrap">
        <table className="detection-matrix__table">
          <thead>
            <tr>
              <th>Sample</th>
              {PLATFORMS.map(p => (
                <th key={p} className="detection-matrix__platform">{p}</th>
              ))}
              <th>Severity</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(row => (
              <tr key={row.anchor || row.name}>
                <td>
                  <a
                    href={`#${row.anchor}`}
                    onClick={e => {
                      e.preventDefault()
                      scrollToId(row.anchor)
                    }}
                  >
                    {row.name}
                  </a>
                  <div className="detection-matrix__tactic">{row.tactic}</div>
                </td>
                {PLATFORMS.map(p => (
                  <td key={p} className="detection-matrix__platform">
                    {row.platforms.includes(p) ? (
                      <span className="detection-matrix__dot" title={`Runs on ${p}`} />
                    ) : (
                      <span className="detection-matrix__none" aria-label="Not applicable" />
                    )}
                  </td>
                ))}
                <td>
                  <span className={`detection-matrix__sev detection-matrix__sev--${row.severity.toLowerCase().split(/\s+/)[0]}`}>
                    {row.severity}
                  </span>
                </td>
                <td>
                  <span className={`detection-matrix__result ${row.prevents ? 'detection-matrix__result--prevent' : ''}`}>
                    {row.result}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && (
          <p className="detection-matrix__empty">
            No samples match. Try a broader term like <code>credential</code> or <code>prevention</code>, or{' '}
            <button type="button" className="detection-matrix__reset" onClick={reset}>clear the filters</button>.
          </p>
        )}
      </div>
    </div>
  )
}

import { useState, useRef, useMemo, useEffect, useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSearchIndex, getStatusKey } from '../content/manifest'
import { searchEntries } from '../lib/fuzzy'

function Highlight({ text, indices }) {
  if (!indices.length) return <span>{text}</span>
  const hit = new Set(indices)
  return (
    <span>
      {[...text].map((ch, i) =>
        hit.has(i) ? <mark key={i} className="search-result__mark">{ch}</mark> : ch
      )}
    </span>
  )
}

export default function SidebarSearch({ onNavigate }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const listId = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const results = useMemo(() => searchEntries(query, getSearchIndex()), [query])
  const hasQuery = query.trim().length > 0

  // "/" focuses the search from anywhere outside a text field.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const go = (entry) => {
    navigate(entry.to)
    setQuery('')
    inputRef.current?.blur()
    onNavigate?.()
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault()
      go(results[active].entry)
    } else if (e.key === 'Escape') {
      setQuery('')
      inputRef.current?.blur()
    }
  }

  return (
    <div className="sidebar-search">
      <div className="sidebar-search__field">
        <svg className="sidebar-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          className="sidebar-search__input"
          type="text"
          role="combobox"
          aria-expanded={hasQuery}
          aria-controls={listId}
          aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
          placeholder="Search labs"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        {hasQuery ? (
          <button className="sidebar-search__clear" onClick={() => setQuery('')} aria-label="Clear search" type="button">
            &times;
          </button>
        ) : (
          <kbd className="sidebar-search__hint">/</kbd>
        )}
      </div>

      {hasQuery && (
        <ul className="sidebar-search__results" id={listId} role="listbox">
          {results.length === 0 && <li className="sidebar-search__empty">No labs match "{query.trim()}"</li>}
          {results.map(({ entry, indices }, i) => (
            <li
              key={entry.to + entry.label}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`search-result ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(entry)}
            >
              <span className="search-result__label">
                {entry.kind === 'lab' && (
                  <span className={`sidebar-link__dot sidebar-link__dot--${getStatusKey(entry.meta)}`} />
                )}
                <Highlight text={entry.label} indices={indices} />
              </span>
              <span className="search-result__path">
                {entry.kind === 'group' ? 'Section · ' : ''}
                {entry.breadcrumb.join(' › ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

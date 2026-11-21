import { useContext, useState } from 'react'
import { PlaceholderContext } from './placeholderContext'

const TIP =
  'Grouping tags are the best way to scope host groups. A dynamic host group that matches on a tag picks up new hosts automatically and drops retired ones, so policies follow the workload. Grouping by hostname or hand-picking hosts breaks as instances are replaced. Use one tag per dimension, such as env/prod or team/payments.'

const TAG_RE = /^[A-Za-z0-9_\-/]+$/
const MAX_LENGTH = 256

function problem(value) {
  if (!value) return ''
  if (value.length > MAX_LENGTH) return `Too long: ${value.length} of ${MAX_LENGTH} characters.`
  const parts = value.split(',')
  const bad = parts.find(t => t && !TAG_RE.test(t))
  if (bad) return `"${bad}" has a character that is not allowed (spaces included). Use letters, numbers, - _ / only.`
  if (parts.some(t => !t)) return 'Remove the empty tag (stray or doubled comma).'
  return ''
}

// "NAME:default" -> one input bound to the shared <NAME:default> placeholder in the code blocks below.
export default function SensorTags({ spec, label }) {
  const shared = useContext(PlaceholderContext)
  const [name, ...rest] = String(spec || '').split(':')
  const def = rest.join(':').trim()
  const key = name.trim()
  const [localValue, setLocalValue] = useState(undefined)

  const stored = shared ? shared.values[key] : localValue
  const value = stored ?? def
  const error = problem(value)
  const setValue = v => (shared ? shared.setValue(key, v) : setLocalValue(v))
  const reset = () => (shared ? shared.reset([key]) : setLocalValue(undefined))

  return (
    <div className="lab-variables sensor-tags">
      <div className="lab-variables__header">
        <span className="lab-variables__title">{label || 'Sensor grouping tags'}</span>
        {stored !== undefined && stored !== def && (
          <button className="lab-variables__reset" type="button" onClick={reset}>
            Reset
          </button>
        )}
      </div>
      <label className="lab-variables__field">
        <span className="lab-variables__label">
          <span className="tip-term" tabIndex={0} data-tip={TIP}>
            Best practice for scoping host groups
          </span>
          <span className="sensor-tags__hint"> comma-separated; letters, numbers, - _ / only</span>
        </span>
        <input
          type="text"
          value={value}
          placeholder={def || 'env/prod,team/payments'}
          aria-label={label || 'Sensor grouping tags'}
          aria-invalid={error ? 'true' : undefined}
          onChange={e => setValue(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
        />
        {error && <span className="sensor-tags__error" role="alert">{error}</span>}
      </label>
    </div>
  )
}

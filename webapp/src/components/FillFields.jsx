import { useContext, useEffect } from 'react'
import { PlaceholderContext } from './placeholderContext'
import { isSecretName } from '../hooks/usePlaceholderValues'

// "NAME:Label,NAME2:Label two" -> [{ name, label }]
function parseFields(spec) {
  return String(spec || '')
    .split(',')
    .map(part => {
      const [name, ...rest] = part.split(':')
      return { name: name.trim(), label: rest.join(':').trim() || name.trim() }
    })
    .filter(f => f.name)
}

// "NAME=<A>.x.<B>;NAME2=<C>" -> [{ name, template }]
function parseDerive(spec) {
  return String(spec || '')
    .split(';')
    .map(part => {
      const i = part.indexOf('=')
      return i < 0 ? null : { name: part.slice(0, i).trim(), template: part.slice(i + 1).trim() }
    })
    .filter(d => d && d.name && d.template)
}

// Fill each <NAME> in the template from values; empty if any piece is missing.
function compose(template, values) {
  let missing = false
  const out = template.replace(/<([A-Z][A-Z0-9_]*)>/g, (_, n) => {
    const v = values[n]
    if (!v) missing = true
    return v || ''
  })
  return missing ? '' : out
}

// Standalone form for shared <PLACEHOLDER> values, kept out of the copy blocks.
export default function FillFields({ spec, derive }) {
  const shared = useContext(PlaceholderContext)
  const fields = parseFields(spec)
  const derived = parseDerive(derive)
  const composed = shared ? derived.map(d => compose(d.template, shared.values)) : []
  const composedKey = composed.join('\u0000')

  // Keep derived placeholders (e.g. REGISTRY) in sync with the pieces typed above.
  useEffect(() => {
    if (!shared) return
    derived.forEach((d, i) => {
      if ((shared.values[d.name] ?? '') !== composed[i]) shared.setValue(d.name, composed[i])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composedKey])

  if (!shared) return null
  const anySet = fields.some(f => shared.values[f.name])

  return (
    <div className="lab-variables">
      <div className="lab-variables__header">
        <span className="lab-variables__title">Your values</span>
        {anySet && (
          <button
            className="lab-variables__reset"
            type="button"
            onClick={() => shared.reset(fields.map(f => f.name))}
          >
            Reset
          </button>
        )}
      </div>
      <div className="lab-variables__fields">
        {fields.map(f => (
          <label key={f.name} className="lab-variables__field">
            <span className="lab-variables__label">{f.label}</span>
            <input
              type={isSecretName(f.name) ? 'password' : 'text'}
              value={shared.values[f.name] ?? ''}
              placeholder={f.name}
              onChange={e => shared.setValue(f.name, e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
            />
          </label>
        ))}
      </div>
    </div>
  )
}

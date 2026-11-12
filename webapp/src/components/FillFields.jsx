import { useContext } from 'react'
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

// Standalone form for shared <PLACEHOLDER> values, kept out of the copy blocks.
export default function FillFields({ spec }) {
  const shared = useContext(PlaceholderContext)
  if (!shared) return null

  const fields = parseFields(spec)
  const anySet = fields.some(f => shared.values[f.name])

  return (
    <div className="lab-variables">
      <div className="lab-variables__header">
        <span className="lab-variables__title">Your values</span>
        <span className="lab-variables__hint">Fill in once; every command below picks them up</span>
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

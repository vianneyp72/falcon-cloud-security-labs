import { useRef, useLayoutEffect, useContext } from 'react'
import { LabVarsContext } from './labVarsContext'

/**
 * Interactive lab-variables panel. Reads live values / setters from
 * LabVarsContext so it can update on every keystroke WITHOUT causing the
 * enclosing react-markdown tree to remount — the components object passed to
 * <Markdown> is memoized in LabRenderer with only structural deps, and this
 * component subscribes to value changes via context instead.
 *
 * Field types supported: 'select' (dropdown), 'text' (input).
 * Special behavior: the CLOUD field's selected option can carry a `regionLabel`
 * that overrides the label of a companion REGION field, and a `regionDefault`
 * used as the REGION default (see useLabVariables).
 *
 * Scroll preservation: when CLOUD changes, provider-specific blocks in the lab
 * are shown/hidden which shifts DOM height below the panel. We capture the
 * dropdown's viewport-top before the state update and compensate with
 * window.scrollBy after layout so nothing appears to jump.
 */
export default function LabVariables() {
  const ctx = useContext(LabVarsContext)
  const cloudSelectRef = useRef(null)
  const anchorTopBeforeChange = useRef(null)

  const cloudValue = ctx?.values?.CLOUD

  useLayoutEffect(() => {
    if (anchorTopBeforeChange.current !== null && cloudSelectRef.current) {
      const currentTop = cloudSelectRef.current.getBoundingClientRect().top
      const delta = currentTop - anchorTopBeforeChange.current
      if (delta !== 0) window.scrollBy(0, delta)
      anchorTopBeforeChange.current = null
    }
  }, [cloudValue])

  if (!ctx?.config) return null

  const { config, values, setValue, resetToDefaults } = ctx
  const cloudField = config.fields.find(f => f.key === 'CLOUD')
  const selectedCloud = cloudField?.options.find(o => o.value === values.CLOUD)

  const handleCloudChange = (newValue) => {
    if (cloudSelectRef.current) {
      anchorTopBeforeChange.current = cloudSelectRef.current.getBoundingClientRect().top
    }
    setValue('CLOUD', newValue)
  }

  return (
    <div className="lab-variables">
      <div className="lab-variables__header">
        <span className="lab-variables__title">Lab Variables</span>
        <span className="lab-variables__hint">Change these to update every command below</span>
        <button className="lab-variables__reset" onClick={resetToDefaults} type="button">
          Reset
        </button>
      </div>
      <div className="lab-variables__fields">
        {config.fields.map(field => {
          if (field.key === 'REGION' && selectedCloud?.regionLabel) {
            field = { ...field, label: selectedCloud.regionLabel }
          }
          const isCloud = field.key === 'CLOUD'
          return (
            <label key={field.key} className="lab-variables__field">
              <span className="lab-variables__label">{field.label}</span>
              {field.type === 'select' ? (
                <select
                  ref={isCloud ? cloudSelectRef : undefined}
                  value={values[field.key] ?? ''}
                  onChange={e => (isCloud
                    ? handleCloudChange(e.target.value)
                    : setValue(field.key, e.target.value))}
                >
                  {field.options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={values[field.key] ?? ''}
                  onChange={e => setValue(field.key, e.target.value)}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}

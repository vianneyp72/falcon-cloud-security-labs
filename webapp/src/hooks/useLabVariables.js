import { useState, useCallback, useMemo } from 'react'

const STORAGE_KEY = 'falcon-lab-variables'

function loadAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

// Compute defaults for a config: static defaults, plus REGION defaults from the selected cloud option.
function computeDefaults(config) {
  const defaults = {}
  for (const field of config.fields) {
    if (field.default !== undefined) defaults[field.key] = field.default
  }
  const cloudField = config.fields.find(f => f.key === 'CLOUD')
  if (cloudField && defaults.CLOUD) {
    const opt = cloudField.options.find(o => o.value === defaults.CLOUD)
    if (opt?.regionDefault) defaults.REGION = opt.regionDefault
  }
  return defaults
}

/**
 * Per-lab, localStorage-backed variable state.
 * Returns { values, setValue, resetToDefaults }.
 * `values` always has every key from config.fields populated (default fallback).
 * When CLOUD changes, REGION auto-updates to that cloud's regionDefault.
 */
export function useLabVariables(labKey, config) {
  const defaults = useMemo(() => computeDefaults(config), [config])

  const [store, setStore] = useState(loadAll)
  const stored = store[labKey] || {}
  const values = { ...defaults, ...stored }

  const setValue = useCallback((key, value) => {
    setStore(prev => {
      const labValues = { ...(prev[labKey] || {}), [key]: value }
      // When CLOUD changes, snap REGION to the new cloud's default (unless user just typed REGION).
      if (key === 'CLOUD') {
        const cloudField = config.fields.find(f => f.key === 'CLOUD')
        const opt = cloudField?.options.find(o => o.value === value)
        if (opt?.regionDefault) labValues.REGION = opt.regionDefault
      }
      const next = { ...prev, [labKey]: labValues }
      saveAll(next)
      return next
    })
  }, [labKey, config])

  const resetToDefaults = useCallback(() => {
    setStore(prev => {
      const next = { ...prev }
      delete next[labKey]
      saveAll(next)
      return next
    })
  }, [labKey])

  return { values, setValue, resetToDefaults }
}

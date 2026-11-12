import { useState, useCallback, useMemo } from 'react'

const STORAGE_KEY = 'falcon-lab-placeholders'

export const isSecretName = name => /SECRET|PASSWORD|TOKEN|PRIVATE/.test(name)

function loadAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

// Secrets stay in memory only — never written to localStorage.
function saveAll(data) {
  const clean = {}
  for (const [lab, vals] of Object.entries(data)) {
    const kept = Object.fromEntries(
      Object.entries(vals).filter(([name]) => !isSecretName(name))
    )
    if (Object.keys(kept).length) clean[lab] = kept
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
}

export function usePlaceholderValues(labKey) {
  const [store, setStore] = useState(loadAll)
  const values = store[labKey] || EMPTY

  const setValue = useCallback((name, value) => {
    setStore(prev => {
      const next = { ...prev, [labKey]: { ...(prev[labKey] || {}), [name]: value } }
      saveAll(next)
      return next
    })
  }, [labKey])

  const reset = useCallback(names => {
    setStore(prev => {
      const labValues = { ...(prev[labKey] || {}) }
      for (const name of names) delete labValues[name]
      const next = { ...prev, [labKey]: labValues }
      saveAll(next)
      return next
    })
  }, [labKey])

  return useMemo(() => ({ values, setValue, reset }), [values, setValue, reset])
}

const EMPTY = {}

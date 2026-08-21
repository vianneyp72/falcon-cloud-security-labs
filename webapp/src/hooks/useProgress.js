import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { getLabContent } from '../content/manifest'

const STORAGE_KEY = 'falcon-lab-progress'

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveProgress(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

// Module-level shared state + subscribers so every useProgress() instance
// stays in sync. Otherwise Layout's copy stays frozen while LabRenderer's
// updates locally, and the header progress bar goes stale.
let currentProgress = loadProgress()
const subscribers = new Set()

function notify() {
  subscribers.forEach(cb => cb())
}

function setProgressState(next) {
  currentProgress = next
  saveProgress(next)
  notify()
}

function subscribe(cb) {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

function getSnapshot() {
  return currentProgress
}

// Count checkboxes in markdown content
function countCheckboxes(content) {
  if (!content) return 0
  const matches = content.match(/- \[ \]/g)
  return matches ? matches.length : 0
}

export function useProgress() {
  const progress = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const isChecked = useCallback((key) => {
    return !!progress[key]
  }, [progress])

  const toggleCheckbox = useCallback((key) => {
    const next = { ...currentProgress, [key]: !currentProgress[key] }
    if (!next[key]) delete next[key]
    setProgressState(next)
  }, [])

  const getPageProgress = useCallback((labKey, activeMode, hasMode) => {
    const prefix = hasMode ? `${labKey}:${activeMode}:` : `${labKey}:`
    const checked = Object.keys(progress).filter(k => k.startsWith(prefix) && progress[k]).length
    const content = getLabContent(labKey)
    const total = countCheckboxes(content)
    return { checked, total }
  }, [progress])

  const reset = useCallback(() => {
    setProgressState({})
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return {
    isChecked,
    toggleCheckbox,
    getPageProgress,
    reset,
  }
}

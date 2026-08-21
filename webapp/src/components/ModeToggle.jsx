import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'falcon-lab-mode'

// Shared mode state so every useModeToggle() call site stays in sync
// (Layout header + LabRenderer both need to react to the same mode).
let currentMode = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'guide'
  } catch {
    return 'guide'
  }
})()
const modeSubscribers = new Set()

function setModeState(next) {
  currentMode = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {}
  modeSubscribers.forEach(cb => cb())
}

function subscribeMode(cb) {
  modeSubscribers.add(cb)
  return () => modeSubscribers.delete(cb)
}

function getModeSnapshot() {
  return currentMode
}

export default function ModeToggle({ activeMode, setActiveMode }) {
  return (
    <div className="mode-toggle-wrapper">
      <span className="mode-toggle-wrapper__label">Choose your path</span>
      <div className="mode-toggle">
        <button
          className={`mode-toggle__tab ${activeMode === 'guide' ? 'mode-toggle__tab--active' : ''}`}
          onClick={() => setActiveMode('guide')}
        >
          Quick Deploy
        </button>
        <button
          className={`mode-toggle__tab ${activeMode === 'lab' ? 'mode-toggle__tab--active' : ''}`}
          onClick={() => setActiveMode('lab')}
        >
          Full Lab
        </button>
      </div>
    </div>
  )
}

export function useModeToggle() {
  const activeMode = useSyncExternalStore(subscribeMode, getModeSnapshot, getModeSnapshot)
  const setActiveMode = useCallback((next) => setModeState(next), [])
  return [activeMode, setActiveMode]
}

export function contentHasMode(content) {
  return content && /data-mode=/.test(content)
}

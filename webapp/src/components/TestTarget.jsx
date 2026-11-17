import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'falcon-lab-test-target'
const TARGETS = [
  { id: 'fargate', label: 'Fargate (sidecar)' },
  { id: 'ec2', label: 'EC2 (DaemonSet)' },
]
const DEFAULT_TARGET = 'fargate'

function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (TARGETS.some(t => t.id === saved)) return saved
  } catch {}
  return DEFAULT_TARGET
}

// Module-level shared state so the picker and every gated block stay in sync.
let current = load()
const subscribers = new Set()

function setTarget(id) {
  current = id
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {}
  subscribers.forEach(cb => cb())
}

function subscribe(cb) {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

const getSnapshot = () => current

export function useTestTarget() {
  const target = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const set = useCallback(id => setTarget(id), [])
  return [target, set]
}

// gate: comma list of ec2 | fargate
export function testTargetMatches(gate, target) {
  return gate.split(',').some(g => g.trim() === target)
}

export default function TestTarget() {
  const [target, set] = useTestTarget()
  return (
    <div className="registry-picker">
      <div className="registry-picker__row">
        <span className="registry-picker__label">Test the app on</span>
        <div className="mode-toggle">
          {TARGETS.map(t => (
            <button
              key={t.id}
              className={`mode-toggle__tab ${target === t.id ? 'mode-toggle__tab--active' : ''}`}
              onClick={() => set(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

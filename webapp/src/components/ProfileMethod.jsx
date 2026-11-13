import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'falcon-lab-profile-method'
const METHODS = [
  { id: 'console', label: 'AWS Console' },
  { id: 'awscli', label: 'AWS CLI' },
  { id: 'eksctl', label: 'eksctl' },
]
const DEFAULT_METHOD = 'awscli'

function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (METHODS.some(m => m.id === saved)) return saved
  } catch {}
  return DEFAULT_METHOD
}

// Module-level shared state so the picker and every gated block stay in sync.
let current = load()
const subscribers = new Set()

function setMethod(id) {
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

export function useProfileMethod() {
  const method = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const set = useCallback(id => setMethod(id), [])
  return [method, set]
}

// gate: comma list of console | awscli | eksctl
export function profileMatches(gate, method) {
  return gate.split(',').some(g => g.trim() === method)
}

export default function ProfileMethod() {
  const [method, set] = useProfileMethod()
  return (
    <div className="registry-picker">
      <div className="registry-picker__row">
        <span className="registry-picker__label">Create it with</span>
        <div className="mode-toggle">
          {METHODS.map(m => (
            <button
              key={m.id}
              className={`mode-toggle__tab ${method === m.id ? 'mode-toggle__tab--active' : ''}`}
              onClick={() => set(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

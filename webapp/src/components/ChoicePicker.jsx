import { useCallback, useSyncExternalStore } from 'react'

// Generic reader choice shared across a page: `<div data-choice-picker="os"></div>` renders a
// segmented toggle; `<div data-choice="os:linux">` shows its children only while that option is
// selected (comma list means any match). Every picker for the same key stays in sync, and the
// choice is remembered across pages, so a reader picks their OS once.
export const CHOICES = {
  os: {
    label: 'Run on',
    options: [
      { id: 'windows', label: 'Windows' },
      { id: 'linux', label: 'Linux' },
    ],
    default: 'linux',
  },
  distro: {
    label: 'Linux distribution',
    options: [
      { id: 'debian', label: 'Debian / Ubuntu' },
      { id: 'rhel', label: 'RHEL / Fedora' },
      { id: 'amazon', label: 'Amazon Linux' },
    ],
    default: 'debian',
  },
  argo: {
    label: 'Create the Application with',
    options: [
      { id: 'ui', label: 'Argo CD UI' },
      { id: 'cli', label: 'Argo CD CLI' },
    ],
    default: 'ui',
  },
  secrets: {
    label: 'Store credentials as',
    options: [
      { id: 'inline', label: 'Inline in the Application' },
      { id: 'k8s', label: 'Kubernetes Secrets' },
    ],
    default: 'inline',
  },
  falconcloud: {
    label: 'Falcon cloud',
    options: [
      { id: 'commercial', label: 'Commercial' },
      { id: 'govcloud-1', label: 'GovCloud US-1' },
      { id: 'govcloud-2', label: 'GovCloud US-2' },
    ],
    default: 'commercial',
  },
}

const storageKey = key => `falcon-lab-choice-${key}`

function load(key) {
  const spec = CHOICES[key]
  try {
    const saved = localStorage.getItem(storageKey(key))
    if (spec.options.some(o => o.id === saved)) return saved
  } catch {}
  return spec.default
}

// Module-level shared state so every picker and gated block for a key stays in sync.
const current = Object.fromEntries(Object.keys(CHOICES).map(k => [k, load(k)]))
let snapshot = { ...current }
const subscribers = new Set()

function setChoice(key, id) {
  current[key] = id
  snapshot = { ...current }
  try {
    localStorage.setItem(storageKey(key), id)
  } catch {}
  subscribers.forEach(cb => cb())
}

function subscribe(cb) {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

export function useChoice(key) {
  const getSnapshot = useCallback(() => current[key], [key])
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const set = useCallback(id => setChoice(key, id), [key])
  return [value, set]
}

// All current choices, for per-line `#@choice=key:option` markers inside code blocks.
export function useChoices() {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
}

// gate: "os:linux" or "os:windows,linux"
export function parseChoiceGate(gate) {
  const [key, ids = ''] = String(gate).split(':')
  return { key: key.trim(), ids: ids.split(',').map(s => s.trim()).filter(Boolean) }
}

export function ChoiceBlockGate({ gate, children, ...props }) {
  const { key, ids } = parseChoiceGate(gate)
  const [value] = useChoice(CHOICES[key] ? key : 'os')
  if (CHOICES[key] && !ids.includes(value)) {
    return <div className="mode-content--hidden" />
  }
  return <div {...props}>{children}</div>
}

export default function ChoicePicker({ choiceKey }) {
  const spec = CHOICES[choiceKey]
  const [value, set] = useChoice(spec ? choiceKey : 'os')
  if (!spec) return null
  return (
    <div className="choice-picker">
      <span className="choice-picker__label">{spec.label}</span>
      <div className="mode-toggle" role="group" aria-label={spec.label}>
        {spec.options.map(o => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value === o.id}
            className={`mode-toggle__tab ${value === o.id ? 'mode-toggle__tab--active' : ''}`}
            onClick={() => set(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

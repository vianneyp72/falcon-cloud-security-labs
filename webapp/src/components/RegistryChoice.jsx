import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'falcon-lab-registry'
const OWN_TYPES = [
  { id: 'ecr', label: 'AWS ECR' },
  { id: 'acr', label: 'Azure ACR' },
  { id: 'gar', label: 'GCP Artifact Registry' },
  { id: 'generic', label: 'Other registry' },
]

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved && (saved.source === 'crowdstrike' || saved.source === 'own')) {
      return {
        source: saved.source,
        type: OWN_TYPES.some(t => t.id === saved.type) ? saved.type : 'ecr',
        repo: saved.repo === 'existing' ? 'existing' : 'new',
      }
    }
  } catch {}
  return { source: 'crowdstrike', type: 'ecr', repo: 'new' }
}

// Module-level shared state so the picker and every gated block stay in sync.
let current = load()
const subscribers = new Set()

function setChoice(patch) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {}
  subscribers.forEach(cb => cb())
}

function subscribe(cb) {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

const getSnapshot = () => current

export function useRegistryChoice() {
  const choice = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const setSource = useCallback(source => setChoice({ source }), [])
  const setType = useCallback(type => setChoice({ type }), [])
  const setRepo = useCallback(repo => setChoice({ repo }), [])
  return { ...choice, setSource, setType, setRepo }
}

// A gate value is a comma list of: crowdstrike | own | ecr | acr | gar | generic | ecr-new | ecr-existing | per-image.
// per-image = own registry where each image gets its own repo (everything except ECR existing-repo mode).
export function registryMatches(gate, { source, type, repo }) {
  const existing = type === 'ecr' && repo === 'existing'
  const active = source === 'crowdstrike'
    ? ['crowdstrike']
    : ['own', type, existing ? 'ecr-existing' : 'per-image', ...(type === 'ecr' && !existing ? ['ecr-new'] : [])]
  return gate.split(',').some(g => active.includes(g.trim()))
}

export default function RegistryChoice() {
  const { source, type, repo, setSource, setType, setRepo } = useRegistryChoice()
  const tab = (active, onClick, label) => (
    <button
      className={`mode-toggle__tab ${active ? 'mode-toggle__tab--active' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  )

  return (
    <div className="registry-picker">
      <div className="registry-picker__row">
        <span className="registry-picker__label">Pull images from</span>
        <div className="mode-toggle">
          {tab(source === 'crowdstrike', () => setSource('crowdstrike'), 'CrowdStrike registry')}
          {tab(source === 'own', () => setSource('own'), 'My own registry')}
        </div>
      </div>
      {source === 'own' && (
        <div className="registry-picker__row">
          <span className="registry-picker__label">Registry type</span>
          <div className="mode-toggle">
            {OWN_TYPES.map(t => (
              <span key={t.id} style={{ display: 'contents' }}>
                {tab(type === t.id, () => setType(t.id), t.label)}
              </span>
            ))}
          </div>
        </div>
      )}
      {source === 'own' && type === 'ecr' && (
        <div className="registry-picker__row">
          <span className="registry-picker__label">ECR repository</span>
          <div className="mode-toggle">
            {tab(repo === 'new', () => setRepo('new'), 'Create one per image')}
            {tab(repo === 'existing', () => setRepo('existing'), 'Use an existing repository')}
          </div>
        </div>
      )}
    </div>
  )
}

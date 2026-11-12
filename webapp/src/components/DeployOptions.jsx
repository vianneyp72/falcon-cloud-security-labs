import { useCallback, useState, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'falcon-lab-falcon-cloud'
const GOV_TYPES = [
  { id: 'gov1', label: 'US-GOV-1' },
  { id: 'gov2', label: 'US-GOV-2' },
]
const DEFAULTS = { cloud: 'commercial', gov: 'gov1', kac: true, iar: true, proxy: false }

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved && typeof saved === 'object') {
      return {
        cloud: saved.cloud === 'gov' ? 'gov' : 'commercial',
        gov: GOV_TYPES.some(g => g.id === saved.gov) ? saved.gov : DEFAULTS.gov,
        kac: saved.kac !== false,
        iar: saved.iar !== false,
        proxy: saved.proxy === true,
      }
    }
  } catch {}
  return { ...DEFAULTS }
}

// Module-level shared state so the picker and every gated line stay in sync.
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

export function useDeployOptions() {
  const choice = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const set = useCallback(patch => setChoice(patch), [])
  return { ...choice, set }
}

// kind 'region' gates: commercial | gov | gov1 | gov2
// kind 'opt' gates:    kac | nokac | iar | noiar | proxy
export function markerMatches(kind, gate, { cloud, gov, kac, iar, proxy }) {
  const active = kind === 'region'
    ? (cloud === 'commercial' ? ['commercial'] : ['gov', gov])
    : [kac ? 'kac' : 'nokac', iar ? 'iar' : 'noiar', ...(proxy ? ['proxy'] : [])]
  return gate.split(',').some(g => active.includes(g.trim()))
}

export default function DeployOptions() {
  const { cloud, gov, kac, iar, proxy, set } = useDeployOptions()
  const [open, setOpen] = useState(false)
  const customized = cloud !== 'commercial' || !kac || !iar || proxy

  const tab = (active, onClick, label) => (
    <button
      className={`mode-toggle__tab ${active ? 'mode-toggle__tab--active' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
  const check = (checked, key, label, hint) => (
    <label className="registry-picker__check">
      <input type="checkbox" checked={checked} onChange={e => set({ [key]: e.target.checked })} />
      <span>
        {label}
        {hint && <span className="registry-picker__hint"> {hint}</span>}
      </span>
    </label>
  )

  return (
    <div className="registry-picker">
      <details
        className="registry-picker__more"
        open={open}
        onToggle={e => setOpen(e.currentTarget.open)}
      >
        <summary>
          Additional settings
          <span className="registry-picker__hint"> GovCloud, proxy, components</span>
          {customized && <span className="registry-picker__badge">customized</span>}
        </summary>
        <div className="registry-picker__row">
          <span className="registry-picker__label">My Falcon cloud</span>
          <div className="mode-toggle">
            {tab(cloud === 'commercial', () => set({ cloud: 'commercial' }), 'Commercial')}
            {tab(cloud === 'gov', () => set({ cloud: 'gov' }), 'GovCloud')}
          </div>
        </div>
        {cloud === 'gov' && (
          <div className="registry-picker__row">
            <span className="registry-picker__label">GovCloud region</span>
            <div className="mode-toggle">
              {GOV_TYPES.map(g => (
                <span key={g.id} style={{ display: 'contents' }}>
                  {tab(gov === g.id, () => set({ gov: g.id }), g.label)}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="registry-picker__row">
          <span className="registry-picker__label">Components</span>
          <div className="registry-picker__checks">
            <label className="registry-picker__check">
              <input type="checkbox" checked disabled />
              <span>Sensor <span className="registry-picker__hint">(always installed)</span></span>
            </label>
            {check(kac, 'kac', 'KAC', '(Kubernetes Admission Controller)')}
            {check(iar, 'iar', 'IAR', '(Image Analyzer)')}
          </div>
        </div>
        <div className="registry-picker__row">
          <span className="registry-picker__label">Network</span>
          <div className="registry-picker__checks">
            {check(proxy, 'proxy', 'Cluster egress goes through an HTTP proxy', '(edit PROXY_HOST and PROXY_PORT in the command)')}
          </div>
        </div>
      </details>
    </div>
  )
}

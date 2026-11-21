import { useCallback, useState, useSyncExternalStore } from 'react'
import { useChoice } from './ChoicePicker'

const STORAGE_KEY = 'falcon-lab-falcon-cloud'
// Ids are the `falconcloud` choice ids, so this panel and any inline Falcon cloud picker stay in sync.
const GOV_TYPES = [
  { id: 'gov1', choice: 'govcloud-1', label: 'US-GOV-1' },
  { id: 'gov2', choice: 'govcloud-2', label: 'US-GOV-2' },
]
const DEFAULTS = { kac: true, iar: true, proxy: false, logging: false, pacing: false, limits: false }

// Reader-toggled options that add lines to a command (gate: `#@opt=<id>`). To add one, add an
// entry here, list its id in the `data-deploy-options` attribute, and gate its lines in the lab.
const EXTRAS = {
  logging: { label: 'Send sensor logs to CloudWatch', hint: '(adds EnableLogging)', short: 'logging' },
  pacing: { label: 'Slow the instance rollout', hint: '(edit the drain percent and bake time in the command)', short: 'rollout pacing' },
  limits: { label: 'Cap sensor CPU and memory', hint: '(edit the limits in the command)', short: 'resource limits' },
}
const DEFAULT_SECTIONS = ['cloud', 'components', 'proxy']

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved && typeof saved === 'object') {
      return {
        kac: saved.kac !== false,
        iar: saved.iar !== false,
        proxy: saved.proxy === true,
        logging: saved.logging === true,
        pacing: saved.pacing === true,
        limits: saved.limits === true,
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
  // Falcon cloud lives in the shared `falconcloud` choice, not in this panel's own storage.
  const [falconCloud, setFalconCloud] = useChoice('falconcloud')
  const cloud = falconCloud === 'commercial' ? 'commercial' : 'gov'
  const gov = falconCloud === 'govcloud-2' ? 'gov2' : 'gov1'
  return { ...choice, cloud, gov, set, setFalconCloud }
}

// kind 'region' gates: commercial | gov | gov1 | gov2
// kind 'opt' gates:    kac | nokac | iar | noiar | proxy | logging | pacing | limits
export function markerMatches(kind, gate, state) {
  const { cloud, gov, kac, iar } = state
  const active = kind === 'region'
    ? (cloud === 'commercial' ? ['commercial'] : ['gov', gov])
    : [kac ? 'kac' : 'nokac', iar ? 'iar' : 'noiar', ...['proxy', ...Object.keys(EXTRAS)].filter(k => state[k])]
  return gate.split(',').some(g => active.includes(g.trim()))
}

export default function DeployOptions({ sections }) {
  const state = useDeployOptions()
  const { cloud, gov, kac, iar, proxy, set, setFalconCloud } = state
  const [open, setOpen] = useState(false)
  const show = new Set(sections?.length ? sections : DEFAULT_SECTIONS)
  const extras = Object.keys(EXTRAS).filter(k => show.has(k))
  const customized =
    (show.has('cloud') && cloud !== 'commercial') ||
    (show.has('components') && (!kac || !iar)) ||
    (show.has('proxy') && proxy) ||
    extras.some(k => state[k])
  const hint = [
    show.has('cloud') && 'GovCloud',
    show.has('proxy') && 'proxy',
    show.has('components') && 'components',
    ...extras.map(k => EXTRAS[k].short),
  ].filter(Boolean).join(', ')

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
          <span className="registry-picker__hint"> {hint}</span>
          {customized && <span className="registry-picker__badge">customized</span>}
        </summary>
        {show.has('cloud') && (
          <div className="registry-picker__row">
            <span className="registry-picker__label">My Falcon cloud</span>
            <div className="mode-toggle">
              {tab(cloud === 'commercial', () => setFalconCloud('commercial'), 'Commercial')}
              {tab(cloud === 'gov', () => cloud !== 'gov' && setFalconCloud(GOV_TYPES[0].choice), 'GovCloud')}
            </div>
          </div>
        )}
        {show.has('cloud') && cloud === 'gov' && (
          <div className="registry-picker__row">
            <span className="registry-picker__label">GovCloud region</span>
            <div className="mode-toggle">
              {GOV_TYPES.map(g => (
                <span key={g.id} style={{ display: 'contents' }}>
                  {tab(gov === g.id, () => setFalconCloud(g.choice), g.label)}
                </span>
              ))}
            </div>
          </div>
        )}
        {show.has('components') && (
          <div className="registry-picker__row registry-picker__row--top">
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
        )}
        {show.has('proxy') && (
          <div className="registry-picker__row registry-picker__row--top">
            <span className="registry-picker__label">Network</span>
            <div className="registry-picker__checks">
              {check(proxy, 'proxy', 'Cluster egress goes through an HTTP proxy', '(edit PROXY_HOST and PROXY_PORT in the command)')}
            </div>
          </div>
        )}
        {extras.length > 0 && (
          <div className="registry-picker__row registry-picker__row--top">
            <span className="registry-picker__label">Options</span>
            <div className="registry-picker__checks">
              {extras.map(k => (
                <span key={k} style={{ display: 'contents' }}>
                  {check(state[k], k, EXTRAS[k].label, EXTRAS[k].hint)}
                </span>
              ))}
            </div>
          </div>
        )}
      </details>
    </div>
  )
}

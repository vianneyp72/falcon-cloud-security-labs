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
  logging: { label: 'Send sensor logs to CloudWatch', hint: 'Adds EnableLogging', short: 'logging' },
  pacing: { label: 'Slow the instance rollout', hint: 'Edit the drain percent and bake time in the command', short: 'rollout pacing' },
  limits: { label: 'Cap sensor CPU and memory', hint: 'Edit the limits in the command', short: 'resource limits' },
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
  const changed = [
    show.has('cloud') && cloud !== 'commercial',
    show.has('components') && !kac,
    show.has('components') && !iar,
    show.has('proxy') && proxy,
    ...extras.map(k => state[k]),
  ].filter(Boolean).length
  const hint = [
    show.has('cloud') && 'GovCloud',
    show.has('proxy') && 'proxy',
    show.has('components') && 'components',
    ...extras.map(k => EXTRAS[k].short),
  ].filter(Boolean).join(', ')

  const segment = (active, onClick, label) => (
    <button
      type="button"
      className={`registry-picker__segment ${active ? 'registry-picker__segment--active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  )
  const option = (checked, label, hint, onChange, disabled) => (
    <label className={`registry-picker__option ${disabled ? 'registry-picker__option--disabled' : ''}`}>
      <span className="registry-picker__option-text">
        <span className="registry-picker__option-label">{label}</span>
        {hint && <span className="registry-picker__option-hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="registry-picker__switch" aria-hidden="true" />
    </label>
  )
  const toggle = (key, label, hint) => option(state[key], label, hint, e => set({ [key]: e.target.checked }))
  const group = (title, body) => (
    <div className="registry-picker__group">
      <span className="registry-picker__label">{title}</span>
      {body}
    </div>
  )

  return (
    <div className={`registry-picker registry-picker--panel ${open ? 'registry-picker--open' : ''}`}>
      <details
        className="registry-picker__more"
        open={open}
        onToggle={e => setOpen(e.currentTarget.open)}
      >
        <summary>
          <svg className="registry-picker__icon" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M3 5.5h8M15 5.5h2M3 14.5h2M9 14.5h8" />
            <circle cx="13" cy="5.5" r="2" />
            <circle cx="7" cy="14.5" r="2" />
          </svg>
          <span className="registry-picker__title">
            Additional settings
            <span className="registry-picker__hint">{hint}</span>
          </span>
          {changed > 0 && <span className="registry-picker__badge">{changed} changed</span>}
        </summary>
        <div className="registry-picker__body">
          {show.has('cloud') &&
            group(
              'My Falcon cloud',
              <div className="registry-picker__segments">
                {segment(cloud === 'commercial', () => setFalconCloud('commercial'), 'Commercial')}
                {segment(cloud === 'gov', () => cloud !== 'gov' && setFalconCloud(GOV_TYPES[0].choice), 'GovCloud')}
                {cloud === 'gov' && (
                  <>
                    <span className="registry-picker__divider" aria-hidden="true" />
                    {GOV_TYPES.map(g => (
                      <span key={g.id} style={{ display: 'contents' }}>
                        {segment(gov === g.id, () => setFalconCloud(g.choice), g.label)}
                      </span>
                    ))}
                  </>
                )}
              </div>
            )}
          {show.has('components') &&
            group(
              'Components',
              <div className="registry-picker__options">
                {option(true, 'Sensor', 'Always installed', undefined, true)}
                {toggle('kac', 'KAC', 'Kubernetes Admission Controller')}
                {toggle('iar', 'IAR', 'Image Analyzer')}
              </div>
            )}
          {show.has('proxy') &&
            group(
              'Network',
              <div className="registry-picker__options">
                {toggle('proxy', 'Cluster egress goes through an HTTP proxy', 'Edit PROXY_HOST and PROXY_PORT in the command')}
              </div>
            )}
          {extras.length > 0 &&
            group(
              'Options',
              <div className="registry-picker__options">
                {extras.map(k => (
                  <span key={k} style={{ display: 'contents' }}>
                    {toggle(k, EXTRAS[k].label, EXTRAS[k].hint)}
                  </span>
                ))}
              </div>
            )}
        </div>
      </details>
    </div>
  )
}

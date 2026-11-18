import Expandable from './Expandable'

// Vector replicas of the Argo CD v3.4.5 UI. Colors are fixed on purpose (the real product is
// light-on-navy in any site theme). Every size is in em, so the expanded view just raises the
// root font-size. Numbered badges mark the click order.

const Badge = ({ n }) => <span className="argo-mock__badge">{n}</span>

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }

const I = {
  plus: <svg {...svg}><path d="M12 5v14M5 12h14" /></svg>,
  sync: <svg {...svg}><path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4" /></svg>,
  refresh: <svg {...svg}><path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5" /></svg>,
  trash: <svg {...svg}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>,
  open: <svg {...svg}><path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" /></svg>,
  star: <svg {...svg}><path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z" /></svg>,
  close: <svg {...svg}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  search: <svg {...svg}><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></svg>,
}

const Heart = () => (
  <svg className="argo-mock__ico argo-mock__ico--ok" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z" />
  </svg>
)
const Check = () => (
  <svg className="argo-mock__ico argo-mock__ico--ok" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" fill="currentColor" />
    <path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const Warn = () => (
  <svg className="argo-mock__ico argo-mock__ico--warn" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" fill="currentColor" />
    <path d="M12 6v7M12 16.5v1" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
)
const Missing = () => (
  <svg className="argo-mock__ico argo-mock__ico--warn" viewBox="0 0 24 24" fill="currentColor">
    <path d="M5 21V10a7 7 0 0 1 14 0v11l-3-2-2 2-2-2-2 2-2-2z" />
  </svg>
)

const Helm = () => (
  <svg className="argo-mock__helmico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <circle cx="12" cy="12" r="6.5" />
    <circle cx="12" cy="12" r="2" />
    <path d="M12 2v5.5M12 16.5V22M2 12h5.5M16.5 12H22M5 5l3.8 3.8M15.2 15.2L19 19M19 5l-3.8 3.8M8.8 15.2L5 19" />
  </svg>
)

function Pill({ children, icon, hl, ghost, n }) {
  return (
    <span className={`argo-mock__pillbtn${ghost ? ' argo-mock__pillbtn--ghost' : ''}${hl ? ' argo-mock__pillbtn--hl' : ''}`}>
      {icon && <span className="argo-mock__pillicon">{icon}</span>}
      {children}
      {n && <Badge n={n} />}
    </span>
  )
}

function Chrome({ url, children }) {
  return (
    <div className="argo-mock__window">
      <div className="argo-mock__bar">
        <span className="argo-mock__dots"><i /><i /><i /></span>
        <span className="argo-mock__url">{url}</span>
      </div>
      {children}
    </div>
  )
}

function Sidebar() {
  const items = ['Applications', 'Settings', 'User Info', 'Documentation']
  return (
    <div className="argo-mock__side">
      <div className="argo-mock__brand">
        <span className="argo-mock__mascot" />
        <span>
          <b>argo</b>
          <small>v3.4.5</small>
        </span>
      </div>
      {items.map((i, idx) => (
        <div key={i} className={`argo-mock__nav${idx === 0 ? ' argo-mock__nav--on' : ''}`}>
          <span className="argo-mock__navicon" />{i}
        </div>
      ))}
      <div className="argo-mock__filters">Application filters</div>
    </div>
  )
}

function Toolbar({ hlNew }) {
  return (
    <div className="argo-mock__toolbar">
      <Pill icon={I.plus} hl={hlNew} n={hlNew ? '1' : undefined}>NEW APP</Pill>
      <Pill icon={I.sync}>SYNC APPS</Pill>
      <Pill icon={I.refresh}>REFRESH APPS</Pill>
      <span className="argo-mock__search">{I.search}<span>Search applications...</span><kbd>/</kbd></span>
    </div>
  )
}

function Page({ children, overlay, hlNew }) {
  return (
    <div className="argo-mock__app">
      <Sidebar />
      <div className="argo-mock__main">
        <div className="argo-mock__crumb">Applications</div>
        <Toolbar hlNew={hlNew} />
        <div className="argo-mock__summary" />
        <div className="argo-mock__body">{children}</div>
        {overlay && <div className="argo-mock__dim" />}
      </div>
    </div>
  )
}

function PanelHead({ left, right }) {
  return (
    <div className="argo-mock__panelhead">
      {left}
      <span className="argo-mock__spacer" />
      <span className="argo-mock__x">{I.close}</span>
      {right}
    </div>
  )
}

const YAML = [
  ['apiVersion', ' argoproj.io/v1alpha1'],
  ['kind', ' Application'],
  ['metadata', ''],
  ['  name', ' falcon-platform'],
  ['  namespace', ' argocd'],
  ['spec', ''],
  ['  project', ' default'],
  ['  source', ''],
  ['    repoURL', ' https://crowdstrike.github.io/falcon-helm'],
  ['    chart', ' falcon-platform'],
  ['    targetRevision', ' 1.5.1'],
]

function NewApp() {
  return (
    <Chrome url="https://argocd.example.com/applications">
      <Page overlay hlNew>
        <div className="argo-mock__slide">
          <PanelHead
            left={<><Pill>CREATE</Pill><Pill ghost>CANCEL</Pill></>}
          />
          <div className="argo-mock__card">
            <div className="argo-mock__cardhead">
              <span>GENERAL</span>
              <Pill hl n="2">EDIT AS YAML</Pill>
            </div>
            <label className="argo-mock__field"><small>Application Name</small><span /></label>
            <label className="argo-mock__field"><small>Project Name</small><span /></label>
            <div className="argo-mock__field argo-mock__field--row"><small>Sync Policy</small><span>Manual</span></div>
          </div>
        </div>
      </Page>
    </Chrome>
  )
}

function YamlEditor() {
  return (
    <Chrome url="https://argocd.example.com/applications">
      <Page overlay>
        <div className="argo-mock__slide">
          <PanelHead left={<><Pill hl n="5">CREATE</Pill><Pill ghost>CANCEL</Pill></>} />
          <div className="argo-mock__card argo-mock__card--editor">
            <div className="argo-mock__cardhead argo-mock__cardhead--end">
              <Pill hl n="4">SAVE</Pill>
              <Pill ghost>CANCEL</Pill>
            </div>
            <div className="argo-mock__editor">
              {YAML.map(([k, v], i) => (
                <div key={i} className="argo-mock__line">
                  <span className="argo-mock__ln">{i + 1}</span>
                  <span className="argo-mock__k">{k}:</span>
                  <span className="argo-mock__v">{v}</span>
                </div>
              ))}
              <div className="argo-mock__paste"><Badge n="3" /> Select all, delete the template, paste your YAML</div>
            </div>
          </div>
        </div>
      </Page>
    </Chrome>
  )
}

function Tile({ synced }) {
  return (
    <div className={`argo-mock__tile${synced ? ' argo-mock__tile--ok' : ' argo-mock__tile--warn'}`}>
      <div className="argo-mock__tilehead">
        <Helm />
        <b>falcon-platform</b>
        <span className="argo-mock__tileicons">{I.open}{I.star}</span>
      </div>
      <dl className="argo-mock__meta">
        <dt>Project:</dt><dd>default</dd>
        <dt>Labels:</dt><dd />
        <dt>Status:</dt>
        <dd className="argo-mock__status">
          {synced
            ? <><Heart />Healthy <Check />Synced</>
            : <><Missing />Missing <Warn />OutOfSync</>}
        </dd>
        <dt>Repository:</dt><dd>https://crowdstrike.github.io/falcon-helm</dd>
        <dt>Target Rev...</dt><dd>1.5.1</dd>
        <dt>Chart:</dt><dd>falcon-platform</dd>
        <dt>Destination:</dt><dd>in-cluster</dd>
        <dt>Namespa...</dt><dd>falcon-platform</dd>
      </dl>
      <div className="argo-mock__actions">
        <Pill icon={I.sync} hl={!synced} n={synced ? undefined : '1'}>SYNC</Pill>
        <Pill icon={I.refresh}>REFRESH</Pill>
        <Pill icon={I.trash}>DELETE</Pill>
      </div>
    </div>
  )
}

function SyncStates() {
  return (
    <div className="argo-mock__pair">
      <figure>
        <figcaption>Right after you create it</figcaption>
        <Tile synced={false} />
      </figure>
      <span className="argo-mock__arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="1.6em" height="1.6em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </span>
      <figure>
        <figcaption>After the sync finishes</figcaption>
        <Tile synced />
      </figure>
    </div>
  )
}

function SyncPanel() {
  const rows = [
    ['/CONFIGMAP/FALCON-KAC/FALCON-PLATFORM-FALCON-KAC-CONFIG', true],
    ['/SECRET/FALCON-KAC/FALCON-KAC-TLS', false],
    ['/SERVICE/FALCON-KAC/WEBHOOK', true],
    ['APPS/DAEMONSET/FALCON-SYSTEM/FALCON-PLATFORM-FALCON-SENSOR', true],
    ['APPS/DEPLOYMENT/FALCON-KAC/FALCON-KAC', false],
  ]
  return (
    <Chrome url="https://argocd.example.com/applications?syncApp=falcon-platform">
      <Page overlay>
        <div className="argo-mock__slide argo-mock__slide--sync">
          <PanelHead left={<><Pill hl n="2">SYNCHRONIZE</Pill><Pill ghost>CANCEL</Pill></>} />
          <div className="argo-mock__syncbody">
            <p>Synchronizing application manifests from<br /><a>https://crowdstrike.github.io/falcon-helm</a></p>
            <div className="argo-mock__field"><small>Revision</small><span>1.5.1</span></div>
            <div className="argo-mock__opts"><i />PRUNE<i />DRY RUN<i />APPLY ONLY<i />FORCE</div>
            <small className="argo-mock__sect">SYNCHRONIZE RESOURCES</small>
            {rows.map(([r, ok]) => (
              <div key={r} className="argo-mock__res">
                <i className="argo-mock__chk" />
                <span>{r}</span>
                {ok ? <Check /> : <Warn />}
              </div>
            ))}
          </div>
        </div>
        <Tile synced={false} />
      </Page>
    </Chrome>
  )
}

const MOCKS = {
  'new-app': { label: 'Argo CD New App panel with Edit as YAML', render: NewApp },
  'yaml-editor': { label: 'Argo CD YAML editor with Save', render: YamlEditor },
  sync: { label: 'Argo CD falcon-platform tile before and after sync', render: SyncStates },
  'sync-panel': { label: 'Argo CD Synchronize panel', render: SyncPanel },
}

export default function ArgoMockup({ name }) {
  const mock = MOCKS[name]
  if (!mock) return null
  const Body = mock.render
  return (
    <Expandable label={mock.label} wide>
      <div className="argo-mock" role="img" aria-label={mock.label}>
        <Body />
      </div>
    </Expandable>
  )
}

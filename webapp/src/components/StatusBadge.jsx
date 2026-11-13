import { getStatusKey } from '../content/manifest'

const LABELS = {
  modern: 'Modernized',
  legacy: 'Legacy · Roadmap',
  roadmap: 'Roadmap · Coming Soon',
}

export default function StatusBadge({ meta }) {
  const key = getStatusKey(meta)
  if (key === 'reference') return null
  return (
    <span className={`status-badge status-badge--${key}`}>
      <span style={{ fontSize: '0.6rem' }}>{key === 'roadmap' ? '○' : '●'}</span>
      {LABELS[key]}
    </span>
  )
}

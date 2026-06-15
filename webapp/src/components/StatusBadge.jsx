export default function StatusBadge({ status }) {
  const labels = {
    complete: 'Complete',
    stub: 'Coming Soon',
    empty: 'Not Started',
  }
  return (
    <span className={`status-badge status-badge--${status}`}>
      <span style={{ fontSize: '0.6rem' }}>
        {status === 'complete' ? '\u25CF' : status === 'stub' ? '\u25CB' : '\u25CB'}
      </span>
      {labels[status]}
    </span>
  )
}

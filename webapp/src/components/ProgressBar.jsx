export default function ProgressBar({ checked, total }) {
  if (total === 0) {
    return (
      <div className="progress-bar">
        <span>No checkboxes yet</span>
      </div>
    )
  }
  const pct = Math.round((checked / total) * 100)
  return (
    <div className="progress-bar">
      <span>{pct}% complete</span>
      <div className="progress-bar__track">
        <div className="progress-bar__fill" style={{ width: `${pct}%` }} />
      </div>
      <span>{checked}/{total}</span>
    </div>
  )
}

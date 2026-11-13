import { Link } from 'react-router-dom'
import { getRoadmap, getStatusKey } from '../content/manifest'
import LabDisclaimer from './LabDisclaimer'

const STATUS_LABEL = {
  modern: 'Modernized',
  legacy: 'Legacy',
  roadmap: 'Not written',
}

export default function RoadmapPage() {
  const { rows, total, modernized } = getRoadmap()
  const pct = Math.round((modernized / total) * 100)
  const legacyWritten = rows.filter(r => getStatusKey(r) === 'legacy').length
  const notWritten = rows.filter(r => getStatusKey(r) === 'roadmap').length

  return (
    <>
      <main className="content-area">
        <h1>Modernization Roadmap</h1>
        <LabDisclaimer />
        <p>
          Labs are marked <strong>Modernized</strong> once they follow the current lab standard
          (dual-mode Quick Deploy and Full Lab, console-first, annotated outputs). Everything else is
          <strong> Legacy</strong> or not yet written, and is queued here.
        </p>

        <div className="roadmap-summary">
          <div className="roadmap-summary__bar">
            <div className="roadmap-summary__fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="roadmap-summary__stats">
            <span><strong>{modernized}</strong> of {total} modernized ({pct}%)</span>
            <span><strong>{legacyWritten}</strong> legacy, written</span>
            <span><strong>{notWritten}</strong> not yet written</span>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Lab</th>
              <th>Area</th>
              <th>Cloud</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const key = getStatusKey(row)
              return (
                <tr key={row.id}>
                  <td><Link to={row.to}>{row.label}</Link></td>
                  <td>{row.area}</td>
                  <td>{row.clouds.join(', ')}</td>
                  <td>
                    <span className={`status-badge status-badge--${key}`}>
                      {STATUS_LABEL[key]}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </main>
      <aside className="toc-aside" />
    </>
  )
}

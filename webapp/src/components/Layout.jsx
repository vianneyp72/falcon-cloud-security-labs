import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import ProgressBar from './ProgressBar'
import ReadingProgress from './ReadingProgress'
import { useProgress } from '../hooks/useProgress'

export default function Layout({ manifest }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const { totalChecked, totalCheckboxes } = useProgress()

  return (
    <div className="app-layout">
      <ReadingProgress />
      <header className="app-header">
        <button
          className="hamburger"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? '\u2715' : '\u2630'}
        </button>
        <div className="app-header__logo">
          <img src="/falcon-logo.png" alt="Falcon" style={{ height: '28px', width: 'auto' }} />
          Falcon Sensor Installs
        </div>
        <div className="app-header__progress">
          <ProgressBar checked={totalChecked} total={totalCheckboxes} />
        </div>
      </header>

      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      <Sidebar
        manifest={manifest}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        currentPath={location.pathname}
      />

      <Outlet />
    </div>
  )
}

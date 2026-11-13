import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import CloudLogo from './CloudLogo'
import { getStatusKey, getRoadmap } from '../content/manifest'

function SidebarLeaf({ item }) {
  return (
    <NavLink
      to={`/${item.fullRoute}`}
      className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
    >
      <span className={`sidebar-link__dot sidebar-link__dot--${getStatusKey(item)}`} />
      {item.label}
    </NavLink>
  )
}

// Cloud, service, and OS/variant groups all render through this one recursive node.
function SidebarGroup({ item, currentPath, isCloud = false }) {
  const groupPath = `/${item.path}`
  const isInGroup = currentPath === groupPath || currentPath.startsWith(`${groupPath}/`)
  const [expanded, setExpanded] = useState(isInGroup)

  useEffect(() => {
    if (isInGroup) setExpanded(true)
  }, [isInGroup])

  return (
    <div className="sidebar-section">
      <button
        className={`sidebar-section__toggle ${isCloud ? '' : 'sidebar-section__toggle--group'}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`sidebar-section__arrow ${expanded ? 'expanded' : ''}`} />
        {item.logo && <CloudLogo name={item.logo} className="sidebar-section__logo" />}
        {item.label}
      </button>
      <div className={`sidebar-section__children ${expanded ? '' : 'collapsed'}`}>
        {item.children.map((child) =>
          child.children ? (
            <SidebarGroup key={child.route} item={child} currentPath={currentPath} />
          ) : (
            <SidebarLeaf key={child.route} item={child} />
          )
        )}
      </div>
    </div>
  )
}

export default function Sidebar({ manifest, isOpen, onClose, currentPath }) {
  const { modernized, total } = getRoadmap()
  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <nav className="sidebar-nav" onClick={(e) => e.target.closest('a') && onClose?.()}>
        {manifest.map((cloud) => (
          <SidebarGroup key={cloud.route} item={cloud} currentPath={currentPath} isCloud />
        ))}
        <NavLink
          to="/roadmap"
          className={({ isActive }) => `sidebar-roadmap ${isActive ? 'active' : ''}`}
        >
          <span>Modernization Roadmap</span>
          <span className="sidebar-roadmap__count">{modernized}/{total}</span>
        </NavLink>
      </nav>
    </aside>
  )
}

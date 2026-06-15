import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

function SidebarLeaf({ item, basePath }) {
  const to = `/${item.fullRoute}`
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
    >
      <span className={`sidebar-link__dot sidebar-link__dot--${item.status}`} />
      {item.label}
    </NavLink>
  )
}

function SidebarGroup({ item, parentRoute, currentPath }) {
  const groupPath = `/${parentRoute}/${item.route}`
  const isInGroup = currentPath.startsWith(groupPath)
  const [expanded, setExpanded] = useState(isInGroup)

  useEffect(() => {
    if (isInGroup) setExpanded(true)
  }, [isInGroup])

  return (
    <div className="sidebar-section">
      <button
        className="sidebar-section__toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`sidebar-section__arrow ${expanded ? 'expanded' : ''}`} />
        {item.label}
      </button>
      <div className={`sidebar-section__children ${expanded ? '' : 'collapsed'}`}>
        {item.children.map((leaf) => (
          <SidebarLeaf key={leaf.route} item={leaf} basePath={groupPath} />
        ))}
      </div>
    </div>
  )
}

function SidebarSection({ section, currentPath }) {
  const sectionPath = `/${section.route}`
  const isInSection = currentPath.startsWith(sectionPath)
  const [expanded, setExpanded] = useState(isInSection)

  useEffect(() => {
    if (isInSection) setExpanded(true)
  }, [isInSection])

  return (
    <div className="sidebar-section">
      <button
        className="sidebar-section__toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`sidebar-section__arrow ${expanded ? 'expanded' : ''}`} />
        {section.label}
      </button>
      <div className={`sidebar-section__children ${expanded ? '' : 'collapsed'}`}>
        {section.children.map((child) =>
          child.children ? (
            <SidebarGroup
              key={child.route}
              item={child}
              parentRoute={section.route}
              currentPath={currentPath}
            />
          ) : (
            <SidebarLeaf key={child.route} item={child} />
          )
        )}
      </div>
    </div>
  )
}

export default function Sidebar({ manifest, isOpen, onClose, currentPath }) {
  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <nav className="sidebar-nav">
        {manifest.map((section) => (
          <SidebarSection
            key={section.route}
            section={section}
            currentPath={currentPath}
          />
        ))}
      </nav>
    </aside>
  )
}

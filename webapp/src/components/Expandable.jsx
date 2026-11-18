import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Click-to-expand wrapper for screenshots and UI mockups. Children render inline and again,
// larger, inside a fixed overlay. Esc, the close button, or a click on the backdrop closes it.
export default function Expandable({ label, wide = false, children }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <>
      <div className={`expandable${wide ? ' expandable--wide' : ''}`}>
        {children}
        <button
          type="button"
          className="expandable__btn"
          aria-label={`Expand ${label || 'image'}`}
          title="Expand"
          onClick={() => setOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
      </div>
      {open && createPortal(
        <div className="expandable-overlay" role="dialog" aria-label={label || 'Expanded image'} onClick={() => setOpen(false)}>
          <button type="button" className="expandable-overlay__close" aria-label="Close" title="Close (Esc)" onClick={() => setOpen(false)}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <div className={`expandable-overlay__body${wide ? ' expandable--wide' : ''}`} onClick={e => e.stopPropagation()}>{children}</div>
        </div>,
        document.body,
      )}
    </>
  )
}

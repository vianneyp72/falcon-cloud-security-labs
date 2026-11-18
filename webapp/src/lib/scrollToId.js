// Scroll to a heading, first opening any collapsed <details> sections that contain it.
export function scrollToId(id) {
  const el = document.getElementById(id)
  if (!el) return
  for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true
  requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth' }))
}

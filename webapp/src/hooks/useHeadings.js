import { useState, useEffect } from 'react'

export function useHeadings(contentRef, content) {
  const [headings, setHeadings] = useState([])

  useEffect(() => {
    // Wait for render
    const timer = setTimeout(() => {
      if (!contentRef.current) return
      const els = contentRef.current.querySelectorAll('h2, h3')
      const items = Array.from(els).map(el => ({
        id: el.id,
        text: el.textContent,
        level: parseInt(el.tagName[1]),
      })).filter(h => h.id)
      setHeadings(items)
    }, 100)

    return () => clearTimeout(timer)
  }, [content, contentRef])

  return headings
}

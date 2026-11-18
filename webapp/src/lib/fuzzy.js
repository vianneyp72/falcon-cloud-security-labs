// Small dependency-free fuzzy matcher: substring first, then an in-order subsequence match.

const isBoundary = (t, i) => i === 0 || /[^a-z0-9]/.test(t[i - 1])

// Returns { score, indices } or null. Substring matches always outrank subsequence matches.
export function fuzzyMatch(query, text, { substringOnly = false } = {}) {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return { score: 0, indices: [] }

  const at = t.indexOf(q)
  if (at !== -1) {
    const score =
      100 + (isBoundary(t, at) ? 20 : 0) + (at === 0 ? 10 : 0) + (q.length === t.length ? 20 : 0) - at * 0.1
    return { score, indices: Array.from({ length: q.length }, (_, i) => at + i) }
  }

  // Two-letter queries match too much as subsequences ("ec" -> "Falcon Cloud Run").
  if (substringOnly || q.length < 3) return null

  // Try every start position of the first character: a greedy scan from the first hit can latch
  // onto an early letter ("r" in "container") and then be rejected as too spread out.
  let best = null
  for (let start = t.indexOf(q[0]); start !== -1; start = t.indexOf(q[0], start + 1)) {
    const indices = [start]
    let score = 1 + (isBoundary(t, start) ? 6 : 0)
    let prev = start
    let ok = true
    for (const ch of q.slice(1)) {
      const found = t.indexOf(ch, prev + 1)
      if (found === -1) {
        ok = false
        break
      }
      score += 1 + (found === prev + 1 ? 8 : 0) + (isBoundary(t, found) ? 6 : 0) - (found - prev - 1) * 0.5
      indices.push(found)
      prev = found
    }
    if (!ok) break
    // Reject matches smeared across the whole string.
    if (prev - start + 1 > q.length + 2) continue
    if (!best || score > best.score) best = { score, indices }
  }
  return best
}

// Every whitespace-separated token must match. Only the lab label is matched fuzzily; the
// breadcrumb path (cloud > service > OS) and lab title are substring-only so typos in a lab name
// still work without unrelated paths leaking in.
export function searchEntries(query, entries, limit = 12) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return []

  const results = []
  for (const entry of entries) {
    const crumb = entry.breadcrumb.join(' ')
    let total = 0
    const labelIdx = new Set()
    let ok = true
    for (const token of tokens) {
      const inLabel = fuzzyMatch(token, entry.label)
      const inCrumb = fuzzyMatch(token, crumb, { substringOnly: true })
      const inExtra = entry.extra ? fuzzyMatch(token, entry.extra, { substringOnly: true }) : null
      const best = Math.max(inLabel ? inLabel.score * 3 : -1, inCrumb ? inCrumb.score * 1.5 : -1, inExtra ? inExtra.score * 0.8 : -1)
      if (best < 0) {
        ok = false
        break
      }
      total += best
      inLabel?.indices.forEach(i => labelIdx.add(i))
    }
    if (ok) results.push({ entry, score: total, indices: [...labelIdx] })
  }

  results.sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label))
  return results.slice(0, limit)
}

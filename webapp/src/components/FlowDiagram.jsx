import { useMemo, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

/**
 * Parses ASCII art architecture diagrams into React Flow nodes and edges.
 * Supports:
 * - Nested boxes (┌─┐ / │ │ / └─┘)
 * - Arrows between boxes (──►, ▼, │)
 * - Labels on connections (e.g., "SSH", "HTTPS/443")
 */

function parseAsciiDiagram(text) {
  const lines = text.split('\n')
  const nodes = []
  const edges = []

  // Find all boxes by detecting ┌ and └ pairs
  const boxes = findBoxes(lines)

  // Build hierarchy (nested boxes)
  const hierarchy = buildHierarchy(boxes)

  // Convert to React Flow nodes
  let nodeId = 0
  const boxNodeMap = new Map() // maps box index to node id

  for (const box of hierarchy) {
    const id = `node-${nodeId++}`
    boxNodeMap.set(box.index, id)

    const label = extractBoxContent(lines, box)
    const isContainer = box.children && box.children.length > 0

    nodes.push({
      id,
      position: { x: box.col * 9, y: box.row * 22 },
      data: { label, isContainer, isSubSection: box.isSubSection },
      type: 'custom',
      style: {
        width: (box.width) * 9,
        height: (box.height) * 22,
      },
    })

    if (box.children) {
      for (const child of box.children) {
        const childId = `node-${nodeId++}`
        boxNodeMap.set(child.index, childId)

        const childLabel = extractBoxContent(lines, child)
        nodes.push({
          id: childId,
          position: { x: (child.col - box.col) * 9, y: (child.row - box.row) * 22 },
          data: { label: childLabel, isContainer: false, isSubSection: child.isSubSection },
          type: 'custom',
          parentId: id,
          extent: 'parent',
          style: {
            width: (child.width) * 9,
            height: (child.height) * 22,
          },
        })
      }
    }
  }

  // Find connections (arrows between boxes)
  const connections = findConnections(lines, boxes, boxNodeMap)
  edges.push(...connections)

  return { nodes, edges }
}

function findBoxes(lines) {
  const boxes = []
  const visited = new Set()

  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]
    for (let col = 0; col < line.length; col++) {
      const key = `${row},${col}`
      if (line[col] === '┌' && !visited.has(key)) {
        const box = traceBox(lines, row, col)
        if (box) {
          box.index = boxes.length
          boxes.push(box)
          visited.add(key)
        }
      }
    }
  }

  return boxes
}

function traceBox(lines, startRow, startCol) {
  // Find the right edge of the top border
  const topLine = lines[startRow]
  let endCol = startCol + 1
  while (endCol < topLine.length && topLine[endCol] !== '┐') {
    if (topLine[endCol] !== '─' && topLine[endCol] !== '┬') return null
    endCol++
  }
  if (endCol >= topLine.length) return null

  // Find the bottom edge
  let endRow = startRow + 1
  while (endRow < lines.length) {
    const ch = lines[endRow]?.[startCol]
    if (ch === '└') break
    if (ch !== '│' && ch !== '├') return null
    endRow++
  }
  if (endRow >= lines.length) return null

  // Verify bottom-right corner
  const bottomLine = lines[endRow]
  if (!bottomLine) return null
  // The bottom right could be ┘ or ┘ could be at a different position due to sub-sections
  let bottomEndCol = startCol + 1
  while (bottomEndCol < bottomLine.length && bottomLine[bottomEndCol] !== '┘') {
    if (bottomLine[bottomEndCol] !== '─' && bottomLine[bottomEndCol] !== '┴' && bottomLine[bottomEndCol] !== '┬' && bottomLine[bottomEndCol] !== '┼') {
      break
    }
    bottomEndCol++
  }

  // Check if there's a ├───┤ divider (sub-section marker)
  let isSubSection = false
  for (let r = startRow + 1; r < endRow; r++) {
    if (lines[r]?.[startCol] === '├') {
      isSubSection = true
      break
    }
  }

  return {
    row: startRow,
    col: startCol,
    width: endCol - startCol + 1,
    height: endRow - startRow + 1,
    endRow,
    endCol,
    isSubSection,
  }
}

function buildHierarchy(boxes) {
  const roots = []
  const children = new Set()

  for (let i = 0; i < boxes.length; i++) {
    let isChild = false
    for (let j = 0; j < boxes.length; j++) {
      if (i === j) continue
      if (isInside(boxes[i], boxes[j])) {
        if (!boxes[j].children) boxes[j].children = []
        boxes[j].children.push(boxes[i])
        children.add(i)
        isChild = true
        break
      }
    }
    if (!isChild) {
      roots.push(boxes[i])
    }
  }

  return roots
}

function isInside(inner, outer) {
  return (
    inner.row > outer.row &&
    inner.col > outer.col &&
    inner.row + inner.height - 1 < outer.row + outer.height - 1 &&
    inner.col + inner.width - 1 < outer.col + outer.width - 1
  )
}

function extractBoxContent(lines, box) {
  const content = []
  for (let r = box.row + 1; r < box.row + box.height - 1; r++) {
    const line = lines[r]
    if (!line) continue
    // Extract text between the vertical borders
    let text = ''
    if (line[box.col] === '│' || line[box.col] === '├') {
      text = line.substring(box.col + 1, box.col + box.width - 1).trim()
      // Skip divider lines
      if (/^[─┬┴┼]+$/.test(text)) continue
      if (text) content.push(text)
    }
  }
  return content.join('\n')
}

function findConnections(lines, boxes, boxNodeMap) {
  const edges = []
  let edgeId = 0

  // Look for arrows (▼, ▲, ──►, ◄──) between boxes
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]
    for (let col = 0; col < line.length; col++) {
      if (line[col] === '▼' || line[col] === '▲') {
        // Vertical arrow - find source and target boxes
        const source = findBoxAbove(boxes, row, col)
        const target = findBoxBelow(boxes, row, col)
        if (source !== null && target !== null) {
          const sourceId = boxNodeMap.get(source)
          const targetId = boxNodeMap.get(target)
          if (sourceId && targetId) {
            // Check for label on the line
            const label = findEdgeLabel(lines, row, col)
            edges.push({
              id: `edge-${edgeId++}`,
              source: sourceId,
              target: targetId,
              label: label || undefined,
              type: 'smoothstep',
              animated: true,
              style: { stroke: 'var(--accent)', strokeWidth: 1.5 },
              labelStyle: { fill: 'var(--text-muted)', fontSize: 11 },
            })
          }
        }
      }
      if (line[col] === '►' || line[col] === '▶') {
        const source = findBoxLeft(boxes, row, col)
        const target = findBoxRight(boxes, row, col)
        if (source !== null && target !== null) {
          const sourceId = boxNodeMap.get(source)
          const targetId = boxNodeMap.get(target)
          if (sourceId && targetId) {
            edges.push({
              id: `edge-${edgeId++}`,
              source: sourceId,
              target: targetId,
              type: 'smoothstep',
              animated: true,
              style: { stroke: 'var(--accent)', strokeWidth: 1.5 },
            })
          }
        }
      }
    }
  }

  return edges
}

function findBoxAbove(boxes, row, col) {
  let closest = null
  let closestDist = Infinity
  for (const box of boxes) {
    const boxBottom = box.row + box.height - 1
    if (boxBottom < row && col >= box.col && col <= box.col + box.width - 1) {
      const dist = row - boxBottom
      if (dist < closestDist) {
        closestDist = dist
        closest = box.index
      }
    }
  }
  return closest
}

function findBoxBelow(boxes, row, col) {
  let closest = null
  let closestDist = Infinity
  for (const box of boxes) {
    if (box.row > row && col >= box.col && col <= box.col + box.width - 1) {
      const dist = box.row - row
      if (dist < closestDist) {
        closestDist = dist
        closest = box.index
      }
    }
  }
  return closest
}

function findBoxLeft(boxes, row, col) {
  let closest = null
  let closestDist = Infinity
  for (const box of boxes) {
    const boxRight = box.col + box.width - 1
    if (boxRight < col && row >= box.row && row <= box.row + box.height - 1) {
      const dist = col - boxRight
      if (dist < closestDist) {
        closestDist = dist
        closest = box.index
      }
    }
  }
  return closest
}

function findBoxRight(boxes, row, col) {
  let closest = null
  let closestDist = Infinity
  for (const box of boxes) {
    if (box.col > col && row >= box.row && row <= box.row + box.height - 1) {
      const dist = box.col - col
      if (dist < closestDist) {
        closestDist = dist
        closest = box.index
      }
    }
  }
  return closest
}

function findEdgeLabel(lines, row, col) {
  // Check same line for text near the arrow
  const line = lines[row]
  const before = line.substring(Math.max(0, col - 20), col).trim()
  const after = line.substring(col + 1, col + 20).trim()

  // Filter out box-drawing chars
  const cleanBefore = before.replace(/[│├└┌┐┘─┬┴┼┤▼▲►◄▶]/g, '').trim()
  const cleanAfter = after.replace(/[│├└┌┐┘─┬┴┼┤▼▲►◄▶]/g, '').trim()

  if (cleanBefore) return cleanBefore
  if (cleanAfter) return cleanAfter

  // Check the line above for labels
  if (row > 0) {
    const above = lines[row - 1]
    const nearText = above.substring(Math.max(0, col - 10), col + 10).trim()
    const clean = nearText.replace(/[│├└┌┐┘─┬┴┼┤▼▲►◄▶]/g, '').trim()
    if (clean && !clean.includes('┐') && clean.length < 20) return clean
  }

  return null
}

// Custom node component
function CustomNode({ data }) {
  const { label, isContainer, isSubSection, isCloud, isPhase, isApi, isDanger, sublabel, items } = data
  const lines = label.split('\n').filter(l => l.trim())

  const containerClass = [
    'flow-node',
    isContainer ? 'flow-node--container' : '',
    isCloud ? 'flow-node--cloud' : '',
    isDanger ? 'flow-node--danger' : '',
    isPhase ? 'flow-node--phase' : '',
    isApi ? 'flow-node--api' : '',
    isSubSection ? 'flow-node--sectioned' : '',
  ].filter(Boolean).join(' ')

  const hs = { background: 'transparent', border: 'none', width: 1, height: 1 }

  const handles = (
    <>
      <Handle type="target" position={Position.Top} id="top-target" style={hs} />
      <Handle type="target" position={Position.Left} id="left-target" style={hs} />
      <Handle type="source" position={Position.Bottom} style={hs} />
      <Handle type="source" position={Position.Right} id="right-source" style={hs} />
    </>
  )

  if (items && items.length > 0) {
    return (
      <div className={containerClass}>
        {handles}
        <div className="flow-node__title">{lines[0]}</div>
        {items.map((item, i) => (
          <div key={i} className="flow-node__detail">• {item}</div>
        ))}
      </div>
    )
  }

  if (isSubSection) {
    const sections = []
    let current = []
    for (const line of lines) {
      if (/^[─]+$/.test(line)) {
        sections.push(current)
        current = []
      } else {
        current.push(line)
      }
    }
    if (current.length) sections.push(current)

    return (
      <div className={containerClass}>
        {handles}
        {sections.map((section, i) => (
          <div key={i} className="flow-node__section">
            {section.map((l, j) => (
              <div key={j} className={j === 0 ? 'flow-node__section-title' : 'flow-node__section-item'}>
                {l}
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={containerClass}>
      {handles}
      <div className="flow-node__title">{lines[0]}</div>
      {sublabel && <div className="flow-node__subtitle">{sublabel}</div>}
      {lines.slice(1).map((l, i) => (
        <div key={i} className="flow-node__detail">{l}</div>
      ))}
    </div>
  )
}

const nodeTypes = { custom: CustomNode }

/**
 * A simpler approach: Instead of parsing the complex ASCII, define diagrams
 * declaratively based on content detection.
 */
function buildSensorArchDiagram(text) {
  const nodes = [
    {
      id: 'linux-host',
      position: { x: 100, y: 0 },
      data: { label: 'Linux Host', isContainer: true },
      type: 'custom',
      style: { width: 280, height: 220 },
    },
    {
      id: 'falcon-sensor',
      position: { x: 40, y: 45 },
      data: { label: 'falcon-sensor', sublabel: 'userspace daemon' },
      type: 'custom',
      parentId: 'linux-host',
      extent: 'parent',
      style: { width: 200, height: 55 },
    },
    {
      id: 'kernel',
      position: { x: 40, y: 140 },
      data: { label: 'Linux Kernel', sublabel: 'syscalls, fs, net' },
      type: 'custom',
      parentId: 'linux-host',
      extent: 'parent',
      style: { width: 200, height: 55 },
    },
    {
      id: 'falcon-cloud',
      position: { x: 140, y: 280 },
      data: { label: 'CrowdStrike Falcon Cloud', sublabel: 'Detections & policy', isCloud: true },
      type: 'custom',
      style: { width: 200, height: 55 },
    },
  ]

  const edges = [
    { id: 'e-sensor-kernel', source: 'falcon-sensor', target: 'kernel', label: 'eBPF probes', type: 'smoothstep', animated: true, style: { stroke: '#a371f7', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#a371f7' } },
    { id: 'e-host-cloud', source: 'linux-host', target: 'falcon-cloud', label: 'TLS 443', type: 'smoothstep', animated: true, style: { stroke: '#3fb950', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#3fb950' } },
  ]

  return { nodes, edges }
}

function buildCloudRunPipelineDiagram(text) {
  const nodes = [
    // GitHub Actions Runner container
    {
      id: 'gh-runner',
      position: { x: 0, y: 0 },
      data: { label: 'GitHub Actions Runner', isContainer: true },
      type: 'custom',
      style: { width: 620, height: 280 },
    },
    {
      id: 'sensor-image',
      position: { x: 190, y: 40 },
      data: { label: 'Falcon Container Image', sublabel: 'falcon-container:latest' },
      type: 'custom',
      parentId: 'gh-runner',
      extent: 'parent',
      style: { width: 230, height: 55 },
    },
    {
      id: 'wif-auth',
      position: { x: 20, y: 160 },
      data: { label: 'Auth to GCP', sublabel: 'WIF + GAR' },
      type: 'custom',
      parentId: 'gh-runner',
      extent: 'parent',
      style: { width: 130, height: 55 },
    },
    {
      id: 'falconutil',
      position: { x: 200, y: 160 },
      data: { label: 'falconutil patch-image', sublabel: 'app:1.0 → app:1.0-falcon' },
      type: 'custom',
      parentId: 'gh-runner',
      extent: 'parent',
      style: { width: 230, height: 55 },
    },
    {
      id: 'push-patched',
      position: { x: 470, y: 160 },
      data: { label: 'docker push', sublabel: 'app:1.0-falcon → GAR' },
      type: 'custom',
      parentId: 'gh-runner',
      extent: 'parent',
      style: { width: 135, height: 55 },
    },
    // GAR
    {
      id: 'gar',
      position: { x: 50, y: 380 },
      data: {
        label: 'Google Artifact Registry (GAR)',
        sublabel: 'app:1.0 | app:1.0-falcon | falcon-container:latest',
        isContainer: true,
      },
      type: 'custom',
      style: { width: 520, height: 70 },
    },
    // Cloud Run
    {
      id: 'cloud-run',
      position: { x: 190, y: 510 },
      data: { label: 'Google Cloud Run (gen2)', sublabel: 'falcon-sensor + your app', isCloud: true },
      type: 'custom',
      style: { width: 240, height: 55 },
    },
  ]

  const edges = [
    // Auth → falconutil (right to left, horizontal pipeline)
    { id: 'e-auth-patch', source: 'wif-auth', sourceHandle: 'right-source', target: 'falconutil', targetHandle: 'left-target', type: 'smoothstep', animated: true, style: { stroke: '#61C4C9', strokeWidth: 1.5 }, markerEnd: { type: 'arrowclosed', color: '#61C4C9' } },
    // falconutil → docker push (right to left, horizontal pipeline)
    { id: 'e-patch-push', source: 'falconutil', sourceHandle: 'right-source', target: 'push-patched', targetHandle: 'left-target', type: 'smoothstep', animated: true, style: { stroke: '#61C4C9', strokeWidth: 1.5 }, markerEnd: { type: 'arrowclosed', color: '#61C4C9' } },
    // Sensor image feeds into falconutil
    { id: 'e-sensor-patch', source: 'sensor-image', target: 'falconutil', label: 'sensor layers', type: 'smoothstep', animated: true, style: { stroke: '#a371f7', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#a371f7' } },
    // Push sends patched image down to GAR
    { id: 'e-push-gar', source: 'push-patched', target: 'gar', label: 'push :1.0-falcon', type: 'smoothstep', animated: true, style: { stroke: '#d29922', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
    // GAR deploys to Cloud Run
    { id: 'e-gar-run', source: 'gar', target: 'cloud-run', label: 'Deploy :*-falcon only', type: 'smoothstep', animated: true, style: { stroke: '#3fb950', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#3fb950' } },
  ]

  return { nodes, edges }
}

function buildGitHubActionsPatchDiagram(text) {
  const nodes = [
    // GitHub Actions Runner container
    {
      id: 'gh-runner',
      position: { x: 40, y: 0 },
      data: { label: 'GitHub Actions Runner', isContainer: true },
      type: 'custom',
      style: { width: 480, height: 180 },
    },
    {
      id: 'ecr-login',
      position: { x: 20, y: 50 },
      data: { label: 'ECR Login', sublabel: 'OIDC role' },
      type: 'custom',
      parentId: 'gh-runner',
      extent: 'parent',
      style: { width: 120, height: 55 },
    },
    {
      id: 'falconutil-action',
      position: { x: 175, y: 50 },
      data: { label: 'falconutil-action', sublabel: 'source → target' },
      type: 'custom',
      parentId: 'gh-runner',
      extent: 'parent',
      style: { width: 140, height: 55 },
    },
    {
      id: 'push-ecr',
      position: { x: 350, y: 50 },
      data: { label: 'Push patched', sublabel: 'image to ECR' },
      type: 'custom',
      parentId: 'gh-runner',
      extent: 'parent',
      style: { width: 120, height: 55 },
    },
    // ECR repos
    {
      id: 'ecr-apps',
      position: { x: 0, y: 230 },
      data: {
        label: 'ECR Repositories',
        sublabel: ':1.0 (unpatched) / :1.0-falcon (patched)',
        isContainer: true,
      },
      type: 'custom',
      style: { width: 360, height: 70 },
    },
    // Falcon sensor image
    {
      id: 'falcon-sensor-ecr',
      position: { x: 390, y: 230 },
      data: { label: 'Falcon Container', sublabel: 'falcon-container:latest' },
      type: 'custom',
      style: { width: 160, height: 70 },
    },
  ]

  const edges = [
    { id: 'e-login-action', source: 'ecr-login', target: 'falconutil-action', type: 'smoothstep', animated: true, style: { stroke: '#61C4C9', strokeWidth: 1.5 }, markerEnd: { type: 'arrowclosed', color: '#61C4C9' } },
    { id: 'e-action-push', source: 'falconutil-action', target: 'push-ecr', type: 'smoothstep', animated: true, style: { stroke: '#61C4C9', strokeWidth: 1.5 }, markerEnd: { type: 'arrowclosed', color: '#61C4C9' } },
    { id: 'e-push-ecr', source: 'push-ecr', target: 'ecr-apps', label: 'docker push', type: 'smoothstep', animated: true, style: { stroke: '#d29922', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
    { id: 'e-sensor-action', source: 'falcon-sensor-ecr', target: 'falconutil-action', label: 'sensor layer', type: 'smoothstep', animated: true, style: { stroke: '#a371f7', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#a371f7' } },
  ]

  return { nodes, edges }
}

function buildFcsImageScanDiagram(text) {
  const nodes = [
    // GitHub Actions Runner
    {
      id: 'gh-runner',
      position: { x: 20, y: 0 },
      data: { label: 'GitHub Actions Runner', isContainer: true },
      type: 'custom',
      style: { width: 360, height: 160 },
    },
    {
      id: 'docker-build',
      position: { x: 20, y: 50 },
      data: { label: 'docker build', sublabel: 'Local Image' },
      type: 'custom',
      parentId: 'gh-runner',
      extent: 'parent',
      style: { width: 130, height: 55 },
    },
    {
      id: 'fcs-scan',
      position: { x: 190, y: 50 },
      data: { label: 'fcs-action', sublabel: 'scan image' },
      type: 'custom',
      parentId: 'gh-runner',
      extent: 'parent',
      style: { width: 130, height: 55 },
    },
    // CrowdStrike Cloud
    {
      id: 'cs-cloud',
      position: { x: 440, y: 30 },
      data: { label: 'CrowdStrike Cloud', sublabel: 'Image Assessment', isCloud: true },
      type: 'custom',
      style: { width: 180, height: 55 },
    },
    // Gate decision
    {
      id: 'gate',
      position: { x: 170, y: 210 },
      data: { label: 'Gate', sublabel: 'exit code 0 = pass' },
      type: 'custom',
      style: { width: 140, height: 55 },
    },
    // ghcr.io
    {
      id: 'ghcr',
      position: { x: 440, y: 210 },
      data: { label: 'ghcr.io', sublabel: 'Container Registry', isCloud: true },
      type: 'custom',
      style: { width: 160, height: 55 },
    },
  ]

  const edges = [
    { id: 'e-build-scan', source: 'docker-build', target: 'fcs-scan', type: 'smoothstep', animated: true, style: { stroke: '#61C4C9', strokeWidth: 1.5 }, markerEnd: { type: 'arrowclosed', color: '#61C4C9' } },
    { id: 'e-scan-cloud', source: 'fcs-scan', target: 'cs-cloud', label: 'Inventory only', type: 'smoothstep', animated: true, style: { stroke: '#a371f7', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#a371f7' } },
    { id: 'e-cloud-gate', source: 'cs-cloud', target: 'gate', label: 'Pass / Fail', type: 'smoothstep', animated: true, style: { stroke: '#a371f7', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#a371f7' } },
    { id: 'e-gate-push', source: 'gate', target: 'ghcr', label: 'docker push', type: 'smoothstep', animated: true, style: { stroke: '#3fb950', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#3fb950' } },
  ]

  return { nodes, edges }
}

function buildEksHybridDiagram(text) {
  const nodes = [
    // EKS Hybrid cluster container
    {
      id: 'cluster',
      position: { x: 0, y: 0 },
      data: { label: 'EKS Hybrid Cluster', sublabel: 'EC2 nodes + Fargate pods', isContainer: true },
      type: 'custom',
      style: { width: 970, height: 600 },
    },
    // Two controllers on the top row — Injector feeds Fargate, DaemonSet feeds EC2
    {
      id: 'injector',
      position: { x: 25, y: 60 },
      data: { label: 'Falcon Injector', sublabel: 'mutating webhook — injects sidecar', isApi: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      zIndex: 20,
      style: { width: 280, height: 58 },
    },
    {
      id: 'daemonset',
      position: { x: 345, y: 60 },
      data: { label: 'DaemonSet', sublabel: '1 sensor pod per EC2 node', isPhase: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      zIndex: 20,
      style: { width: 600, height: 58 },
    },
    // Fargate node column (amber) — app + injected sidecar
    {
      id: 'node-fargate',
      position: { x: 25, y: 150 },
      data: { label: 'Fargate Node', sublabel: 'micro-VM (one pod)', isContainer: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      style: { width: 280, height: 400, borderColor: 'rgba(210, 153, 34, 0.45)' },
    },
    {
      id: 'sidecar-f',
      position: { x: 25, y: 45 },
      data: { label: 'falcon-sensor', sublabel: 'sidecar (user space)' },
      type: 'custom',
      parentId: 'node-fargate',
      extent: 'parent',
      style: { width: 230, height: 48 },
    },
    {
      id: 'app-f',
      position: { x: 25, y: 100 },
      data: { label: 'app container', sublabel: 'your workload' },
      type: 'custom',
      parentId: 'node-fargate',
      extent: 'parent',
      style: { width: 230, height: 48 },
    },
    // EC2 node 1 — app + DaemonSet sensor pod
    {
      id: 'node-ec2-1',
      position: { x: 345, y: 150 },
      data: { label: 'EC2 Node 1', sublabel: 'managed node group', isContainer: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      style: { width: 280, height: 400 },
    },
    {
      id: 'ds-e1',
      position: { x: 25, y: 45 },
      data: { label: 'falcon-sensor', sublabel: 'DaemonSet pod (eBPF)' },
      type: 'custom',
      parentId: 'node-ec2-1',
      extent: 'parent',
      style: { width: 230, height: 48 },
    },
    {
      id: 'app-e1',
      position: { x: 25, y: 100 },
      data: { label: 'app container', sublabel: 'your workload' },
      type: 'custom',
      parentId: 'node-ec2-1',
      extent: 'parent',
      style: { width: 230, height: 48 },
    },
    // EC2 node 2 — app + DaemonSet sensor pod
    {
      id: 'node-ec2-2',
      position: { x: 665, y: 150 },
      data: { label: 'EC2 Node 2', sublabel: 'managed node group', isContainer: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      style: { width: 280, height: 400 },
    },
    {
      id: 'ds-e2',
      position: { x: 25, y: 45 },
      data: { label: 'falcon-sensor', sublabel: 'DaemonSet pod (eBPF)' },
      type: 'custom',
      parentId: 'node-ec2-2',
      extent: 'parent',
      style: { width: 230, height: 48 },
    },
    {
      id: 'app-e2',
      position: { x: 25, y: 100 },
      data: { label: 'app container', sublabel: 'your workload' },
      type: 'custom',
      parentId: 'node-ec2-2',
      extent: 'parent',
      style: { width: 230, height: 48 },
    },
    // Falcon IAR — wide band spanning all nodes (runs on EC2)
    {
      id: 'iar',
      position: { x: 35, y: 355 },
      data: { label: 'Falcon Image Analyzer', sublabel: 'Deployment — Image Assessment, lands on EC2' },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      zIndex: 10,
      style: { width: 900, height: 65 },
    },
    // Falcon KAC — wide band spanning all nodes (runs on EC2)
    {
      id: 'kac',
      position: { x: 35, y: 445 },
      data: { label: 'Falcon KAC', sublabel: 'Deployment — Admission Controller, lands on EC2' },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      zIndex: 10,
      style: { width: 900, height: 65 },
    },
    // External: image registry — left, holds both sensor images
    {
      id: 'cs-registry',
      position: { x: -490, y: 55 },
      data: { label: 'Image Registry', sublabel: 'CrowdStrike or ECR — LUMOS Sensor Image + DaemonSet Sensor Image', isCloud: true },
      type: 'custom',
      style: { width: 320, height: 80 },
    },
    // External: CrowdStrike cloud — below, receives telemetry from both paths
    {
      id: 'cs-cloud',
      position: { x: 370, y: 660 },
      data: { label: 'CrowdStrike Cloud', sublabel: 'Telemetry & Detections', isDanger: true },
      type: 'custom',
      style: { width: 230, height: 60 },
    },
  ]

  const edges = [
    // Injector patches each new Fargate pod → adds the Falcon sidecar
    { id: 'e-inj-f', source: 'injector', target: 'sidecar-f', label: 'injects', type: 'smoothstep', animated: true, zIndex: 20, style: { stroke: '#a371f7', strokeWidth: 1.5, strokeDasharray: '4 3' }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#a371f7' } },
    // DaemonSet schedules one sensor pod onto each EC2 node
    { id: 'e-ds-e1', source: 'daemonset', target: 'ds-e1', label: 'deploys', type: 'smoothstep', zIndex: 20, style: { stroke: '#f85149', strokeWidth: 1.5, strokeDasharray: '5 4' }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#f85149' } },
    { id: 'e-ds-e2', source: 'daemonset', target: 'ds-e2', type: 'smoothstep', zIndex: 20, style: { stroke: '#f85149', strokeWidth: 1.5, strokeDasharray: '5 4' }, markerEnd: { type: 'arrowclosed', color: '#f85149' } },
    // Image pulls — registry feeds the sidecar (LUMOS) + DaemonSet sensor + KAC + IAR
    { id: 'e-reg-inj', source: 'cs-registry', sourceHandle: 'right-source', target: 'injector', targetHandle: 'top-target', label: 'LUMOS image', type: 'smoothstep', animated: true, zIndex: 20, style: { stroke: '#d29922', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
    { id: 'e-reg-ds', source: 'cs-registry', sourceHandle: 'right-source', target: 'daemonset', targetHandle: 'top-target', label: 'sensor image', type: 'smoothstep', zIndex: 20, style: { stroke: '#d29922', strokeWidth: 1.5, strokeDasharray: '4 3' }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
    { id: 'e-reg-iar', source: 'cs-registry', sourceHandle: 'right-source', target: 'iar', targetHandle: 'left-target', type: 'smoothstep', zIndex: 5, style: { stroke: '#d29922', strokeWidth: 1.5, strokeDasharray: '4 3' }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
    { id: 'e-reg-kac', source: 'cs-registry', sourceHandle: 'right-source', target: 'kac', targetHandle: 'left-target', type: 'smoothstep', zIndex: 5, style: { stroke: '#d29922', strokeWidth: 1.5, strokeDasharray: '4 3' }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
    // Telemetry — Fargate sidecar + EC2 DaemonSet sensors report to the cloud
    { id: 'e-f-cloud', source: 'sidecar-f', target: 'cs-cloud', type: 'smoothstep', zIndex: 0, style: { stroke: '#f85149', strokeWidth: 1.5, strokeDasharray: '5 4' } },
    { id: 'e-e1-cloud', source: 'ds-e1', target: 'cs-cloud', label: 'TLS 443', type: 'smoothstep', animated: true, zIndex: 0, style: { stroke: '#f85149', strokeWidth: 1.5, strokeDasharray: '5 4' }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#f85149' } },
    { id: 'e-e2-cloud', source: 'ds-e2', target: 'cs-cloud', type: 'smoothstep', zIndex: 0, style: { stroke: '#f85149', strokeWidth: 1.5, strokeDasharray: '5 4' } },
  ]

  return { nodes, edges }
}

function buildEksFargateDiagram(text) {
  const nodes = [
    // EKS Fargate cluster container
    {
      id: 'cluster',
      position: { x: 0, y: 0 },
      data: { label: 'EKS Fargate Cluster', sublabel: 'serverless — no EC2 nodes', isContainer: true },
      type: 'custom',
      style: { width: 920, height: 580 },
    },
    // Falcon injector — top center, mutating webhook that patches every new pod
    {
      id: 'injector',
      position: { x: 335, y: 60 },
      data: { label: 'Falcon Injector', sublabel: 'mutating webhook — injects sidecar', isApi: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      zIndex: 20,
      style: { width: 250, height: 58 },
    },
    // 3 Fargate node columns — each pod is its own micro-VM ("node")
    {
      id: 'node1',
      position: { x: 25, y: 150 },
      data: { label: 'Fargate Node 1', sublabel: 'micro-VM (one pod)', isContainer: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      style: { width: 250, height: 400 },
    },
    {
      id: 'node2',
      position: { x: 335, y: 150 },
      data: { label: 'Fargate Node 2', sublabel: 'micro-VM (one pod)', isContainer: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      style: { width: 250, height: 400 },
    },
    {
      id: 'node3',
      position: { x: 645, y: 150 },
      data: { label: 'Fargate Node 3', sublabel: 'micro-VM (one pod)', isContainer: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      style: { width: 250, height: 400 },
    },
    // App container + injected Falcon sidecar inside each Fargate node
    {
      id: 'app1',
      position: { x: 25, y: 45 },
      data: { label: 'app container', sublabel: 'your workload' },
      type: 'custom',
      parentId: 'node1',
      extent: 'parent',
      style: { width: 200, height: 48 },
    },
    {
      id: 'sidecar1',
      position: { x: 25, y: 100 },
      data: { label: 'falcon-sensor', sublabel: 'sidecar (user space)' },
      type: 'custom',
      parentId: 'node1',
      extent: 'parent',
      style: { width: 200, height: 48 },
    },
    {
      id: 'app2',
      position: { x: 25, y: 45 },
      data: { label: 'app container', sublabel: 'your workload' },
      type: 'custom',
      parentId: 'node2',
      extent: 'parent',
      style: { width: 200, height: 48 },
    },
    {
      id: 'sidecar2',
      position: { x: 25, y: 100 },
      data: { label: 'falcon-sensor', sublabel: 'sidecar (user space)' },
      type: 'custom',
      parentId: 'node2',
      extent: 'parent',
      style: { width: 200, height: 48 },
    },
    {
      id: 'app3',
      position: { x: 25, y: 45 },
      data: { label: 'app container', sublabel: 'your workload' },
      type: 'custom',
      parentId: 'node3',
      extent: 'parent',
      style: { width: 200, height: 48 },
    },
    {
      id: 'sidecar3',
      position: { x: 25, y: 100 },
      data: { label: 'falcon-sensor', sublabel: 'sidecar (user space)' },
      type: 'custom',
      parentId: 'node3',
      extent: 'parent',
      style: { width: 200, height: 48 },
    },
    // Falcon IAR — wide band spanning all 3 nodes
    {
      id: 'iar',
      position: { x: 35, y: 355 },
      data: { label: 'Falcon Image Analyzer', sublabel: 'Deployment (Watcher) — spans all nodes' },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      zIndex: 10,
      style: { width: 850, height: 65 },
    },
    // Falcon KAC — wide band spanning all 3 nodes
    {
      id: 'kac',
      position: { x: 35, y: 445 },
      data: { label: 'Falcon KAC', sublabel: 'Deployment — Admission Controller, spans all nodes' },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      zIndex: 10,
      style: { width: 850, height: 65 },
    },
    // External: image registry — top-left so its sensor-image line stays above the node columns
    {
      id: 'cs-registry',
      position: { x: -470, y: 55 },
      data: { label: 'Image Registry', sublabel: 'CrowdStrike or ECR — sensor, KAC & IAR images', isCloud: true },
      type: 'custom',
      style: { width: 300, height: 70 },
    },
    // External: CrowdStrike cloud — dropped below so telemetry (TLS 443) lines are visible
    {
      id: 'cs-cloud',
      position: { x: 345, y: 640 },
      data: { label: 'CrowdStrike Cloud', sublabel: 'Telemetry & Detections', isDanger: true },
      type: 'custom',
      style: { width: 230, height: 60 },
    },
  ]

  const edges = [
    // Injector patches each new pod → adds the Falcon sidecar (top-down)
    { id: 'e-inj-s1', source: 'injector', target: 'sidecar1', label: 'injects', type: 'smoothstep', animated: true, zIndex: 20, style: { stroke: '#a371f7', strokeWidth: 1.5, strokeDasharray: '4 3' }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#a371f7' } },
    { id: 'e-inj-s2', source: 'injector', target: 'sidecar2', type: 'smoothstep', zIndex: 20, style: { stroke: '#a371f7', strokeWidth: 1.5, strokeDasharray: '4 3' }, markerEnd: { type: 'arrowclosed', color: '#a371f7' } },
    { id: 'e-inj-s3', source: 'injector', target: 'sidecar3', type: 'smoothstep', zIndex: 20, style: { stroke: '#a371f7', strokeWidth: 1.5, strokeDasharray: '4 3' }, markerEnd: { type: 'arrowclosed', color: '#a371f7' } },
    // Image pulls — registry feeds the injector (sensor image) plus KAC & IAR from the left
    { id: 'e-reg-inj', source: 'cs-registry', sourceHandle: 'right-source', target: 'injector', targetHandle: 'left-target', label: 'sensor image', type: 'smoothstep', animated: true, zIndex: 20, style: { stroke: '#d29922', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
    { id: 'e-reg-iar', source: 'cs-registry', sourceHandle: 'right-source', target: 'iar', targetHandle: 'left-target', type: 'smoothstep', zIndex: 5, style: { stroke: '#d29922', strokeWidth: 1.5, strokeDasharray: '4 3' }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
    { id: 'e-reg-kac', source: 'cs-registry', sourceHandle: 'right-source', target: 'kac', targetHandle: 'left-target', type: 'smoothstep', zIndex: 5, style: { stroke: '#d29922', strokeWidth: 1.5, strokeDasharray: '4 3' }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
    // Telemetry — each sidecar drops down to the cloud (dashed red, behind the bands)
    { id: 'e-s1-cloud', source: 'sidecar1', target: 'cs-cloud', type: 'smoothstep', zIndex: 0, style: { stroke: '#f85149', strokeWidth: 1.5, strokeDasharray: '5 4' } },
    { id: 'e-s2-cloud', source: 'sidecar2', target: 'cs-cloud', label: 'TLS 443', type: 'smoothstep', animated: true, zIndex: 0, style: { stroke: '#f85149', strokeWidth: 1.5, strokeDasharray: '5 4' }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#f85149' } },
    { id: 'e-s3-cloud', source: 'sidecar3', target: 'cs-cloud', type: 'smoothstep', zIndex: 0, style: { stroke: '#f85149', strokeWidth: 1.5, strokeDasharray: '5 4' } },
  ]

  return { nodes, edges }
}

function buildK8sDaemonsetDiagram(text) {
  const nodes = [
    // Kubernetes Cluster container
    {
      id: 'cluster',
      position: { x: 0, y: 0 },
      data: { label: 'Kubernetes Cluster', isContainer: true },
      type: 'custom',
      style: { width: 820, height: 540 },
    },
    // 3 tall Node columns (rendered first = behind everything else)
    {
      id: 'node1',
      position: { x: 25, y: 55 },
      data: { label: 'Node 1', isContainer: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      style: { width: 240, height: 460 },
    },
    {
      id: 'node2',
      position: { x: 290, y: 55 },
      data: { label: 'Node 2', isContainer: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      style: { width: 240, height: 460 },
    },
    {
      id: 'node3',
      position: { x: 555, y: 55 },
      data: { label: 'Node 3', isContainer: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      style: { width: 240, height: 460 },
    },
    // DaemonSet band — spans all 3 nodes, contains 3 sensor pods
    {
      id: 'daemonset',
      position: { x: 35, y: 100 },
      data: { label: 'DaemonSet — 1 pod per node', isContainer: true, isPhase: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      style: { width: 750, height: 130 },
    },
    {
      id: 'sensor1',
      position: { x: 25, y: 50 },
      data: { label: 'falcon-sensor', sublabel: 'DaemonSet pod' },
      type: 'custom',
      parentId: 'daemonset',
      extent: 'parent',
      style: { width: 190, height: 55 },
    },
    {
      id: 'sensor2',
      position: { x: 280, y: 50 },
      data: { label: 'falcon-sensor', sublabel: 'DaemonSet pod' },
      type: 'custom',
      parentId: 'daemonset',
      extent: 'parent',
      style: { width: 190, height: 55 },
    },
    {
      id: 'sensor3',
      position: { x: 535, y: 50 },
      data: { label: 'falcon-sensor', sublabel: 'DaemonSet pod' },
      type: 'custom',
      parentId: 'daemonset',
      extent: 'parent',
      style: { width: 190, height: 55 },
    },
    // Falcon Image Analyzer — wide band spanning all 3 nodes
    {
      id: 'iar',
      position: { x: 35, y: 270 },
      data: { label: 'Falcon Image Analyzer', sublabel: 'Deployment (1 replica) — Image Assessment' },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      zIndex: 10,
      style: { width: 750, height: 70 },
    },
    // Falcon KAC — wide band spanning all 3 nodes
    {
      id: 'kac',
      position: { x: 35, y: 380 },
      data: { label: 'Falcon KAC', sublabel: 'Deployment (1 replica) — Admission Controller' },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      zIndex: 10,
      style: { width: 750, height: 70 },
    },
    // External: image registry — left, feeds sensor, KAC & IAR images
    {
      id: 'cs-registry',
      position: { x: -460, y: 60 },
      data: { label: 'Image Registry', sublabel: 'CrowdStrike registry — sensor, KAC & IAR images', isCloud: true },
      type: 'custom',
      style: { width: 300, height: 80 },
    },
    // CrowdStrike Cloud — centered below cluster
    {
      id: 'cs-cloud',
      position: { x: 345, y: 620 },
      data: { label: 'CrowdStrike Cloud', sublabel: 'Telemetry & Detections', isDanger: true },
      type: 'custom',
      style: { width: 230, height: 60 },
    },
  ]

  const edges = [
    // Image pulls — registry feeds the DaemonSet sensor, KAC & IAR (amber, from the left)
    { id: 'e-reg-ds', source: 'cs-registry', sourceHandle: 'right-source', target: 'daemonset', targetHandle: 'left-target', label: 'sensor image', type: 'smoothstep', animated: true, zIndex: 20, style: { stroke: '#d29922', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
    { id: 'e-reg-iar', source: 'cs-registry', sourceHandle: 'right-source', target: 'iar', targetHandle: 'left-target', type: 'smoothstep', zIndex: 5, style: { stroke: '#d29922', strokeWidth: 1.5, strokeDasharray: '4 3' }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
    { id: 'e-reg-kac', source: 'cs-registry', sourceHandle: 'right-source', target: 'kac', targetHandle: 'left-target', type: 'smoothstep', zIndex: 5, style: { stroke: '#d29922', strokeWidth: 1.5, strokeDasharray: '4 3' }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
    // Sensors → CrowdStrike Cloud (smoothstep dashed red lines, behind IAR/KAC)
    { id: 'e-s1-cloud', source: 'sensor1', target: 'cs-cloud', type: 'smoothstep', zIndex: 0, style: { stroke: '#f85149', strokeWidth: 1.5, strokeDasharray: '5 4' } },
    { id: 'e-s2-cloud', source: 'sensor2', target: 'cs-cloud', label: 'TLS 443', type: 'smoothstep', zIndex: 0, animated: true, style: { stroke: '#f85149', strokeWidth: 1.5, strokeDasharray: '5 4' }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#f85149' } },
    { id: 'e-s3-cloud', source: 'sensor3', target: 'cs-cloud', type: 'smoothstep', zIndex: 0, style: { stroke: '#f85149', strokeWidth: 1.5, strokeDasharray: '5 4' } },
  ]

  return { nodes, edges }
}

function buildGkeAutopilotDiagram(text) {
  const nodes = [
    // GKE Autopilot cluster container
    {
      id: 'cluster',
      position: { x: 0, y: 0 },
      data: { label: 'GKE Autopilot Cluster', isContainer: true },
      type: 'custom',
      style: { width: 920, height: 680 },
    },
    // Allowlist authorization chain — top row, reads left-to-right
    // (wide gaps so the fetch/authorize connectors are clearly visible)
    {
      id: 'synchronizer',
      position: { x: 30, y: 65 },
      data: { label: 'AllowlistSynchronizer', sublabel: 'CRD you apply' },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      zIndex: 20,
      style: { width: 250, height: 58 },
    },
    {
      id: 'allowlists',
      position: { x: 335, y: 65 },
      data: { label: 'WorkloadAllowlists', sublabel: 'fetched from CrowdStrike' },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      zIndex: 20,
      style: { width: 250, height: 58 },
    },
    {
      id: 'warden',
      position: { x: 640, y: 65 },
      data: { label: 'GKE Warden', sublabel: 'admission enforcement', isApi: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      zIndex: 20,
      style: { width: 250, height: 58 },
    },
    // 3 tall Node columns (rendered first = behind everything else)
    {
      id: 'node1',
      position: { x: 25, y: 165 },
      data: { label: 'Node 1', isContainer: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      style: { width: 250, height: 460 },
    },
    {
      id: 'node2',
      position: { x: 325, y: 165 },
      data: { label: 'Node 2', isContainer: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      style: { width: 250, height: 460 },
    },
    {
      id: 'node3',
      position: { x: 625, y: 165 },
      data: { label: 'Node 3', isContainer: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      style: { width: 250, height: 460 },
    },
    // DaemonSet band — spans all 3 nodes, one privileged sensor pod per node
    {
      id: 'daemonset',
      position: { x: 35, y: 215 },
      data: { label: 'DaemonSet — falcon-sensor (1 privileged pod per node)', isContainer: true, isPhase: true },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      style: { width: 845, height: 130 },
    },
    {
      id: 'sensor1',
      position: { x: 15, y: 55 },
      data: { label: 'falcon-sensor', sublabel: 'bpf backend' },
      type: 'custom',
      parentId: 'daemonset',
      extent: 'parent',
      style: { width: 200, height: 55 },
    },
    {
      id: 'sensor2',
      position: { x: 315, y: 55 },
      data: { label: 'falcon-sensor', sublabel: 'bpf backend' },
      type: 'custom',
      parentId: 'daemonset',
      extent: 'parent',
      style: { width: 200, height: 55 },
    },
    {
      id: 'sensor3',
      position: { x: 615, y: 55 },
      data: { label: 'falcon-sensor', sublabel: 'bpf backend' },
      type: 'custom',
      parentId: 'daemonset',
      extent: 'parent',
      style: { width: 200, height: 55 },
    },
    // Falcon Image Analyzer — wide band spanning all 3 nodes
    {
      id: 'iar',
      position: { x: 35, y: 385 },
      data: { label: 'Falcon Image Analyzer', sublabel: 'Deployment (1 replica) — Image Assessment' },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      zIndex: 10,
      style: { width: 845, height: 70 },
    },
    // Falcon KAC — wide band spanning all 3 nodes
    {
      id: 'kac',
      position: { x: 35, y: 495 },
      data: { label: 'Falcon KAC', sublabel: 'Deployment (1 replica) — Admission Controller' },
      type: 'custom',
      parentId: 'cluster',
      extent: 'parent',
      zIndex: 10,
      style: { width: 845, height: 70 },
    },
    // External: CrowdStrike registry — pulled well out to the left so the image-pull line is visible
    {
      id: 'cs-registry',
      position: { x: -450, y: 245 },
      data: { label: 'registry.crowdstrike.com', sublabel: 'Sensor image required here (KAC + IAR default here too)', isCloud: true },
      type: 'custom',
      style: { width: 300, height: 70 },
    },
    // External: CrowdStrike cloud — dropped lower so the telemetry (TLS 443) lines are visible
    {
      id: 'cs-cloud',
      position: { x: 340, y: 770 },
      data: { label: 'CrowdStrike Cloud', sublabel: 'Telemetry & Detections', isDanger: true },
      type: 'custom',
      style: { width: 230, height: 60 },
    },
  ]

  const edges = [
    // Allowlist authorization chain (horizontal, left-to-right)
    { id: 'e-sync-al', source: 'synchronizer', sourceHandle: 'right-source', target: 'allowlists', targetHandle: 'left-target', label: 'fetches', type: 'smoothstep', animated: true, zIndex: 20, style: { stroke: '#61C4C9', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#61C4C9' } },
    { id: 'e-al-warden', source: 'allowlists', sourceHandle: 'right-source', target: 'warden', targetHandle: 'left-target', label: 'authorizes', type: 'smoothstep', zIndex: 20, style: { stroke: '#a371f7', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#a371f7' } },
    // Warden admits the privileged DaemonSet
    { id: 'e-warden-ds', source: 'warden', target: 'daemonset', label: 'admits privileged pods', type: 'smoothstep', zIndex: 20, style: { stroke: '#a371f7', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#a371f7' } },
    // Image pull — registry feeds the DaemonSet from the left (allowlist-gated)
    { id: 'e-reg-ds', source: 'cs-registry', sourceHandle: 'right-source', target: 'daemonset', targetHandle: 'left-target', label: 'sensor image (CS registry required)', type: 'smoothstep', animated: true, zIndex: 20, style: { stroke: '#d29922', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
    // Telemetry — each sensor drops down to the cloud (dashed red, behind the bands)
    { id: 'e-s1-cloud', source: 'sensor1', target: 'cs-cloud', type: 'smoothstep', zIndex: 0, style: { stroke: '#f85149', strokeWidth: 1.5, strokeDasharray: '5 4' } },
    { id: 'e-s2-cloud', source: 'sensor2', target: 'cs-cloud', label: 'TLS 443', type: 'smoothstep', zIndex: 0, animated: true, style: { stroke: '#f85149', strokeWidth: 1.5, strokeDasharray: '5 4' }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#f85149' } },
    { id: 'e-s3-cloud', source: 'sensor3', target: 'cs-cloud', type: 'smoothstep', zIndex: 0, style: { stroke: '#f85149', strokeWidth: 1.5, strokeDasharray: '5 4' } },
  ]

  return { nodes, edges }
}

function buildDiagramFromContent(text) {
  // Detect which diagram this is based on content — order matters (specific before generic)
  if (text.includes('GKE AUTOPILOT — FALCON PLATFORM') && text.includes('AllowlistSynchronizer')) {
    return buildGkeAutopilotDiagram(text)
  }
  if (text.includes('EKS HYBRID CLUSTER') && text.includes('LUMOS Sensor Image')) {
    return buildEksHybridDiagram(text)
  }
  if (text.includes('EKS FARGATE CLUSTER (serverless') && text.includes('Falcon-Injector-Pod')) {
    return buildEksFargateDiagram(text)
  }
  if (text.includes('FALCON PLATFORM HELM DEPLOYMENT') && text.includes('DaemonSet: 1 pod per node')) {
    return buildK8sDaemonsetDiagram(text)
  }
  if (text.includes('AWS Organization') && text.includes('HOST ACCOUNT') && text.includes('IOM Assessment')) {
    return buildCspmAwsOrgDiagram(text)
  }
  if (text.includes('Ansible Control Node') || text.includes('ansible-playbook')) {
    return buildAnsibleDiagram(text)
  }
  if (text.includes('WORKLOAD IDENTITY FEDERATION') || text.includes('WIF Pool')) {
    return buildWifDiagram(text)
  }
  if (text.includes('Google Artifact Registry') && text.includes('Cloud Run')) {
    return buildCloudRunPipelineDiagram(text)
  }
  if (text.includes('fcs-action') && text.includes('Image Assessment')) {
    return buildFcsImageScanDiagram(text)
  }
  if (text.includes('falconutil-action') && text.includes('ECR')) {
    return buildGitHubActionsPatchDiagram(text)
  }
  if (text.includes('BUILD TIME') || text.includes('falconutil')) {
    return buildDockerPatchDiagram(text)
  }
  if (text.includes('falcon-sensor (userspace)') && text.includes('eBPF')) {
    return buildSensorArchDiagram(text)
  }
  // Fallback: try parsing
  return parseAsciiDiagram(text)
}

function buildCspmAwsOrgDiagram(text) {
  const nodes = [
    {
      id: 'org',
      position: { x: 0, y: 0 },
      data: { label: 'AWS Organization (r-n7ay)', sublabel: 'OU: cs-demo', isContainer: true },
      type: 'custom',
      style: { width: 520, height: 320 },
    },
    {
      id: 'host',
      position: { x: 20, y: 50 },
      data: { label: 'Security (494873120176)', sublabel: 'HOST ACCOUNT', items: ['IAM Reader Role', 'Agentless Integration Role', 'Scanner VPC + NAT'] },
      type: 'custom',
      parentId: 'org',
      extent: 'parent',
      style: { width: 230, height: 130 },
    },
    {
      id: 'dev',
      position: { x: 270, y: 50 },
      data: { label: 'Development', sublabel: '934822761019', items: ['IAM Reader Role'] },
      type: 'custom',
      parentId: 'org',
      extent: 'parent',
      style: { width: 220, height: 55 },
    },
    {
      id: 'prod',
      position: { x: 270, y: 120 },
      data: { label: 'Production', sublabel: '517728567948', items: ['IAM Reader Role'] },
      type: 'custom',
      parentId: 'org',
      extent: 'parent',
      style: { width: 220, height: 55 },
    },
    {
      id: 'sandbox',
      position: { x: 270, y: 190 },
      data: { label: 'Sandbox', sublabel: '019313283882', items: ['IAM Reader Role'] },
      type: 'custom',
      parentId: 'org',
      extent: 'parent',
      style: { width: 220, height: 55 },
    },
    {
      id: 'falcon',
      position: { x: 130, y: 380 },
      data: { label: 'CrowdStrike Falcon Cloud', sublabel: 'Asset Inventory + IOM Assessment + IOA Detection', isCloud: true },
      type: 'custom',
      style: { width: 260, height: 60 },
    },
  ]

  const edges = [
    {
      id: 'e-host-falcon',
      source: 'host',
      target: 'falcon',
      label: 'TLS 443',
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#3fb950', strokeWidth: 1.5 },
      labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 },
      markerEnd: { type: 'arrowclosed', color: '#3fb950' },
    },
    {
      id: 'e-dev-falcon',
      source: 'dev',
      target: 'falcon',
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#61C4C9', strokeWidth: 1.2 },
      markerEnd: { type: 'arrowclosed', color: '#61C4C9' },
    },
    {
      id: 'e-prod-falcon',
      source: 'prod',
      target: 'falcon',
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#61C4C9', strokeWidth: 1.2 },
      markerEnd: { type: 'arrowclosed', color: '#61C4C9' },
    },
    {
      id: 'e-sandbox-falcon',
      source: 'sandbox',
      target: 'falcon',
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#61C4C9', strokeWidth: 1.2 },
      markerEnd: { type: 'arrowclosed', color: '#61C4C9' },
    },
  ]

  return { nodes, edges }
}

function buildAnsibleDiagram(text) {
  const nodes = [
    {
      id: 'falcon-api',
      position: { x: 240, y: 0 },
      data: {
        label: 'Falcon API',
        sublabel: 'api.crowdstrike.com',
        isApi: true,
      },
      type: 'custom',
      style: { width: 180, height: 55 },
    },
    {
      id: 'workstation',
      position: { x: 140, y: 120 },
      data: {
        label: 'Your Workstation',
        sublabel: 'Ansible Control Node',
        isContainer: true,
      },
      type: 'custom',
      style: { width: 380, height: 180 },
    },
    {
      id: 'falcon-install',
      position: { x: 20, y: 50 },
      data: {
        label: 'falcon_install',
        sublabel: 'Downloads .deb/.rpm from API',
      },
      type: 'custom',
      parentId: 'workstation',
      extent: 'parent',
      style: { width: 170, height: 55 },
    },
    {
      id: 'falcon-configure',
      position: { x: 200, y: 50 },
      data: {
        label: 'falcon_configure',
        sublabel: 'Sets CID + tags, starts service',
      },
      type: 'custom',
      parentId: 'workstation',
      extent: 'parent',
      style: { width: 170, height: 55 },
    },
    {
      id: 'deb-pkg',
      position: { x: 100, y: 120 },
      data: {
        label: 'falcon-sensor_7.x_amd64.deb',
        sublabel: 'Cached locally by role',
      },
      type: 'custom',
      parentId: 'workstation',
      extent: 'parent',
      style: { width: 200, height: 45 },
    },
    {
      id: 'deb12',
      position: { x: 60, y: 400 },
      data: {
        label: 'falcon-linux-deb-12',
        sublabel: 'Debian 12 Bookworm',
      },
      type: 'custom',
      style: { width: 180, height: 55 },
    },
    {
      id: 'deb13',
      position: { x: 420, y: 400 },
      data: {
        label: 'falcon-linux-deb-13',
        sublabel: 'Debian 13 Trixie',
      },
      type: 'custom',
      style: { width: 180, height: 55 },
    },
    {
      id: 'cloud',
      position: { x: 230, y: 530 },
      data: {
        label: 'CrowdStrike Cloud',
        sublabel: 'Telemetry & detections',
        isCloud: true,
      },
      type: 'custom',
      style: { width: 200, height: 55 },
    },
  ]

  const edges = [
    // Falcon API sends .deb down to workstation
    { id: 'e-api-down', source: 'falcon-api', target: 'workstation', label: 'OAuth2 → .deb + CID', type: 'smoothstep', animated: true, style: { stroke: '#a371f7', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#a371f7' } },
    // Workstation pushes .deb to VMs via SSH
    { id: 'e-ssh1', source: 'workstation', target: 'deb12', label: 'SSH: copy .deb + install', type: 'smoothstep', animated: true, style: { stroke: '#61C4C9', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#61C4C9' } },
    { id: 'e-ssh2', source: 'workstation', target: 'deb13', label: 'SSH: copy .deb + install', type: 'smoothstep', animated: true, style: { stroke: '#61C4C9', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#61C4C9' } },
    // VMs report telemetry to CrowdStrike Cloud
    { id: 'e-telem1', source: 'deb12', target: 'cloud', label: 'HTTPS/443', type: 'smoothstep', animated: true, style: { stroke: '#3fb950', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#3fb950' } },
    { id: 'e-telem2', source: 'deb13', target: 'cloud', label: 'HTTPS/443', type: 'smoothstep', animated: true, style: { stroke: '#3fb950', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#3fb950' } },
  ]

  return { nodes, edges }
}

function buildWifDiagram(text) {
  const nodes = [
    {
      id: 'github-runner',
      position: { x: 0, y: 80 },
      data: {
        label: 'GitHub Actions Runner',
        sublabel: 'Sends OIDC token (JWT)',
      },
      type: 'custom',
      style: { width: 180, height: 60 },
    },
    {
      id: 'wif-pool',
      position: { x: 250, y: 0 },
      data: {
        label: 'WIF Pool + Provider',
        sublabel: 'Steps 2 & 3',
        items: ['Validates GitHub OIDC token', 'Checks repo matches condition'],
      },
      type: 'custom',
      style: { width: 220, height: 100 },
    },
    {
      id: 'iam-binding',
      position: { x: 250, y: 150 },
      data: {
        label: 'IAM Binding',
        sublabel: 'Step 4',
        items: ['principalSet → SA', 'Workload Identity User role'],
      },
      type: 'custom',
      style: { width: 220, height: 100 },
    },
    {
      id: 'service-account',
      position: { x: 540, y: 80 },
      data: {
        label: 'Service Account',
        sublabel: 'github-actions-falcon (Step 1)',
        isApi: true,
      },
      type: 'custom',
      style: { width: 190, height: 60 },
    },
    {
      id: 'gar',
      position: { x: 540, y: 220 },
      data: {
        label: 'Artifact Registry',
        sublabel: 'Push/pull images',
        isCloud: true,
      },
      type: 'custom',
      style: { width: 190, height: 60 },
    },
  ]

  const edges = [
    { id: 'e-gh-wif', source: 'github-runner', target: 'wif-pool', label: 'OIDC Token', type: 'smoothstep', animated: true, style: { stroke: '#a371f7', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#a371f7' } },
    { id: 'e-wif-iam', source: 'wif-pool', target: 'iam-binding', label: 'Token valid?', type: 'smoothstep', animated: true, style: { stroke: '#61C4C9', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#61C4C9' } },
    { id: 'e-iam-sa', source: 'iam-binding', target: 'service-account', label: 'Impersonate', type: 'smoothstep', animated: true, style: { stroke: '#3fb950', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#3fb950' } },
    { id: 'e-sa-gar', source: 'service-account', target: 'gar', label: 'Access granted', type: 'smoothstep', animated: true, style: { stroke: '#d29922', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
  ]

  return { nodes, edges }
}

function buildDockerPatchDiagram(text) {
  const nodes = [
    // Build time section
    {
      id: 'build-container',
      position: { x: 0, y: 0 },
      data: { label: 'BUILD TIME', isContainer: true, isPhase: true },
      type: 'custom',
      style: { width: 580, height: 200 },
    },
    {
      id: 'source-image',
      position: { x: 20, y: 55 },
      data: { label: 'Your App Image', sublabel: '(source)' },
      type: 'custom',
      parentId: 'build-container',
      extent: 'parent',
      style: { width: 130, height: 55 },
    },
    {
      id: 'falconutil',
      position: { x: 210, y: 55 },
      data: { label: 'falconutil', sublabel: 'patch-image' },
      type: 'custom',
      parentId: 'build-container',
      extent: 'parent',
      style: { width: 130, height: 55 },
    },
    {
      id: 'patched-image',
      position: { x: 410, y: 55 },
      data: { label: 'Patched Image', sublabel: '(target)' },
      type: 'custom',
      parentId: 'build-container',
      extent: 'parent',
      style: { width: 130, height: 55 },
    },
    {
      id: 'sensor-image',
      position: { x: 210, y: 130 },
      data: { label: 'Falcon Sensor Image', sublabel: 'registry.crowdstrike.com' },
      type: 'custom',
      parentId: 'build-container',
      extent: 'parent',
      style: { width: 170, height: 55 },
    },
    // Registry
    {
      id: 'registry',
      position: { x: 610, y: 50 },
      data: { label: 'Container Registry', sublabel: 'ECR / GAR / ACR' },
      type: 'custom',
      style: { width: 160, height: 55 },
    },
    // Runtime section
    {
      id: 'run-container',
      position: { x: 0, y: 250 },
      data: { label: 'RUN TIME', isContainer: true, isPhase: true },
      type: 'custom',
      style: { width: 580, height: 170 },
    },
    {
      id: 'patched-runtime',
      position: { x: 40, y: 45 },
      data: { label: 'Patched Container', isContainer: true },
      type: 'custom',
      parentId: 'run-container',
      extent: 'parent',
      style: { width: 500, height: 110 },
    },
    {
      id: 'sensor-runtime',
      position: { x: 20, y: 38 },
      data: { label: 'Falcon Sensor', sublabel: '(user-space daemon)' },
      type: 'custom',
      parentId: 'patched-runtime',
      extent: 'parent',
      style: { width: 150, height: 55 },
    },
    {
      id: 'flask-runtime',
      position: { x: 230, y: 38 },
      data: { label: 'Your App', sublabel: 'Listening on :5000' },
      type: 'custom',
      parentId: 'patched-runtime',
      extent: 'parent',
      style: { width: 150, height: 55 },
    },
    // Falcon Cloud
    {
      id: 'falcon-cloud',
      position: { x: 200, y: 470 },
      data: { label: 'CrowdStrike Cloud', sublabel: 'Telemetry & detections', isCloud: true },
      type: 'custom',
      style: { width: 180, height: 55 },
    },
  ]

  const edges = [
    // Build flow: source → falconutil → patched
    { id: 'e-build1', source: 'source-image', target: 'falconutil', type: 'smoothstep', animated: true, style: { stroke: '#61C4C9', strokeWidth: 1.5 }, markerEnd: { type: 'arrowclosed', color: '#61C4C9' } },
    { id: 'e-build2', source: 'falconutil', target: 'patched-image', type: 'smoothstep', animated: true, style: { stroke: '#61C4C9', strokeWidth: 1.5 }, markerEnd: { type: 'arrowclosed', color: '#61C4C9' } },
    // Sensor image feeds into falconutil
    { id: 'e-sensor-in', source: 'sensor-image', target: 'falconutil', label: 'Injects sensor', type: 'smoothstep', animated: true, style: { stroke: '#a371f7', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#a371f7' } },
    // Patched image pushed to registry
    { id: 'e-push', source: 'patched-image', target: 'registry', label: 'docker push', type: 'smoothstep', animated: true, style: { stroke: '#d29922', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
    // Registry pulled at runtime
    { id: 'e-pull', source: 'registry', target: 'run-container', label: 'docker run', type: 'smoothstep', style: { stroke: '#d29922', strokeWidth: 1, strokeDasharray: '4 3' }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#d29922' } },
    // Sensor reports to cloud at runtime
    { id: 'e-telemetry', source: 'sensor-runtime', target: 'falcon-cloud', label: 'HTTPS/443', type: 'smoothstep', animated: true, style: { stroke: '#3fb950', strokeWidth: 1.5 }, labelStyle: { fill: 'rgba(180,180,195,0.8)', fontSize: 10 }, markerEnd: { type: 'arrowclosed', color: '#3fb950' } },
  ]

  return { nodes, edges }
}

export function isAsciiDiagram(text) {
  // Named diagram patterns (no box-drawing chars needed)
  if (text.includes('GKE AUTOPILOT — FALCON PLATFORM') && text.includes('AllowlistSynchronizer')) return true
  if (text.includes('EKS HYBRID CLUSTER') && text.includes('LUMOS Sensor Image')) return true
  if (text.includes('EKS FARGATE CLUSTER (serverless') && text.includes('Falcon-Injector-Pod')) return true
  if (text.includes('FALCON PLATFORM HELM DEPLOYMENT') && text.includes('DaemonSet: 1 pod per node')) return true

  const boxChars = /[┌┐└┘│├┤─┬┴┼]/
  const lines = text.split('\n')
  const boxLines = lines.filter(l => boxChars.test(l))
  // It's a diagram if >30% of lines have box chars and there are arrows
  return boxLines.length > 3 && (text.includes('▼') || text.includes('►') || text.includes('──►') || text.includes('▶'))
}

export default function FlowDiagram({ content }) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const result = buildDiagramFromContent(content)
    return { initialNodes: result.nodes, initialEdges: result.edges }
  }, [content])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  return (
    <div className="flow-diagram">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={true}
        nodesConnectable={false}
        zoomOnScroll={false}
        panOnScroll={true}
        minZoom={0.5}
        maxZoom={1.5}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background color="rgba(97, 196, 201, 0.05)" gap={24} size={1} variant="dots" />
      </ReactFlow>
    </div>
  )
}

import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import LabRenderer from './components/LabRenderer'
import OverviewPage from './components/OverviewPage'
import RoadmapPage from './components/RoadmapPage'
import { manifest, getRedirects } from './content/manifest'

const { labRedirects, prefixRedirects } = getRedirects()

// Groups nest to any depth (cloud -> service -> OS -> lab), so routes are built recursively.
function renderNode(node) {
  if (!node.children) {
    return <Route key={node.route} path={node.route} element={<LabRenderer labKey={node.fullRoute} />} />
  }
  return (
    <Route key={node.route} path={node.route}>
      <Route index element={<OverviewPage section={node} />} />
      {node.children.map(renderNode)}
    </Route>
  )
}

function App() {
  return (
    <Routes>
      <Route element={<Layout manifest={manifest} />}>
        <Route index element={<OverviewPage section={manifest} />} />
        <Route path="roadmap" element={<RoadmapPage />} />
        {manifest.map(renderNode)}
        {/* Old compute-first URLs from before the cloud-first nav */}
        {labRedirects.map(({ from, to }) => (
          <Route key={from} path={from} element={<Navigate to={to} replace />} />
        ))}
        {prefixRedirects.map(({ from, to }) => (
          <Route key={from} path={from} element={<Navigate to={to} replace />} />
        ))}
      </Route>
    </Routes>
  )
}

export default App

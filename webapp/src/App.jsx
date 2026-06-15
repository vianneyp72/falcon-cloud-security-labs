import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import LabRenderer from './components/LabRenderer'
import OverviewPage from './components/OverviewPage'
import { manifest } from './content/manifest'

function App() {
  return (
    <Routes>
      <Route element={<Layout manifest={manifest} />}>
        <Route index element={<OverviewPage section={manifest} />} />
        {manifest.map((section) => (
          <Route key={section.route} path={section.route}>
            {section.children ? (
              <>
                <Route index element={<OverviewPage section={section} />} />
                {section.children.map((child) =>
                  child.children ? (
                    <Route key={child.route} path={child.route}>
                      <Route index element={<OverviewPage section={child} />} />
                      {child.children.map((leaf) => (
                        <Route
                          key={leaf.route}
                          path={leaf.route}
                          element={<LabRenderer labKey={leaf.fullRoute} />}
                        />
                      ))}
                    </Route>
                  ) : (
                    <Route
                      key={child.route}
                      path={child.route}
                      element={<LabRenderer labKey={child.fullRoute} />}
                    />
                  )
                )}
              </>
            ) : (
              <Route index element={<LabRenderer labKey={section.fullRoute} />} />
            )}
          </Route>
        ))}
      </Route>
    </Routes>
  )
}

export default App

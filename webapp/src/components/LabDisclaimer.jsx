/**
 * LabDisclaimer — auto-rendered at the top of every lab by LabRenderer.
 *
 * DO NOT duplicate this content inside individual lab.md files. To change the
 * wording, edit this component. Placement is controlled in LabRenderer.jsx.
 */
export default function LabDisclaimer() {
  return (
    <aside className="lab-disclaimer" role="note" aria-label="Lab maintenance disclaimer">
      <p>
        <strong>
          Maintained by{' '}
          <a href="mailto:minh.pham@crowdstrike.com">minh.pham@crowdstrike.com</a>.
        </strong>{' '}
        Content may drift from official recommendations over time. Each lab links to
        official CrowdStrike and cloud provider docs for additional reference — those
        should be your source of truth when in doubt.
      </p>
    </aside>
  )
}

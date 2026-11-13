import { Link } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import StatusBadge from "./StatusBadge";
import CloudLogo from "./CloudLogo";
import LabDisclaimer from "./LabDisclaimer";

export default function OverviewPage({ section }) {
  // Root manifest (array): cloud-first homepage
  if (Array.isArray(section)) {
    return (
      <>
        <main className="content-area">
          <h1>Falcon Cloud Security Deployments</h1>
          <p>
            Hands-on lab guides for deploying CrowdStrike Falcon Cloud Security
            across cloud workloads. Pick your customer's cloud to get started.
          </p>
          <LabDisclaimer />
          <div className="overview-grid">
            {section.map((s) => (
              <Link key={s.route} to={`/${s.route}`} className="overview-card">
                <div className="overview-card__title">
                  <span className="overview-card__heading">
                    <CloudLogo name={s.logo} className="overview-card__logo" />
                    {s.label}
                  </span>
                  <span className="arrow">&rarr;</span>
                </div>
                <div className="overview-card__desc">{s.description}</div>
              </Link>
            ))}
          </div>
          <p style={{ marginTop: "1.5rem" }}>
            <Link to="/roadmap">See the modernization roadmap &rarr;</Link>
          </p>
        </main>
        <aside className="toc-aside" />
      </>
    );
  }

  // Section overview
  // Flatten nested groups into one card list; `group` is the breadcrumb of intermediate groups.
  const flatChildren = [];
  const walk = (nodes, trail) => {
    for (const node of nodes || []) {
      if (node.children) walk(node.children, [...trail, node.label]);
      else flatChildren.push({ ...node, group: trail.join(" / ") });
    }
  };
  walk(section.children, []);

  return (
    <>
      <main className="content-area">
        <h1 className="overview-title">
          {section.logo && <CloudLogo name={section.logo} className="overview-title__logo" />}
          {section.label}
        </h1>
        <LabDisclaimer />
        {section.description && <p>{section.description}</p>}
        {section.overview && (
          <div style={{ marginBottom: "1.5rem" }}>
            <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {section.overview}
            </Markdown>
          </div>
        )}
        <div className="overview-grid">
          {flatChildren.map((child) => (
            <Link
              key={child.fullRoute}
              to={`/${child.fullRoute}`}
              className="overview-card"
            >
              <div className="overview-card__title">
                {child.label}
                <span className="arrow">&rarr;</span>
              </div>
              {child.group && (
                <div
                  style={{
                    fontSize: "0.72rem",
                    color: "var(--text-muted)",
                    marginBottom: "0.25rem",
                  }}
                >
                  {child.group}
                </div>
              )}
              <div className="overview-card__desc">
                {child.description || "Lab guide"}
              </div>
              <div className="overview-card__status">
                <StatusBadge meta={child} />
              </div>
            </Link>
          ))}
        </div>
      </main>
      <aside className="toc-aside" />
    </>
  );
}

import { Link } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import StatusBadge from "./StatusBadge";
import { getStatusKey } from "../content/manifest";
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

  const isCloudPage = !!section.logo;
  const sections = isCloudPage ? groupByCategory(section.children) : groupByVariant(section.children);

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
        {sections.map((sec) => (
          <section key={sec.title || "labs"} className="overview-section">
            {sec.title && <h2 className="overview-section__title">{sec.title}</h2>}
            <div className="overview-grid">
              {sec.items.map((item) =>
                item.children ? (
                  <ServiceCard key={item.path} node={item} />
                ) : (
                  <LabCard key={item.fullRoute} lab={item} />
                )
              )}
            </div>
          </section>
        ))}
      </main>
      <aside className="toc-aside" />
    </>
  );
}

// Every lab under a node, at any depth.
function collectLabs(node) {
  return node.children ? node.children.flatMap(collectLabs) : [node];
}

// Cloud page: one section per category (Containers, Virtual Machines, ...), in manifest order.
// Services show as one card each; groups flagged `inline` list their labs directly.
function groupByCategory(children) {
  const sections = [];
  for (const node of children) {
    const title = node.category || "Other";
    let sec = sections.find((x) => x.title === title);
    if (!sec) sections.push((sec = { title, items: [] }));
    if (node.inline) sec.items.push(...collectLabs(node));
    else sec.items.push(node);
  }
  return sections;
}

// Service page: a sub-group (Linux, Fargate, ...) becomes its own section; loose labs sit together up top.
function groupByVariant(children) {
  const loose = children.filter((c) => !c.children);
  const sections = loose.length ? [{ title: null, items: loose }] : [];
  for (const node of children) {
    if (node.children) sections.push({ title: node.label, items: collectLabs(node) });
  }
  return sections;
}

function StatusCounts({ labs }) {
  const counts = { modern: 0, legacy: 0, roadmap: 0 };
  for (const lab of labs) {
    const key = getStatusKey(lab);
    if (key in counts) counts[key] += 1;
  }
  const labels = { modern: "modernized", legacy: "legacy", roadmap: "not written" };
  return (
    <div className="status-counts">
      {Object.entries(counts).map(([key, n]) =>
        n ? (
          <span key={key} className="status-counts__item" title={`${n} ${labels[key]}`}>
            <span className={`sidebar-link__dot sidebar-link__dot--${key}`} />
            {n} {labels[key]}
          </span>
        ) : null
      )}
    </div>
  );
}

function ServiceCard({ node }) {
  const labs = collectLabs(node);
  // A service with exactly one lab goes straight to that lab.
  const to = labs.length === 1 ? labs[0].fullRoute : node.path;
  const subgroups = node.children.filter((c) => c.children).map((c) => c.label);
  return (
    <Link to={`/${to}`} className="overview-card">
      <div className="overview-card__title">
        {node.label}
        <span className="arrow">&rarr;</span>
      </div>
      <div className="overview-card__desc">
        {labs.length} {labs.length === 1 ? "lab" : "labs"}
        {subgroups.length > 0 && ` · ${subgroups.join(", ")}`}
      </div>
      <StatusCounts labs={labs} />
    </Link>
  );
}

function LabCard({ lab }) {
  return (
    <Link to={`/${lab.fullRoute}`} className="overview-card">
      <div className="overview-card__title">
        {lab.label}
        <span className="arrow">&rarr;</span>
      </div>
      <div className="overview-card__desc">{lab.description || "Lab guide"}</div>
      <div className="overview-card__status">
        <StatusBadge meta={lab} />
      </div>
    </Link>
  );
}

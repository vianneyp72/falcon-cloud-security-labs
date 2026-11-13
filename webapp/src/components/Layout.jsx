import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import ProgressBar from "./ProgressBar";
import ReadingProgress from "./ReadingProgress";
import ThemeToggle from "./ThemeToggle";
import { useProgress } from "../hooks/useProgress";
import { useModeToggle, contentHasMode, resolveMode } from "./ModeToggle";
import { getLabContent, getLabMeta } from "../content/manifest";

export default function Layout({ manifest }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { getPageProgress } = useProgress();
  const [storedMode] = useModeToggle();
  const base = import.meta.env.BASE_URL;

  // Nav route → canonical lab id, so every placement of a lab shares one progress key.
  // If the route matches a real lab, show its progress; otherwise skip.
  const route = location.pathname.replace(/^\//, "");
  const labMeta = getLabMeta(route);
  const labKey = labMeta?.id || route;
  const labContent = labMeta ? getLabContent(route) : "";
  const hasMode = contentHasMode(labContent);
  const activeMode = resolveMode(labContent, storedMode);
  const pageProgress = labMeta ? getPageProgress(labKey, activeMode, hasMode) : null;

  return (
    <div className="app-layout">
      <ReadingProgress />
      <header className="app-header">
        <button
          className="hamburger"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? "\u2715" : "\u2630"}
        </button>
        <Link to="/" className="app-header__logo">
          <img
            src={`${base}logos/Red Falcon logo.svg`}
            alt="CrowdStrike Falcon"
            className="app-header__logo-mark"
          />
          Falcon Cloud Security Labs
        </Link>
        {pageProgress && (
          <div className="app-header__progress">
            <ProgressBar checked={pageProgress.checked} total={pageProgress.total} />
          </div>
        )}
        <ThemeToggle />
      </header>

      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        manifest={manifest}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        currentPath={location.pathname}
      />

      <Outlet />
    </div>
  );
}

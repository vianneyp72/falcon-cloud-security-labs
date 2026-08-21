import { useTheme } from "../hooks/useTheme";

export default function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const isDark = theme === "dark";
  const nextLabel = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={nextLabel}
      title={nextLabel}
    >
      {isDark ? (
        /* Sun — click to go light */
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m4.93 19.07 1.41-1.41" />
          <path d="m17.66 6.34 1.41-1.41" />
        </svg>
      ) : (
        /* Moon — click to go dark */
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

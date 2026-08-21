import { useEffect, useState } from "react";

/**
 * Theme hook — reads `localStorage.theme` if present, otherwise falls back to
 * `prefers-color-scheme`. Persists user choice to localStorage. Applies the
 * value to `<html data-theme="…">` so `:root` and `[data-theme="light"]`
 * blocks in global.css can swap tokens.
 */
export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    if (typeof window === "undefined") return "dark";
    const saved = window.localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = (next) => {
    setThemeState(next);
    try {
      window.localStorage.setItem("theme", next);
    } catch {
      /* localStorage disabled — silently ignore */
    }
  };

  return [theme, setTheme];
}

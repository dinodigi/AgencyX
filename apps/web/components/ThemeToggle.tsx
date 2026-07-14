"use client";

import { useEffect, useState } from "react";

const KEY = "ax-theme";

/** Light/dark switch. Dark is the default; the choice persists in localStorage
 *  and is applied pre-paint by the inline script in the root layout. */
export function ThemeToggle() {
  // null until mounted — server and first client render stay identical.
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    if (next === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode — the toggle still works for this session */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      aria-label="Toggle color theme"
      className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
    >
      {theme === "light" ? (
        // moon — click to go dark
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      ) : (
        // sun — click to go light (also the pre-mount placeholder)
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}

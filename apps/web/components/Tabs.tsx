"use client";

import { useState, type ReactNode } from "react";

export interface TabDef {
  id: string;
  label: string;
  /** Small count/summary chip rendered after the label. */
  badge?: string;
  content: ReactNode;
}

/** Minimal pill tabs — content is server-rendered and passed in as ReactNode,
 *  so heavy panels stay Server Components; only the switcher is client state. */
export function Tabs({ tabs, defaultId }: { tabs: TabDef[]; defaultId?: string }) {
  const [active, setActive] = useState(defaultId ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2 border-b border-[var(--color-border)] pb-3">
        {tabs.map((t) => {
          const isActive = t.id === current?.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? "bg-[var(--color-surface-2)] font-semibold text-[var(--color-ink)] ring-1 ring-[var(--color-border)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              {t.label}
              {t.badge && (
                <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${isActive ? "bg-[var(--color-surface)] text-[var(--color-muted)]" : "bg-[var(--color-surface-2)] text-[var(--color-muted)]"}`}>
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {current?.content}
    </div>
  );
}

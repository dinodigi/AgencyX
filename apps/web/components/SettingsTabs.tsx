"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/packages", label: "Services & packages" },
];

export function SettingsTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-1 border-b border-[var(--color-border)] px-8 pt-5">
      {TABS.map((t) => {
        const active = path === t.href || path.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-t-lg px-4 py-2.5 text-sm ${
              active
                ? "border-b-2 border-[var(--color-brand-2)] font-medium text-[var(--color-ink)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

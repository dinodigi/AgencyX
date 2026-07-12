"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/leads", label: "Leads" },
  { href: "/coverage", label: "Coverage" },
  { href: "/batches", label: "Batch builder" },
  { href: "/devices", label: "Devices" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-1">
      <div className="px-2 py-3 mb-2 text-lg font-bold tracking-tight text-[var(--color-brand)]">Lead Engine</div>
      {LINKS.map((l) => {
        const active = path === l.href || path.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-[var(--color-surface-2)] text-[var(--color-ink)]"
                : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
      <div className="mt-auto px-3 py-2 text-xs text-[var(--color-muted)]">Internal · tenant #1</div>
    </nav>
  );
}

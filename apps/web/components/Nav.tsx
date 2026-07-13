"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  ClerkLoading,
  ClerkLoaded,
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
  OrganizationSwitcher,
} from "@clerk/nextjs";

const ICONS: Record<string, ReactNode> = {
  leads: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  search: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  ),
  batches: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="M12 12 4 7.5M12 12l8-4.5M12 12v9" />
    </svg>
  ),
  coverage: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  devices: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
};

const GROUPS: { label: string; links: { href: string; label: string; icon: keyof typeof ICONS }[] }[] = [
  { label: "Pipeline", links: [{ href: "/leads", label: "Leads", icon: "leads" }] },
  {
    label: "Acquisition",
    links: [
      { href: "/search", label: "Search", icon: "search" },
      { href: "/batches", label: "Batch builder", icon: "batches" },
      { href: "/coverage", label: "Coverage", icon: "coverage" },
    ],
  },
  { label: "System", links: [{ href: "/devices", label: "Devices", icon: "devices" }] },
];

// Clerk components require ClerkProvider (mounted only when configured), so the
// auth UI is gated on the same public key the provider is.
const clerkOn = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex w-60 shrink-0 flex-col gap-1 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      {/* Brand */}
      <Link href="/leads" className="mb-4 flex items-center gap-2.5 px-2 py-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[image:linear-gradient(135deg,var(--color-brand),var(--color-brand-2))] text-[13px] font-black tracking-tight text-white shadow-[0_4px_14px_-4px_color-mix(in_srgb,var(--color-brand)_80%,transparent)]">
          AX
        </span>
        <span className="text-[17px] font-bold tracking-tight">
          Agency<span className="text-gradient">X</span>
        </span>
      </Link>

      {GROUPS.map((g) => (
        <div key={g.label} className="mb-2">
          <div className="px-3 pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-[var(--color-muted)] uppercase">
            {g.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {g.links.map((l) => {
              const active = path === l.href || path.startsWith(l.href + "/");
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
                    active
                      ? "bg-[var(--color-surface-2)] font-medium text-[var(--color-ink)]"
                      : "text-[var(--color-muted)] hover:bg-[color-mix(in_srgb,var(--color-surface-2)_60%,transparent)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {active && (
                    <span className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-full bg-[image:linear-gradient(180deg,var(--color-brand),var(--color-brand-2))]" />
                  )}
                  <span className={active ? "text-[var(--color-brand-2)]" : "text-[var(--color-muted)] group-hover:text-[var(--color-ink)]"}>
                    {ICONS[l.icon]}
                  </span>
                  {l.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}

      <div className="mt-auto flex flex-col gap-3 border-t border-[var(--color-border)] pt-4">
        {clerkOn ? (
          <>
            {/* Always render a visible state so the auth area never blanks. */}
            <ClerkLoading>
              <span className="px-3 py-2 text-xs text-[var(--color-muted)]">Loading…</span>
            </ClerkLoading>
            <ClerkLoaded>
              <SignedIn>
                <OrganizationSwitcher
                  hidePersonal
                  appearance={{ elements: { rootBox: "w-full", organizationSwitcherTrigger: "w-full justify-between" } }}
                />
                <div className="flex items-center gap-2 px-1">
                  <UserButton />
                  <span className="text-xs text-[var(--color-muted)]">Account</span>
                </div>
              </SignedIn>
              <SignedOut>
                <SignInButton mode="modal">
                  <button className="btn-primary w-full px-3 py-2 text-sm">Sign in</button>
                </SignInButton>
              </SignedOut>
            </ClerkLoaded>
          </>
        ) : (
          <div className="px-3 py-2 text-xs text-[var(--color-muted)]">Internal · tenant #1 · Clerk off</div>
        )}
      </div>
    </nav>
  );
}

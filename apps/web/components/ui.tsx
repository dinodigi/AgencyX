import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="animate-in sticky top-0 z-10 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_82%,transparent)] px-8 py-5 backdrop-blur-md">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--color-muted)]">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`animate-in rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_10px_30px_-18px_rgba(0,0,0,0.8)] ${className}`}
    >
      {children}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="animate-in mx-auto max-w-md rounded-2xl border border-dashed border-[var(--color-border)] p-10 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </div>
      <p className="text-sm font-medium text-[var(--color-ink)]">{title}</p>
      {hint && <p className="mt-1.5 text-sm break-words text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

export function SignedOut() {
  return (
    <div className="p-8">
      <EmptyState title="Not signed in" hint="Sign in (or set the dev auth env vars) to load org-scoped data." />
    </div>
  );
}

export function NotConfigured() {
  return (
    <div className="p-8">
      <EmptyState title="AgentX not configured" hint="AGENTX_DELIVERY_TOKEN is not set for this deployment." />
    </div>
  );
}

const STAGE_COLORS: Record<string, string> = {
  scraped: "var(--color-stage-scraped)",
  qualified: "var(--color-stage-qualified)",
  building: "var(--color-stage-building)",
  proposed: "var(--color-stage-proposed)",
  sold: "var(--color-stage-sold)",
  client: "var(--color-stage-client)",
};

/** Soft pill: tinted background + colored dot — reads well at table density. */
function Pill({ color, label, pulse = false }: { color: string; label: string; pulse?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${pulse ? "pulse-dot" : ""}`} style={{ background: color }} />
      {label}
    </span>
  );
}

export function StageBadge({ stage }: { stage?: string }) {
  const s = stage ?? "scraped";
  return <Pill color={STAGE_COLORS[s] ?? "var(--color-stage-scraped)"} label={s} />;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "var(--color-stage-scraped)",
  running: "var(--color-stage-building)",
  completed: "var(--color-stage-sold)",
  failed: "#f87171",
};

export function StatusBadge({ status }: { status?: string }) {
  const s = status ?? "pending";
  return <Pill color={STATUS_COLORS[s] ?? "var(--color-stage-scraped)"} label={s} pulse={s === "running"} />;
}

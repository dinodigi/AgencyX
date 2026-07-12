import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between border-b border-[var(--color-border)] px-8 py-5">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--color-muted)]">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] ${className}`}>{children}</div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center">
      <p className="text-sm text-[var(--color-ink)]">{title}</p>
      {hint && <p className="mt-1 text-sm break-words text-[var(--color-muted)]">{hint}</p>}
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

export function StageBadge({ stage }: { stage?: string }) {
  const color = STAGE_COLORS[stage ?? "scraped"] ?? "var(--color-stage-scraped)";
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize"
      style={{ background: color, color: "#0b1220" }}
    >
      {stage ?? "scraped"}
    </span>
  );
}

const STATUS_COLORS: Record<string, string> = {
  pending: "var(--color-stage-scraped)",
  running: "var(--color-stage-building)",
  completed: "var(--color-stage-sold)",
  failed: "#ef4444",
};

export function StatusBadge({ status }: { status?: string }) {
  const color = STATUS_COLORS[status ?? "pending"] ?? "var(--color-stage-scraped)";
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize"
      style={{ background: color, color: "#0b1220" }}
    >
      {status ?? "pending"}
    </span>
  );
}

import { Suspense } from "react";
import Link from "next/link";
import type { LeadsListOpts } from "@dinosales/agentx-client";
import { withClient, isConfigured } from "@/lib/agentx.ts";
import { getAuthStatus } from "@/lib/auth.ts";
import { PageHeader, EmptyState, NotConfigured } from "@/components/ui.tsx";
import { AuthGate } from "@/components/AuthGate.tsx";
import { LeadFilters } from "@/components/LeadFilters.tsx";
import { LiveRefresh } from "@/components/LiveRefresh.tsx";
import { LeadsTable } from "@/components/LeadsTable.tsx";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

const DEFAULT_LIMIT = 50;

function buildFilter(sp: SP): LeadsListOpts["filter"] {
  const filter: NonNullable<LeadsListOpts["filter"]> = {};
  const stage = sp.stage as string | undefined;
  if (stage) filter.stage = stage as NonNullable<LeadsListOpts["filter"]>["stage"];
  const bucket = sp.review_bucket as string | undefined;
  if (bucket) filter.review_bucket = bucket as NonNullable<LeadsListOpts["filter"]>["review_bucket"];
  if (sp.has_website === "true") filter.has_website = true;
  if (sp.has_website === "false") filter.has_website = false;
  if (sp.claimed === "true") filter.claimed = true;
  if (sp.claimed === "false") filter.claimed = false;
  if (sp.search_query) filter.search_query = sp.search_query as string;
  return filter;
}

function buildSort(sp: SP): NonNullable<LeadsListOpts["sort"]> {
  switch (sp.sort as string | undefined) {
    case "oldest":
      return { field: "created_at", dir: "asc" };
    case "name":
      return { field: "business_name", dir: "asc" };
    case "rating":
      return { field: "rating", dir: "desc" };
    case "reviews":
      return { field: "review_count", dir: "desc" };
    case "newest":
    default:
      return { field: "created_at", dir: "desc" };
  }
}

/** Preserve the current query while overriding the offset (for Prev/Next). */
function pageHref(sp: SP, offset: number): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "offset") continue;
    if (typeof v === "string" && v) next.set(k, v);
  }
  if (offset > 0) next.set("offset", String(offset));
  const qs = next.toString();
  return qs ? `/leads?${qs}` : "/leads";
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  if (!isConfigured()) return <NotConfigured />;
  const status = await getAuthStatus();
  if (status !== "ready") return <AuthGate status={status} />;
  const ctx = await withClient();
  if (!ctx) return <AuthGate status="signed-out" />;

  const sp = await searchParams;
  const filter = buildFilter(sp);
  const sort = buildSort(sp);
  const limit = Math.max(10, Math.min(500, Number(sp.limit) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(sp.offset) || 0);

  let rows: Awaited<ReturnType<typeof ctx.ax.leads.list>> = [];
  let error: string | null = null;
  try {
    rows = await ctx.ax.leads.list({ filter, sort, limit, offset });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const hasPrev = offset > 0;
  const hasNext = rows.length === limit;
  const rangeStart = rows.length === 0 ? 0 : offset + 1;
  const rangeEnd = offset + rows.length;

  return (
    <div>
      <LiveRefresh watch={["leads"]} />
      <PageHeader
        title="Leads"
        subtitle={rows.length === 0 ? "No leads" : `Showing ${rangeStart}–${rangeEnd}`}
        actions={
          <Suspense fallback={null}>
            <LeadFilters />
          </Suspense>
        }
      />
      <div className="p-8">
        {error ? (
          <EmptyState title="Couldn't load leads" hint={error} />
        ) : rows.length === 0 ? (
          <EmptyState title="No leads match" hint="Adjust filters, or run a scrape from the desktop app." />
        ) : (
          <>
            <LeadsTable rows={rows} />
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-[var(--color-muted)]">
                Showing {rangeStart}–{rangeEnd}
              </span>
              <div className="flex items-center gap-2">
                <PageLink href={pageHref(sp, Math.max(0, offset - limit))} disabled={!hasPrev}>
                  ← Prev
                </PageLink>
                <PageLink href={pageHref(sp, offset + limit)} disabled={!hasNext}>
                  Next →
                </PageLink>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  if (disabled) {
    return <span className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-muted)] opacity-40">{children}</span>;
  }
  return (
    <Link href={href} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-surface-2)]">
      {children}
    </Link>
  );
}

import { Suspense } from "react";
import Link from "next/link";
import type { LeadsListOpts } from "@dinosales/agentx-client";
import { withClient, isConfigured } from "@/lib/agentx.ts";
import { getAuthStatus } from "@/lib/auth.ts";
import { PageHeader, Card, EmptyState, NotConfigured, StageBadge } from "@/components/ui.tsx";
import { AuthGate } from "@/components/AuthGate.tsx";
import { LeadFilters } from "@/components/LeadFilters.tsx";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

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
  return filter;
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  if (!isConfigured()) return <NotConfigured />;
  const status = await getAuthStatus();
  if (status !== "ready") return <AuthGate status={status} />;
  const ctx = await withClient();
  if (!ctx) return <AuthGate status="signed-out" />;

  const sp = await searchParams;
  const filter = buildFilter(sp);

  let rows: Awaited<ReturnType<typeof ctx.ax.leads.list>> = [];
  let error: string | null = null;
  try {
    rows = await ctx.ax.leads.list({ filter, limit: 200, sort: { field: "business_name", dir: "asc" } });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle={`${rows.length} shown${rows.length === 200 ? "+ (paged)" : ""}`}
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
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                    <Th>Business</Th>
                    <Th>Category</Th>
                    <Th>Website</Th>
                    <Th>Reviews</Th>
                    <Th>Rating</Th>
                    <Th>Claimed</Th>
                    <Th>Stage</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id} className="border-b border-[var(--color-border)] last:border-0">
                      <Td>
                        <Link href={`/leads/${l.id}`} className="font-medium hover:text-[var(--color-stage-qualified)] hover:underline">
                          {l.business_name}
                        </Link>
                        <div className="text-xs text-[var(--color-muted)]">{l.phone ?? l.address ?? ""}</div>
                      </Td>
                      <Td className="text-[var(--color-muted)]">{l.category ?? "—"}</Td>
                      <Td>
                        {l.has_website ? (
                          <a href={l.website} target="_blank" rel="noreferrer" className="text-[var(--color-stage-qualified)] hover:underline">
                            site ↗
                          </a>
                        ) : (
                          <span className="text-[var(--color-muted)]">none</span>
                        )}
                      </Td>
                      <Td>{l.review_count ?? 0}</Td>
                      <Td>{l.rating ? l.rating.toFixed(1) : "—"}</Td>
                      <Td>{l.claimed ? "yes" : <span className="text-[var(--color-stage-building)]">no</span>}</Td>
                      <Td>
                        <StageBadge stage={l.stage} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-medium">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}

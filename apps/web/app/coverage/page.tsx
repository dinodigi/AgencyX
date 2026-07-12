import { withClient, isConfigured } from "@/lib/agentx.ts";
import { PageHeader, Card, EmptyState, SignedOut, NotConfigured, StatusBadge } from "@/components/ui.tsx";
import { fmtRelative } from "@/lib/format.ts";

export const dynamic = "force-dynamic";

/**
 * Coverage view — the soft-dedup surface (§5.4). One row per keyword+ZIP search
 * unit with its last-scraped time and result count, so a team sees what's been
 * covered and by whom before re-running.
 */
export default async function CoveragePage() {
  if (!isConfigured()) return <NotConfigured />;
  const ctx = await withClient();
  if (!ctx) return <SignedOut />;

  let rows: Awaited<ReturnType<typeof ctx.ax.search_queries.list>> = [];
  let error: string | null = null;
  try {
    rows = await ctx.ax.search_queries.list({ limit: 300, sort: { field: "last_scraped_at", dir: "desc" } });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <PageHeader title="Coverage" subtitle={`${rows.length} keyword × ZIP units`} />
      <div className="p-8">
        {error ? (
          <EmptyState title="Couldn't load coverage" hint={error} />
        ) : rows.length === 0 ? (
          <EmptyState title="No coverage yet" hint="Build a batch to create keyword × ZIP search units." />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                    <th className="px-4 py-3 font-medium">Keyword</th>
                    <th className="px-4 py-3 font-medium">ZIP</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Last scraped</th>
                    <th className="px-4 py-3 font-medium">Leads</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((q) => (
                    <tr key={q.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-4 py-3 font-medium">{q.keyword}</td>
                      <td className="px-4 py-3">{q.zip}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={q.status} />
                      </td>
                      <td className="px-4 py-3 text-[var(--color-muted)]">{fmtRelative(q.last_scraped_at)}</td>
                      <td className="px-4 py-3">{q.result_count ?? 0}</td>
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

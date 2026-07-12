import { withClient, isConfigured } from "@/lib/agentx.ts";
import { PageHeader, Card, EmptyState, SignedOut, NotConfigured } from "@/components/ui.tsx";
import { fmtRelative } from "@/lib/format.ts";

export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  if (!isConfigured()) return <NotConfigured />;
  const ctx = await withClient();
  if (!ctx) return <SignedOut />;

  let rows: Awaited<ReturnType<typeof ctx.ax.devices.list>> = [];
  let error: string | null = null;
  try {
    rows = await ctx.ax.devices.list({ limit: 100, sort: { field: "last_seen", dir: "desc" } });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <PageHeader title="Devices" subtitle={`${rows.length} registered`} />
      <div className="p-8">
        {error ? (
          <EmptyState title="Couldn't load devices" hint={error} />
        ) : rows.length === 0 ? (
          <EmptyState title="No devices yet" hint="A desktop scraper registers here on first sign-in." />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                    <th className="px-4 py-3 font-medium">Device</th>
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Platform</th>
                    <th className="px-4 py-3 font-medium">Version</th>
                    <th className="px-4 py-3 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-4 py-3 font-mono text-xs">{d.device_id}</td>
                      <td className="px-4 py-3 text-[var(--color-muted)]">{d.user?.label ?? "—"}</td>
                      <td className="px-4 py-3 capitalize">{d.platform ?? "—"}</td>
                      <td className="px-4 py-3">{d.app_version ?? "—"}</td>
                      <td className="px-4 py-3 text-[var(--color-muted)]">{fmtRelative(d.last_seen)}</td>
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

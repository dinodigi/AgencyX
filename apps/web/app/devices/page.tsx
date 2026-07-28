import { withClient, isConfigured } from "@/lib/agentx.ts";
import { getAuthStatus } from "@/lib/auth.ts";
import { PageHeader, Card, EmptyState, NotConfigured } from "@/components/ui.tsx";
import { AuthGate } from "@/components/AuthGate.tsx";
import { fmtRelative } from "@/lib/format.ts";
import { DESKTOP_DOWNLOAD_URL, DESKTOP_DOWNLOAD_HINT } from "@/lib/desktop.ts";

export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  if (!isConfigured()) return <NotConfigured />;
  const status = await getAuthStatus();
  if (status !== "ready") return <AuthGate status={status} />;
  const ctx = await withClient();
  if (!ctx) return <AuthGate status="signed-out" />;

  let rows: Awaited<ReturnType<typeof ctx.ax.devices.list>> = [];
  let error: string | null = null;
  try {
    rows = await ctx.ax.devices.list({ limit: 100, sort: { field: "last_seen", dir: "desc" } });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <PageHeader
        title="Devices"
        subtitle={`${rows.length} registered`}
        actions={
          <a href={DESKTOP_DOWNLOAD_URL} className="btn-primary px-4 py-2 text-sm" title={DESKTOP_DOWNLOAD_HINT}>
            Download desktop app ↓
          </a>
        }
      />
      <div className="p-8">
        {error ? (
          <EmptyState title="Couldn't load devices" hint={error} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No devices yet"
            hint="Download the desktop app above, install it, and sign in — the device registers here. Windows may show a SmartScreen warning (unsigned installer): choose More info → Run anyway."
          />
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

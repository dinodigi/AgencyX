import { withClient, isConfigured } from "@/lib/agentx.ts";
import { getAuthStatus } from "@/lib/auth.ts";
import { PageHeader, NotConfigured, EmptyState } from "@/components/ui.tsx";
import { AuthGate } from "@/components/AuthGate.tsx";
import { Catalog } from "@/components/catalog/Catalog.tsx";
import { LiveRefresh } from "@/components/LiveRefresh.tsx";

export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  if (!isConfigured()) return <NotConfigured />;
  const status = await getAuthStatus();
  if (status !== "ready") return <AuthGate status={status} />;
  const ctx = await withClient();
  if (!ctx) return <AuthGate status="signed-out" />;

  let services: Awaited<ReturnType<typeof ctx.ax.services.list>> = [];
  let microservices: Awaited<ReturnType<typeof ctx.ax.microservices.list>> = [];
  let packages: Awaited<ReturnType<typeof ctx.ax.packages.list>> = [];
  let error: string | null = null;
  try {
    [services, microservices, packages] = await Promise.all([
      ctx.ax.services.list({ limit: 200, sort: { field: "sort_order", dir: "asc" } }),
      ctx.ax.microservices.list({ limit: 300, sort: { field: "sort_order", dir: "asc" } }),
      ctx.ax.packages.list({ limit: 300, sort: { field: "sort_order", dir: "asc" } }),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <LiveRefresh watch={["services", "microservices", "packages"]} />
      <PageHeader title="Services & packages" subtitle="Build the offers you sell — reused in every proposal." />
      {error ? (
        <div className="p-8">
          <EmptyState title="Couldn't load your catalog" hint={error} />
        </div>
      ) : (
        <Catalog services={services} microservices={microservices} packages={packages} />
      )}
    </div>
  );
}

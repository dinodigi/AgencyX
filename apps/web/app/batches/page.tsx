import { isConfigured } from "@/lib/agentx.ts";
import { getSession } from "@/lib/auth.ts";
import { PageHeader, Card, SignedOut, NotConfigured } from "@/components/ui.tsx";
import { BatchBuilder } from "@/components/BatchBuilder.tsx";

export const dynamic = "force-dynamic";

export default async function BatchesPage() {
  if (!isConfigured()) return <NotConfigured />;
  if (!(await getSession())) return <SignedOut />;

  return (
    <div>
      <PageHeader title="Batch builder" subtitle="Keywords × ZIPs → search queue units" />
      <div className="p-8 max-w-3xl">
        <Card className="p-6">
          <BatchBuilder />
        </Card>
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          Each keyword × ZIP becomes one search unit the desktop scraper works. Re-submitting is safe — units already
          covered are skipped, not duplicated.
        </p>
      </div>
    </div>
  );
}

import Link from "next/link";
import { isConfigured } from "@/lib/agentx.ts";
import { getAuthStatus } from "@/lib/auth.ts";
import { PageHeader, Card, NotConfigured } from "@/components/ui.tsx";
import { AuthGate } from "@/components/AuthGate.tsx";
import { SearchForm } from "@/components/SearchForm.tsx";

export const dynamic = "force-dynamic";

/**
 * Search — a single targeted search (keyword × ZIP + target filter). Queues one
 * search_queries row the desktop scrapes. For many keywords × many ZIPs at once,
 * use the Batch builder.
 */
export default async function SearchPage() {
  if (!isConfigured()) return <NotConfigured />;
  const status = await getAuthStatus();
  if (status !== "ready") return <AuthGate status={status} />;

  return (
    <div>
      <PageHeader title="Search" subtitle="One keyword × area, with target filters — the scraper keeps only matches." />
      <div className="p-8 max-w-3xl">
        <Card className="p-6">
          <SearchForm />
        </Card>
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          Queued searches run on the desktop app (“Run next queued”). Track progress and results on{" "}
          <Link href="/coverage" className="text-[var(--color-stage-qualified)] hover:underline">
            Coverage
          </Link>
          . Need many keywords × ZIPs at once? Use the{" "}
          <Link href="/batches" className="text-[var(--color-stage-qualified)] hover:underline">
            Batch builder
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

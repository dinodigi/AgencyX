import Link from "next/link";
import { isConfigured } from "@/lib/agentx.ts";
import { getAuthStatus } from "@/lib/auth.ts";
import { PageHeader, Card, NotConfigured } from "@/components/ui.tsx";
import { AuthGate } from "@/components/AuthGate.tsx";
import { SearchPanel } from "@/components/SearchPanel.tsx";
import type { SearchMode } from "@dinosales/ui/search";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

/**
 * Search — the single acquisition surface. Single vs Batch is a mode toggle in
 * the form (Single is a batch of one); both queue search_queries rows the
 * desktop scrapes, carrying target filters, speed, and detail level.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  if (!isConfigured()) return <NotConfigured />;
  const status = await getAuthStatus();
  if (status !== "ready") return <AuthGate status={status} />;

  const sp = await searchParams;
  const initialMode: SearchMode | undefined = sp.mode === "batch" ? "batch" : sp.mode === "single" ? "single" : undefined;

  return (
    <div>
      <PageHeader title="Search" subtitle="Find businesses by keyword × area. Single or batch, with target filters and pacing." />
      <div className="p-8 max-w-3xl">
        <Card className="p-6">
          <SearchPanel initialMode={initialMode} />
        </Card>
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          Queued searches run on the desktop app — it picks up pending searches automatically when idle. Track progress and
          results on{" "}
          <Link href="/coverage" className="text-[var(--color-stage-qualified)] hover:underline">
            Coverage
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

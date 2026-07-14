import Link from "next/link";
import type { ReactNode } from "react";
import { withClient, isConfigured } from "@/lib/agentx.ts";
import { getAuthStatus } from "@/lib/auth.ts";
import { PageHeader, Card, EmptyState, NotConfigured, StageBadge } from "@/components/ui.tsx";
import { AuthGate } from "@/components/AuthGate.tsx";
import { StageActions } from "@/components/StageActions.tsx";
import { QualifyActions } from "@/components/QualifyActions.tsx";
import { DeleteLeadButton } from "@/components/DeleteLeadButton.tsx";
import { LiveRefresh } from "@/components/LiveRefresh.tsx";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isConfigured()) return <NotConfigured />;
  const status = await getAuthStatus();
  if (status !== "ready") return <AuthGate status={status} />;
  const ctx = await withClient();
  if (!ctx) return <AuthGate status="signed-out" />;

  const { id } = await params;
  let lead: Awaited<ReturnType<typeof ctx.ax.leads.get>> | null = null;
  let qual: Awaited<ReturnType<typeof ctx.ax.qualifications.list>>[number] | null = null;
  let error: string | null = null;
  try {
    lead = await ctx.ax.leads.get(id);
    qual = (await ctx.ax.qualifications.list({ filter: { lead: id }, limit: 1 }))[0] ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error || !lead) {
    return (
      <div>
        <PageHeader title="Lead" actions={<BackLink />} />
        <div className="p-8">
          <EmptyState title="Couldn't load this lead" hint={error ?? "Not found."} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <LiveRefresh watch={["leads", "qualifications"]} />
      <PageHeader
        title={lead.business_name}
        subtitle={lead.category ?? undefined}
        actions={
          <div className="flex items-center gap-3">
            <StageBadge stage={lead.stage} />
            <BackLink />
          </div>
        }
      />

      <div className="p-8 flex flex-col gap-6 max-w-5xl">
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold text-[var(--color-muted)]">Pipeline</h2>
          <StageActions leadId={lead.id} stage={lead.stage ?? "scraped"} />
        </Card>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Section title="Contact & location">
            <Field label="Phone" value={lead.phone} />
            <Field label="Address" value={lead.address} />
            <Field
              label="Website"
              value={
                lead.has_website && lead.website ? (
                  <a href={lead.website} target="_blank" rel="noreferrer" className="text-[var(--color-stage-qualified)] hover:underline">
                    {lead.website} ↗
                  </a>
                ) : (
                  <span className="text-[var(--color-stage-building)]">no website</span>
                )
              }
            />
            <Field label="Hours" value={lead.hours ? <span className="whitespace-pre-line">{lead.hours}</span> : undefined} />
            <Field label="Price level" value={lead.price_level} />
            <Field label="Claimed" value={lead.claimed ? "yes" : <span className="text-[var(--color-stage-building)]">no</span>} />
          </Section>

          <Section title="Reputation">
            <Field label="Rating" value={lead.rating ? `${lead.rating.toFixed(1)} ★` : "—"} />
            <Field label="Reviews" value={lead.review_count ?? 0} />
            <Field label="Review tier" value={lead.review_bucket} />
            <Field label="Photos" value={lead.photo_count ?? 0} />
          </Section>

          <Section title="Qualification">
            <Field
              label="Research job"
              value={
                qual ? (
                  <span className="capitalize">{qual.status ?? "pending"}</span>
                ) : (
                  <span className="text-[var(--color-muted)]">not queued</span>
                )
              }
            />
            {qual?.page_count !== undefined && <Field label="Pages crawled" value={qual.page_count} />}
            {qual?.collected_at && <Field label="Signals collected" value={new Date(qual.collected_at).toLocaleString()} />}
            <div className="pt-1">
              <QualifyActions leadId={lead.id} status={qual?.status} />
            </div>
          </Section>

          <Section title="Signals & scores">
            <Field label="Has website" value={lead.has_website ? "yes" : "no"} />
            <Field label="Listing health" value={lead.listing_health_score ?? "— (Phase 2)"} />
            <Field label="Qualification" value={lead.qualification_score ?? "— (Phase 3)"} />
          </Section>

          <Section title="Source">
            <Field label="Search query" value={lead.search_query?.label} />
            <Field label="Agency" value={lead.agency?.label} />
            <Field label="Scraped by device" value={lead.device?.label} />
            <Field label="Place ID" value={<span className="font-mono text-xs">{lead.place_id}</span>} />
          </Section>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Section title="Activity & history">
            <p className="text-sm text-[var(--color-muted)]">
              Stage changes, proposals, and notes will appear here as the lead moves through its lifecycle.
              (Audit trail wiring — Phase 3+.)
            </p>
          </Section>
          <Section title="Proposal">
            <p className="text-sm text-[var(--color-muted)]">
              Sample site + proposal generation fire when a lead reaches <b>building</b> / <b>proposed</b>. (Phase 4/5.)
            </p>
          </Section>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/[0.03] px-6 py-4">
          <div>
            <div className="text-sm font-semibold text-[var(--color-ink)]">Delete this lead</div>
            <div className="text-xs text-[var(--color-muted)]">Removes it from the pipeline. This can't be undone.</div>
          </div>
          <DeleteLeadButton leadId={lead.id} name={lead.business_name} />
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/leads" className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)]">
      ← All leads
    </Link>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-6">
      <h2 className="mb-4 text-sm font-semibold text-[var(--color-muted)]">{title}</h2>
      <dl className="flex flex-col gap-3">{children}</dl>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  const empty = value === undefined || value === null || value === "";
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-border)] pb-2 last:border-0 last:pb-0">
      <dt className="text-sm text-[var(--color-muted)]">{label}</dt>
      <dd className="text-sm text-right">{empty ? <span className="text-[var(--color-muted)]">—</span> : value}</dd>
    </div>
  );
}

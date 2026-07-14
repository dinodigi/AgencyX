import type { ReactNode } from "react";
import type { Qualifications } from "@dinosales/agentx-client";
import type { QualificationBrief, QualificationScan } from "@dinosales/types";
import { Card } from "@/components/ui.tsx";
import { QualifyActions } from "@/components/QualifyActions.tsx";
import { BriefActions } from "@/components/BriefActions.tsx";

/**
 * The qualification workspace (build-order step 5): everything the research
 * job collected, the deterministic scores, and the AI brief — reviewable in
 * one place, because a lead only advances to `qualified` after a human has
 * seen this. Server component; live-sync refreshes it as statuses move.
 */

const REVIEWABLE = ["collected", "scored", "briefed"];

function parse<T>(json: string | undefined | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function scoreTone(score: number): string {
  if (score >= 70) return "var(--color-stage-sold)";
  if (score >= 40) return "var(--color-stage-building)";
  return "#f87171";
}

function ScoreTile({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className="mt-1 text-2xl font-bold" style={{ color: value !== undefined ? scoreTone(value) : "var(--color-muted)" }}>
        {value !== undefined ? value : "—"}
      </div>
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{title}</h3>
      {children}
    </div>
  );
}

function BulletList({ items, tone }: { items: string[]; tone?: string }) {
  if (items.length === 0) return <p className="text-sm text-[var(--color-muted)]">—</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full" style={{ background: tone ?? "var(--color-stage-qualified)" }} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const STATUS_HINT: Record<string, string> = {
  pending: "Queued — the desktop collects it next time it's idle.",
  collecting: "The desktop is collecting signals right now (re-scrape, crawl, Moz audit).",
  collected: "Signals are in — score it and generate the brief below.",
  scored: "Scored — generate the AI brief to complete the research.",
  briefed: "Research complete — review below, then advance the lead to qualified.",
  failed: "Collection failed — retry from here.",
};

export function QualificationPanel({ qual, leadId }: { qual: Qualifications | null; leadId: string }) {
  const status = qual?.status ?? undefined;
  const scan = parse<QualificationScan>(qual?.scan_json);
  const brief = parse<QualificationBrief>(qual?.brief_json);
  const reviewable = !!qual && REVIEWABLE.includes(status ?? "");

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-muted)]">Qualification research</h2>
          <p className="mt-1 text-sm">
            {qual ? (
              <>
                <span className="font-semibold capitalize" style={{ color: status === "failed" ? "#f87171" : "var(--color-ink)" }}>
                  {status}
                </span>
                <span className="text-[var(--color-muted)]"> — {STATUS_HINT[status ?? ""] ?? ""}</span>
              </>
            ) : (
              <span className="text-[var(--color-muted)]">Not queued yet — qualification research turns this lead into a decision-ready dossier.</span>
            )}
          </p>
        </div>
        <QualifyActions leadId={leadId} status={status} />
      </div>

      {/* Scores — deterministic, explainable; the AI never assigns them. */}
      {qual && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <ScoreTile label="SEO" value={qual.seo_score} />
          <ScoreTile label="Content" value={qual.content_score} />
          <ScoreTile label="UX" value={qual.ux_score} />
          <ScoreTile label="Performance" value={qual.performance_score} />
          <ScoreTile label="Listing" value={qual.listing_score} />
          <ScoreTile label="Business health" value={qual.business_health_score} />
        </div>
      )}

      {reviewable && (
        <div className="mb-5">
          <BriefActions qualId={qual!.id} leadId={leadId} briefed={status === "briefed"} />
        </div>
      )}

      {/* What was collected */}
      {scan && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {scan.site ? (
            <SubSection title={`Site crawl — ${scan.site.pageCount} pages · ${scan.site.tech.join(", ") || "stack unknown"}`}>
              <div className="mb-2 flex flex-wrap gap-2 text-xs text-[var(--color-muted)]">
                <span>{scan.site.robotsTxtFound ? "robots.txt ✓" : "no robots.txt"}</span>
                <span>·</span>
                <span>{scan.site.sitemapFound ? "sitemap ✓" : "no sitemap"}</span>
                <span>·</span>
                <span>silo: {scan.site.silo.map((s) => `${s.section} (${s.pages})`).join(" · ")}</span>
              </div>
              <BulletList items={scan.site.warnings} tone="var(--color-stage-building)" />
              <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-[var(--color-border)]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[var(--color-surface-2)] text-left text-[var(--color-muted)]">
                    <tr>
                      <th className="px-2 py-1.5">Page</th>
                      <th className="px-2 py-1.5">Title</th>
                      <th className="px-2 py-1.5 text-right">Words</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scan.site.pages.slice(0, 25).map((p) => (
                      <tr key={p.url} className="border-t border-[var(--color-border)]">
                        <td className="px-2 py-1.5 font-mono">
                          {p.status >= 400 && <span className="mr-1 text-red-400">{p.status}</span>}
                          {new URL(p.url).pathname}
                        </td>
                        <td className="px-2 py-1.5 text-[var(--color-muted)]">{p.title ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right">{p.wordCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SubSection>
          ) : (
            <SubSection title="Site crawl">
              <p className="text-sm text-[var(--color-stage-building)]">No website — that's the headline signal for the pitch.</p>
            </SubSection>
          )}

          <div className="flex flex-col gap-5">
            <SubSection title="Listing audit (Moz)">
              {scan.moz ? (
                <p className="text-sm">
                  Listed on <b>{scan.moz.directoriesFound ?? "?"}</b> of <b>{scan.moz.directoriesChecked ?? "?"}</b> directories · accuracy{" "}
                  <b style={{ color: scan.moz.score !== undefined ? scoreTone(scan.moz.score) : undefined }}>{scan.moz.score ?? "?"}</b>/100
                  {scan.moz.error && <span className="text-[var(--color-muted)]"> ({scan.moz.error} — reportId saved for re-fetch)</span>}
                </p>
              ) : (
                <p className="text-sm text-[var(--color-muted)]">Not run (no parseable address).</p>
              )}
            </SubSection>

            <SubSection title="Listing re-scrape">
              {scan.listing ? (
                <p className="text-sm">
                  {scan.listing.rating ?? "?"}★ · {scan.listing.reviewCount ?? 0} reviews · {scan.listing.claimed ? "claimed" : <span className="text-[var(--color-stage-building)]">unclaimed</span>}
                  {scan.listing.hours ? " · hours on file" : ""}
                </p>
              ) : (
                <p className="text-sm text-[var(--color-muted)]">Maps lookup didn't match — using stored lead data.</p>
              )}
            </SubSection>

            {scan.warnings.length > 0 && (
              <SubSection title="Collection notes">
                <BulletList items={scan.warnings} tone="var(--color-muted)" />
              </SubSection>
            )}
          </div>
        </div>
      )}

      {/* The AI brief */}
      {brief && (
        <div className="mt-6 border-t border-[var(--color-border)] pt-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--color-muted)]">AI brief</h2>
            <span className="text-xs text-[var(--color-muted)]">
              {qual?.model} · {qual?.briefed_at ? new Date(qual.briefed_at).toLocaleString() : ""}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-4">
              <SubSection title="SEO — summary">
                <p className="text-sm">{brief.seo.executiveSummary}</p>
              </SubSection>
              <SubSection title="Weaknesses">
                <BulletList items={brief.seo.audit.weaknesses} tone="#f87171" />
              </SubSection>
              <SubSection title="Technical issues">
                <BulletList items={brief.seo.audit.technicalIssues} tone="var(--color-stage-building)" />
              </SubSection>
              <SubSection title="Keyword strategy">
                <BulletList items={brief.seo.keywordStrategy} />
              </SubSection>
              <SubSection title="Roadmap">
                <BulletList items={brief.seo.roadmap} />
              </SubSection>
            </div>
            <div className="flex flex-col gap-4">
              <SubSection title="Brand essence">
                <p className="text-sm">{brief.brand.essence}</p>
              </SubSection>
              <SubSection title="Voice">
                <p className="text-sm">{brief.brand.voice}</p>
              </SubSection>
              <SubSection title="Visual direction">
                <p className="text-sm">{brief.brand.visualDirection}</p>
              </SubSection>
              <SubSection title="Verified facts">
                <BulletList items={brief.brand.verifiedFacts} tone="var(--color-stage-sold)" />
              </SubSection>
            </div>
            <div className="flex flex-col gap-4">
              <SubSection title="Proposal">
                <p className="text-sm">{brief.proposal.executiveSummary}</p>
              </SubSection>
              <SubSection title="Scope">
                <BulletList items={brief.proposal.scope} />
              </SubSection>
              <SubSection title="Outcomes">
                <BulletList items={brief.proposal.outcomes} tone="var(--color-stage-sold)" />
              </SubSection>
              <SubSection title="Recommended packages">
                <BulletList items={brief.proposal.recommendedPackages} tone="var(--color-stage-qualified)" />
              </SubSection>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

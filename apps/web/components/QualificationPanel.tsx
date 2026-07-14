import type { ReactNode } from "react";
import type { ListingAudits, Qualifications } from "@dinosales/agentx-client";
import type { MozDirectoryRow, QualificationBrief, QualificationScan } from "@dinosales/types";
import { Card } from "@/components/ui.tsx";
import { QualifyActions } from "@/components/QualifyActions.tsx";
import { BriefActions } from "@/components/BriefActions.tsx";
import { Tabs, type TabDef } from "@/components/Tabs.tsx";

/**
 * The qualification workspace (build-order step 5): status + scores stay
 * always-visible up top; everything deep — the AI brief, the crawl detail, the
 * per-directory Moz results, collection notes — lives behind tabs so the lead
 * page stays navigable. A lead only advances to `qualified` after a human has
 * reviewed this.
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

function statusTone(status: string): { color: string; label: string } {
  const s = status.toLowerCase();
  if (/good|correct|complete/.test(s)) return { color: "var(--color-stage-sold)", label: status };
  if (/attention|incomplete|partial|pending/.test(s)) return { color: "var(--color-stage-building)", label: status };
  if (/not[\s_-]?found|missing|absent/.test(s)) return { color: "#f87171", label: "Not found" };
  return { color: "var(--color-muted)", label: status };
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

// --- tab bodies ---------------------------------------------------------------

function BriefTab({ qual, brief }: { qual: Qualifications; brief: QualificationBrief }) {
  return (
    <div>
      <div className="mb-4 text-right text-xs text-[var(--color-muted)]">
        {qual.model} · {qual.briefed_at ? new Date(qual.briefed_at).toLocaleString() : ""}
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
  );
}

function SiteTab({ scan }: { scan: QualificationScan }) {
  if (!scan.site) {
    return <p className="text-sm text-[var(--color-stage-building)]">No website — that's the headline signal for the pitch.</p>;
  }
  const site = scan.site;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 text-xs text-[var(--color-muted)]">
        <span className="font-semibold text-[var(--color-ink)]">{site.pageCount} pages</span>
        <span>·</span>
        <span>{site.tech.join(", ") || "stack unknown"}</span>
        <span>·</span>
        <span>{site.robotsTxtFound ? "robots.txt ✓" : "no robots.txt"}</span>
        <span>·</span>
        <span>{site.sitemapFound ? "sitemap ✓" : "no sitemap"}</span>
        {site.truncated && (
          <>
            <span>·</span>
            <span className="text-[var(--color-stage-building)]">truncated at cap</span>
          </>
        )}
      </div>
      <SubSection title="Silo">
        <p className="text-sm text-[var(--color-muted)]">{site.silo.map((s) => `${s.section} (${s.pages})`).join(" · ")}</p>
      </SubSection>
      <SubSection title="On-page warnings">
        <BulletList items={site.warnings} tone="var(--color-stage-building)" />
      </SubSection>
      <SubSection title="Pages">
        <div className="max-h-80 overflow-y-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--color-surface-2)] text-left text-[var(--color-muted)]">
              <tr>
                <th className="px-2 py-1.5">Page</th>
                <th className="px-2 py-1.5">Title</th>
                <th className="px-2 py-1.5 text-right">Words</th>
              </tr>
            </thead>
            <tbody>
              {site.pages.slice(0, 40).map((p) => (
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
    </div>
  );
}

function ListingsTab({ scan, directories }: { scan: QualificationScan | null; directories: MozDirectoryRow[] }) {
  const moz = scan?.moz;
  return (
    <div className="flex flex-col gap-4">
      {moz ? (
        <p className="text-sm">
          Listed on <b>{moz.directoriesFound ?? "?"}</b> of <b>{moz.directoriesChecked ?? "?"}</b> directories · accuracy{" "}
          <b style={{ color: moz.score !== undefined ? scoreTone(moz.score) : undefined }}>{moz.score ?? "?"}</b>/100
          {moz.error && <span className="text-[var(--color-muted)]"> ({moz.error} — reportId saved for re-fetch)</span>}
        </p>
      ) : (
        <p className="text-sm text-[var(--color-muted)]">Listing audit not run (no parseable address).</p>
      )}

      {directories.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-surface-2)] text-left text-[var(--color-muted)]">
              <tr>
                <th className="px-2 py-1.5">Directory</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Name on file</th>
                <th className="px-2 py-1.5">Address on file</th>
                <th className="px-2 py-1.5">Phone</th>
                <th className="px-2 py-1.5 text-right">Reviews</th>
              </tr>
            </thead>
            <tbody>
              {directories.map((d, i) => {
                const tone = statusTone(d.status);
                return (
                  <tr key={`${d.source}-${i}`} className="border-t border-[var(--color-border)]">
                    <td className="px-2 py-1.5 font-medium">
                      {d.url ? (
                        <a href={d.url} target="_blank" rel="noreferrer" className="hover:underline">
                          {d.source} ↗
                        </a>
                      ) : (
                        d.source
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: tone.color, background: `color-mix(in srgb, ${tone.color} 12%, transparent)` }}>
                        {tone.label}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">{d.businessName ?? "—"}</td>
                    <td className="px-2 py-1.5 text-[var(--color-muted)]">{d.address ?? "—"}</td>
                    <td className="px-2 py-1.5">{d.phone ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">{d.reviewCount ? `${d.reviewCount}${d.rating ? ` · ${d.rating}★` : ""}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-muted)]">
          No per-directory rows on this audit{moz ? " — collected before directory detail shipped; re-run the research to fill this table" : ""}.
        </p>
      )}
    </div>
  );
}

function NotesTab({ qual, scan }: { qual: Qualifications; scan: QualificationScan | null }) {
  return (
    <div className="flex flex-col gap-4">
      <SubSection title="Listing re-scrape">
        {scan?.listing ? (
          <p className="text-sm">
            {scan.listing.rating ?? "?"}★ · {scan.listing.reviewCount ?? 0} reviews ·{" "}
            {scan.listing.claimed ? "claimed" : <span className="text-[var(--color-stage-building)]">unclaimed</span>}
            {scan.listing.hours ? " · hours on file" : ""}
          </p>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">Maps lookup didn't match — using stored lead data.</p>
        )}
      </SubSection>
      {scan && scan.warnings.length > 0 && (
        <SubSection title="Collection notes">
          <BulletList items={scan.warnings} tone="var(--color-muted)" />
        </SubSection>
      )}
      <SubSection title="Run metadata">
        <p className="text-sm text-[var(--color-muted)]">
          collected {qual.collected_at ? new Date(qual.collected_at).toLocaleString() : "—"}
          {qual.website_url ? ` · ${qual.website_url}` : ""}
          {qual.briefed_at ? ` · briefed ${new Date(qual.briefed_at).toLocaleString()} (${qual.model})` : ""}
        </p>
      </SubSection>
    </div>
  );
}

// --- the panel ----------------------------------------------------------------

export function QualificationPanel({ qual, audit, leadId }: { qual: Qualifications | null; audit: ListingAudits | null; leadId: string }) {
  const status = qual?.status ?? undefined;
  const scan = parse<QualificationScan>(qual?.scan_json);
  const brief = parse<QualificationBrief>(qual?.brief_json);
  const reviewable = !!qual && REVIEWABLE.includes(status ?? "");
  const directories = parse<MozDirectoryRow[]>(audit?.directories_json) ?? scan?.moz?.directories ?? [];

  const tabs: TabDef[] = [];
  if (brief && qual) tabs.push({ id: "brief", label: "AI brief", content: <BriefTab qual={qual} brief={brief} /> });
  if (scan) {
    tabs.push({ id: "site", label: "Site crawl", badge: scan.site ? String(scan.site.pageCount) : "none", content: <SiteTab scan={scan} /> });
    tabs.push({
      id: "listings",
      label: "Listings",
      badge: scan.moz ? `${scan.moz.directoriesFound ?? "?"}/${scan.moz.directoriesChecked ?? "?"}` : directories.length > 0 ? String(directories.length) : undefined,
      content: <ListingsTab scan={scan} directories={directories} />,
    });
    if (qual) tabs.push({ id: "notes", label: "Notes", badge: scan.warnings.length > 0 ? String(scan.warnings.length) : undefined, content: <NotesTab qual={qual} scan={scan} /> });
  }

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
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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

      {tabs.length > 0 && <Tabs tabs={tabs} defaultId={brief ? "brief" : "site"} />}
    </Card>
  );
}

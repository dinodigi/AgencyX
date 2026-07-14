/**
 * Qualification job orchestrator (build-order step 3): claim the row
 * (pending→collecting), then collect — deep listing re-scrape → bounded site
 * crawl → Moz audit sub-job — assemble scan_json, and land collecting→collected.
 * Scoring/AI never happens here; the desktop only gathers signals.
 *
 * Every dependency is injected (same pattern as ScrapeRunner) so the full
 * claim→collect→complete flow is testable with fakes. Each collection step is
 * best-effort: a failed lookup or Moz timeout degrades the scan, it does not
 * fail the job. Only a block (CAPTCHA) or a total failure marks the row failed.
 */

import type { ListingAuditsCreate } from "@dinosales/agentx-client";
import type { QualificationScan, RawListing, ScanMoz, ScanSite } from "@dinosales/types";
import { ScrapeBlockedError } from "../scraper/types.ts";
import type { PageReader } from "./crawler.ts";
import { crawlSite } from "./crawler.ts";
import { parseUsAddress } from "./address.ts";
import type { MozInput, MozRunResult } from "./moz.ts";

export interface QualifyJobRow {
  qualId: string;
  orgId: string;
  leadId: string;
  leadName: string;
  /** Lead-carried fallbacks — the deep re-scrape refreshes these when it works. */
  website?: string;
  address?: string;
  placeId?: string;
  agencyRowId?: string;
  deviceRowId?: string;
}

export type QualifyOutcomeKind = "completed" | "cancelled" | "blocked" | "error" | "lost-claim";

export interface QualifyOutcome {
  kind: QualifyOutcomeKind;
  pageCount: number;
  backoffMs?: number;
  message?: string;
}

/** Browser-owning collaborators come as factories so each run opens/closes cleanly. */
export interface QualifyRunnerDeps {
  claim: (qualId: string, deviceRowId: string) => Promise<{ claimed: boolean; reason?: string }>;
  complete: (
    qualId: string,
    result: { scan_json: string; page_count?: number; website_url?: string; collected_at: string },
  ) => Promise<void>;
  fail: (qualId: string) => Promise<void>;
  /** Write the Moz result as a listing_audits row (enrichment schema). */
  writeAudit: (audit: ListingAuditsCreate) => Promise<void>;
  /** Deep re-scrape one listing; null = not found. Throws ScrapeBlockedError on a block. */
  lookupListing: (job: QualifyJobRow, signal: AbortSignal) => Promise<RawListing | null>;
  /** Crawl page reader lifecycle (Playwright in prod, fake in tests). */
  makeReader: () => Promise<{ reader: PageReader; close: () => Promise<void> }>;
  /** Moz sub-job; undefined skips it (e.g. no browser available). */
  runMoz?: (input: MozInput, signal: AbortSignal) => Promise<MozRunResult>;
  /** Plain-text fetch for robots.txt / sitemaps — null on any failure. */
  fetchText: (url: string) => Promise<string | null>;
  onLog: (level: "info" | "warn" | "error", message: string) => void;
  now: () => string;
  maxPages?: number;
  maxCrawlMs?: number;
}

/** Delivery PATCH bodies ride JSON — keep scan_json comfortably under limits. */
const SCAN_JSON_MAX_CHARS = 350_000;

/** Serialize the scan, shedding crawl pages (never the summaries) until it fits. */
export function serializeScan(scan: QualificationScan): string {
  let json = JSON.stringify(scan);
  while (json.length > SCAN_JSON_MAX_CHARS && scan.site && scan.site.pages.length > 0) {
    scan.site.pages = scan.site.pages.slice(0, Math.max(0, Math.floor(scan.site.pages.length / 2)));
    scan.site.truncated = true;
    if (!scan.warnings.includes("scan_json trimmed to fit size cap")) {
      scan.warnings.push("scan_json trimmed to fit size cap");
    }
    json = JSON.stringify(scan);
  }
  return json;
}

export class QualifyRunner {
  constructor(private deps: QualifyRunnerDeps) {}

  async run(job: QualifyJobRow, signal: AbortSignal): Promise<QualifyOutcome> {
    const log = this.deps.onLog;
    if (!job.deviceRowId) {
      log("error", "cannot claim a qualification without a registered device");
      return { kind: "error", pageCount: 0, message: "no device row" };
    }

    const claim = await this.deps.claim(job.qualId, job.deviceRowId);
    if (!claim.claimed) {
      log("info", `qualification for "${job.leadName}" not claimed (${claim.reason ?? "unavailable"}) — skipping`);
      return { kind: "lost-claim", pageCount: 0, message: claim.reason };
    }
    log("info", `claimed qualification for "${job.leadName}" — collecting`);

    const scan: QualificationScan = { version: 1, collectedAt: this.deps.now(), warnings: [] };
    try {
      // 1 · deep listing re-scrape (best-effort; lead fields remain the fallback)
      let listing: RawListing | null = null;
      try {
        listing = await this.deps.lookupListing(job, signal);
        if (listing) {
          scan.listing = { ...listing, fetchedAt: this.deps.now() };
          log("info", `listing refreshed — ${listing.rating ?? "?"}★ (${listing.reviewCount ?? 0} reviews) · ${listing.website ? "site" : "no site"}`);
        } else {
          scan.warnings.push("deep re-scrape found no matching listing");
          log("warn", "deep re-scrape found no matching listing — using stored lead fields");
        }
      } catch (err) {
        if (err instanceof ScrapeBlockedError) throw err;
        scan.warnings.push(`listing re-scrape failed: ${err instanceof Error ? err.message : String(err)}`);
        log("warn", `listing re-scrape failed — continuing (${err instanceof Error ? err.message : String(err)})`);
      }
      this.throwIfAborted(signal);

      // 2 · bounded full crawl + on-page signals
      const website = listing?.website ?? job.website;
      let site: ScanSite | undefined;
      if (website) {
        const { reader, close } = await this.deps.makeReader();
        try {
          log("info", `crawling ${website} (caps: ${this.deps.maxPages ?? 30} pages / ${(this.deps.maxCrawlMs ?? 120_000) / 1000}s)`);
          site = await crawlSite({
            reader,
            startUrl: website,
            signal,
            maxPages: this.deps.maxPages,
            maxMs: this.deps.maxCrawlMs,
            fetchText: this.deps.fetchText,
            onProgress: (done, queued, url) => {
              if (done % 5 === 0) log("info", `crawl — ${done} pages read (${queued} queued) · ${url.slice(0, 60)}`);
            },
          });
          scan.site = site;
          log("info", `crawl done — ${site.pageCount} pages · silo ${site.silo.length} sections · tech: ${site.tech.join(", ") || "none detected"}`);
        } finally {
          await close().catch(() => {});
        }
      } else {
        scan.warnings.push("lead has no website — crawl skipped");
        log("info", "no website on this lead — crawl skipped (that's a signal in itself)");
      }
      this.throwIfAborted(signal);

      // 3 · Moz listing audit (async sub-job; degrades to reportId-only on timeout)
      const address = listing?.address ?? job.address;
      const parsed = parseUsAddress(address);
      if (this.deps.runMoz && parsed) {
        try {
          const moz = await this.deps.runMoz({ company: listing?.businessName ?? job.leadName, ...parsed }, signal);
          const summary: ScanMoz = {
            reportId: moz.reportId,
            submittedAt: moz.submittedAt,
            fetched: !!moz.parsed,
            directoriesChecked: moz.parsed?.checked,
            directoriesFound: moz.parsed?.found,
            score: moz.parsed?.score,
            error: moz.error,
          };
          scan.moz = summary;
          if (moz.parsed || moz.reportId) {
            await this.deps.writeAudit({
              org_id: job.orgId,
              lead: job.leadId,
              ...(job.agencyRowId ? { agency: job.agencyRowId } : {}),
              provider: "moz",
              report_id: moz.reportId,
              directories_checked: moz.parsed?.checked,
              directories_found: moz.parsed?.found,
              directories_json: moz.parsed ? JSON.stringify(moz.parsed.directories) : undefined,
              score: moz.parsed?.score,
              raw_result: moz.raw !== undefined ? JSON.stringify(moz.raw).slice(0, 200_000) : undefined,
              checked_at: this.deps.now(),
            });
            log("info", "moz audit stored in listing_audits");
          }
        } catch (err) {
          if (err instanceof ScrapeBlockedError) throw err;
          scan.moz = { fetched: false, error: err instanceof Error ? err.message : String(err) };
          log("warn", `moz audit failed — continuing (${scan.moz.error})`);
        }
      } else if (this.deps.runMoz) {
        scan.warnings.push("address not parseable for the Moz form — audit skipped");
        log("warn", `moz skipped — address not parseable (${address ?? "none"})`);
      }
      this.throwIfAborted(signal);

      // 4 · land it
      const scanJson = serializeScan(scan);
      await this.deps.complete(job.qualId, {
        scan_json: scanJson,
        page_count: site?.pageCount,
        website_url: website,
        collected_at: this.deps.now(),
      });
      log("info", `qualification for "${job.leadName}" collected — ${site?.pageCount ?? 0} pages, ${scan.warnings.length} warnings`);
      return { kind: "completed", pageCount: site?.pageCount ?? 0 };
    } catch (err) {
      const aborted = signal.aborted || (err instanceof Error && err.name === "AbortError");
      const blocked = err instanceof ScrapeBlockedError;
      const message = err instanceof Error ? err.message : String(err);
      try {
        await this.deps.fail(job.qualId);
      } catch (failErr) {
        log("error", `could not mark qualification failed: ${failErr instanceof Error ? failErr.message : String(failErr)}`);
      }
      if (blocked) {
        const backoffMs = (err as ScrapeBlockedError).backoffMs;
        log("error", `qualification blocked (${message}) — cooling down ~${Math.round(backoffMs / 60000)}m`);
        return { kind: "blocked", pageCount: 0, backoffMs, message };
      }
      if (aborted) {
        log("warn", `qualification for "${job.leadName}" cancelled — row marked failed (re-runnable)`);
        return { kind: "cancelled", pageCount: 0 };
      }
      log("error", `qualification for "${job.leadName}" failed: ${message}`);
      return { kind: "error", pageCount: 0, message };
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
  }
}

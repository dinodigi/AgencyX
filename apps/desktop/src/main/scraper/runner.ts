/**
 * Ties the scraper to the rest of the app: claim the query (queue-claim protocol,
 * S2 spike), run the engine, convert each RawListing into a LeadsCreate (dedup
 * key + precomputed filter fields), buffer it in the local outbox, then mark the
 * query completed/failed and kick the sync engine. Leads reach AgentX via the
 * outbox → sync path, never written here directly.
 */

import type { LeadsCreate } from "@dinosales/agentx-client";
import type { RawListing } from "@dinosales/types";
import { makeLeadDedupKey, reviewBucket, deriveHasWebsite } from "@dinosales/types";
import type { ScrapeSource, ScrapeOutcome } from "./types.ts";
import { ScraperEngine } from "./engine.ts";
import type { OutboxStore } from "../outbox.ts";

export interface RunContext {
  orgId: string;
  /** Optional relations — leads require only org_id/dedup_key/place_id/business_name. */
  agencyRowId?: string;
  deviceRowId?: string;
}

export interface ScrapeRunnerDeps {
  /** Only `enqueue` is used — typed narrowly so the pipeline is testable without SQLite. */
  outbox: Pick<OutboxStore, "enqueue">;
  makeSource: () => ScrapeSource;
  /** Claim the query for this device; false result = another device won it. */
  claim: (queryId: string, deviceRowId: string) => Promise<{ claimed: boolean; reason?: string }>;
  complete: (queryId: string, resultCount: number, scrapedAtIso: string) => Promise<void>;
  fail: (queryId: string) => Promise<void>;
  onLog: (level: "info" | "warn" | "error", message: string) => void;
  onOutcome: (outcome: ScrapeOutcome) => void;
  /** Called per captured listing (for the live table); receives the raw listing. */
  onCaptured?: (listing: RawListing) => void;
  /** ISO timestamp provider (injected so it's testable/deterministic). */
  now: () => string;
  maxLeads?: number;
}

export class ScrapeRunner {
  private engine = new ScraperEngine();

  constructor(private deps: ScrapeRunnerDeps) {}

  toLead(listing: RawListing, ctx: RunContext, queryId?: string): LeadsCreate {
    return {
      org_id: ctx.orgId,
      dedup_key: makeLeadDedupKey(ctx.orgId, listing.placeId),
      place_id: listing.placeId,
      business_name: listing.businessName,
      phone: listing.phone,
      website: listing.website,
      has_website: deriveHasWebsite(listing.website),
      address: listing.address,
      hours: listing.hours,
      category: listing.category,
      review_count: listing.reviewCount,
      rating: listing.rating,
      review_bucket: reviewBucket(listing.reviewCount),
      claimed: listing.claimed,
      photo_count: listing.photoCount,
      price_level: listing.priceLevel,
      // Optional relations are omitted (not set to undefined) when absent.
      ...(queryId ? { search_query: queryId } : {}),
      ...(ctx.agencyRowId ? { agency: ctx.agencyRowId } : {}),
      ...(ctx.deviceRowId ? { device: ctx.deviceRowId } : {}),
      stage: "scraped",
    };
  }

  private enqueueListing(listing: RawListing, ctx: RunContext, queryId: string | undefined): "queued" | "duplicate" {
    this.deps.onCaptured?.(listing);
    const lead = this.toLead(listing, ctx, queryId);
    return this.deps.outbox.enqueue(
      {
        dedupKey: lead.dedup_key,
        placeId: lead.place_id,
        businessName: lead.business_name,
        payloadJson: JSON.stringify(lead),
      },
      Date.now(),
    );
  }

  /**
   * Ad-hoc run — no pre-existing search_queries row, no claim. Scrapes a
   * keyword+zip straight into the outbox (leads then sync up normally). This is
   * the path used to prove the desktop loop before queue/device registration
   * lands; it does not touch query status.
   */
  async runAdhoc(keyword: string, zip: string, ctx: RunContext, signal: AbortSignal): Promise<ScrapeOutcome> {
    this.deps.onLog("info", `ad-hoc run: ${keyword}/${zip}`);
    let enqueued = 0;
    const outcome = await this.engine.run({
      source: this.deps.makeSource(),
      query: { keyword, zip },
      maxLeads: this.deps.maxLeads ?? 80,
      signal,
      onLog: this.deps.onLog,
      onListing: (listing) => {
        if (this.enqueueListing(listing, ctx, undefined) === "queued") enqueued++;
      },
    });
    this.deps.onLog("info", `ad-hoc run ${outcome.kind} — ${enqueued} new leads queued`);
    this.deps.onOutcome(outcome);
    return outcome;
  }

  async runQuery(queryId: string, keyword: string, zip: string, ctx: RunContext, signal: AbortSignal): Promise<ScrapeOutcome> {
    if (!ctx.deviceRowId) {
      this.deps.onLog("error", "cannot claim a queued query without a registered device");
      const outcome: ScrapeOutcome = { kind: "error", captured: 0, message: "no device row" };
      this.deps.onOutcome(outcome);
      return outcome;
    }
    const claim = await this.deps.claim(queryId, ctx.deviceRowId);
    if (!claim.claimed) {
      this.deps.onLog("info", `query ${keyword}/${zip} not claimed (${claim.reason ?? "unavailable"}) — skipping`);
      const outcome: ScrapeOutcome = { kind: "cancelled", captured: 0, message: claim.reason };
      this.deps.onOutcome(outcome);
      return outcome;
    }

    this.deps.onLog("info", `claimed ${keyword}/${zip} — starting run`);
    let enqueued = 0;
    let duplicates = 0;

    const outcome = await this.engine.run({
      source: this.deps.makeSource(),
      query: { keyword, zip },
      maxLeads: this.deps.maxLeads ?? 80,
      signal,
      onLog: this.deps.onLog,
      onListing: (listing) => {
        if (this.enqueueListing(listing, ctx, queryId) === "queued") enqueued++;
        else duplicates++;
      },
    });

    if (duplicates > 0) this.deps.onLog("info", `${duplicates} already-seen this run (local dedup)`);

    try {
      if (outcome.kind === "completed" || outcome.kind === "zero-results") {
        await this.deps.complete(queryId, enqueued, this.deps.now());
        this.deps.onLog("info", `query ${keyword}/${zip} completed — ${enqueued} new leads queued`);
      } else {
        await this.deps.fail(queryId);
        this.deps.onLog("warn", `query ${keyword}/${zip} marked failed (${outcome.kind})`);
      }
    } catch (err) {
      this.deps.onLog("error", `failed to update query status: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.deps.onOutcome(outcome);
    return outcome;
  }
}

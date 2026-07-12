/**
 * Deterministic fake source. Produces believable RawListings for a keyword+zip
 * with human-paced delays, so the whole pipeline (engine → outbox → sync) can be
 * exercised end-to-end without touching Google (no ToS exposure, no browser).
 * Used by the pipeline test and by a "dry run" toggle in the app.
 */

import type { RawListing } from "@dinosales/types";
import type { ScrapeQuery, ScrapeSource, ScrapeSourceOptions } from "./types.ts";
import { actionDelay, betweenListingsDelay } from "./human.ts";

const FIRST = ["Joe's", "Austin", "Barton", "South Congress", "Lone Star", "Hill Country", "Capital", "Bluebonnet"];
const KIND = ["Plumbing", "Plumbers", "Pipe Pros", "Rooter", "Services"];

export interface MockSourceConfig {
  /** How many listings to yield per search (clamped to opts.maxLeads). */
  count?: number;
  /** Simulate a CAPTCHA after N listings to exercise the cool-down path. */
  blockAfter?: number;
}

export class MockSource implements ScrapeSource {
  readonly name = "mock";
  constructor(private cfg: MockSourceConfig = {}) {}

  async open(): Promise<void> {}
  async close(): Promise<void> {}

  async *search(query: ScrapeQuery, opts: ScrapeSourceOptions): AsyncIterable<RawListing> {
    const want = Math.min(this.cfg.count ?? 6, opts.maxLeads);
    opts.onLog("info", `[mock] searching "${query.keyword}" in ${query.zip} — up to ${want} listings`);

    for (let i = 0; i < want; i++) {
      if (opts.signal.aborted) return;
      await betweenListingsDelay(opts.signal);

      if (this.cfg.blockAfter !== undefined && i >= this.cfg.blockAfter) {
        const { ScrapeBlockedError } = await import("./types.ts");
        throw new ScrapeBlockedError("[mock] simulated CAPTCHA");
      }

      await actionDelay(opts.signal);
      const name = `${FIRST[i % FIRST.length]} ${KIND[i % KIND.length]}`;
      const hasWebsite = i % 3 !== 0;
      const reviewCount = [0, 4, 37, 214, 512][i % 5]!;
      yield {
        placeId: `0x8644b${(1000 + i).toString(16)}:0x${(i * 7919).toString(16)}`,
        businessName: name,
        phone: `512-555-0${(100 + i).toString().padStart(3, "0")}`,
        website: hasWebsite ? `https://${name.toLowerCase().replace(/[^a-z]+/g, "")}.com` : undefined,
        address: `${100 + i} S Congress Ave, Austin, TX ${query.zip}`,
        category: "Plumber",
        hours: "Mon-Fri 8AM-6PM",
        reviewCount,
        rating: reviewCount === 0 ? undefined : 3.8 + (i % 5) * 0.25,
        claimed: i % 2 === 0,
        photoCount: i * 3,
        priceLevel: undefined,
      } satisfies RawListing;
    }
    opts.onLog("info", `[mock] search complete`);
  }
}

/**
 * Deterministic-ish fake source. Produces believable RawListings for a
 * keyword+zip with human-paced delays, so the whole pipeline (engine → outbox →
 * sync) can be exercised without touching Google (no ToS exposure, no browser).
 *
 * Each run uses a fresh seed, so re-running yields NEW leads (not dedup-to-0),
 * and addresses use the ACTUAL zip (no hardcoded city). The real GoogleMapsSource
 * is what actually respects location — this is placeholder data for testing.
 */

import type { RawListing } from "@dinosales/types";
import type { ScrapeQuery, ScrapeSource, ScrapeSourceOptions } from "./types.ts";
import { actionDelay, betweenListingsDelay, randInt } from "./human.ts";

const PREFIX = [
  "Prime",
  "Metro",
  "Elite",
  "Rapid",
  "Summit",
  "Pioneer",
  "Allstar",
  "Reliable",
  "Apex",
  "Vanguard",
  "Blue Ribbon",
  "First Choice",
];
const STREETS = ["Main St", "Oak Ave", "Elm St", "Park Ave", "2nd St", "Market St", "Broadway", "Hill St", "Lake Dr"];

export interface MockSourceConfig {
  /** Fixed count (tests). Omit for a realistic random count per run. */
  count?: number;
  /** Simulate a CAPTCHA after N listings to exercise the cool-down path. */
  blockAfter?: number;
  /** Fixed seed (tests). Omit to vary per run. */
  seed?: number;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export class MockSource implements ScrapeSource {
  readonly name = "mock";
  constructor(private cfg: MockSourceConfig = {}) {}

  async open(): Promise<void> {}
  async close(): Promise<void> {}

  async *search(query: ScrapeQuery, opts: ScrapeSourceOptions): AsyncIterable<RawListing> {
    const seed = this.cfg.seed ?? Date.now() % 100000;
    const want = Math.min(this.cfg.count ?? randInt(6, 14), opts.maxLeads);
    const kw = query.keyword.trim() || "business";
    const noun = kw.replace(/s$/i, "");
    const label = noun ? titleCase(noun) : titleCase(kw);
    opts.onLog("info", `[mock] searching "${kw}" in ${query.zip} — up to ${want} listings`);

    for (let i = 0; i < want; i++) {
      if (opts.signal.aborted) return;
      await betweenListingsDelay(opts.signal);

      if (this.cfg.blockAfter !== undefined && i >= this.cfg.blockAfter) {
        const { ScrapeBlockedError } = await import("./types.ts");
        throw new ScrapeBlockedError("[mock] simulated CAPTCHA");
      }

      await actionDelay(opts.signal);
      const n = seed + i;
      const prefix = PREFIX[n % PREFIX.length]!;
      const name = `${prefix} ${label}`;
      const hasWebsite = n % 3 !== 0;
      const reviewCount = [0, 5, 23, 88, 240, 512][n % 6]!;
      const streetNo = 100 + ((n * 37) % 8900);

      yield {
        // Unique per run so re-runs produce fresh leads.
        placeId: `mock:${seed.toString(36)}:${i}`,
        businessName: name,
        phone: `(555) ${String(100 + i).padStart(3, "0")}-${String(n % 10000).padStart(4, "0")}`,
        website: hasWebsite ? `https://${prefix.toLowerCase().replace(/\s+/g, "")}${noun.toLowerCase()}.example` : undefined,
        // Uses the ACTUAL zip — no fabricated city.
        address: `${streetNo} ${STREETS[n % STREETS.length]}, ${query.zip}`,
        category: label,
        hours: "Mon–Fri 8AM–6PM",
        reviewCount,
        rating: reviewCount === 0 ? undefined : Math.round((3.6 + (n % 14) / 10) * 10) / 10,
        claimed: n % 2 === 0,
        photoCount: n % 40,
        priceLevel: undefined,
      } satisfies RawListing;
    }
    opts.onLog("info", `[mock] search complete`);
  }
}

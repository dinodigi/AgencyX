/**
 * Real Google Maps source (§5.2), TWO-PHASE (as designed):
 *
 *   Phase 1 — harvest the feed: scroll the results list and read each card's
 *     quick-preview data (name, rating, reviews, category, address) directly from
 *     the feed. Fast, low-risk, and gets SOMETHING for every result.
 *   Phase 2 — open each listing: navigate into the place page and read the rich
 *     detail the card doesn't have (phone, website, hours, claimed status).
 *
 * Each yielded lead is the card data enriched with detail — so even if a
 * listing's detail fails to load, the phase-1 preview still produces a lead.
 *
 * Extraction runs IN THE PAGE via page.evaluate with multiple fallbacks, so a
 * single renamed class doesn't wipe a field. Playwright drives a real Chrome
 * channel with the stealth plugin. Selectors still drift — logs narrate each
 * phase so tuning is targeted (roadmap §12.5).
 */

import type { RawListing } from "@dinosales/types";
import type { ScrapeQuery, ScrapeSource, ScrapeSourceOptions } from "./types.ts";
import { ScrapeBlockedError, SelectorMissError } from "./types.ts";
import { actionDelay, betweenListingsDelay, randomUserAgent, randomViewport, sleep, randInt } from "./human.ts";
import { MAPS, placeIdFromUrl } from "./selectors.ts";

// Minimal Playwright surface we depend on (declared locally so this file
// typechecks without the package installed; the runtime objects are real).
interface PwLocator {
  count(): Promise<number>;
}
interface PwPage {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  locator(selector: string): PwLocator;
  url(): string;
  evaluate<R>(fn: () => R): Promise<R>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
}
interface PwBrowser {
  newContext(opts: Record<string, unknown>): Promise<PwContext>;
  close(): Promise<void>;
}

/** Raw card data harvested from the feed in phase 1 (in-page shapes). */
interface CardRaw {
  href: string;
  name: string;
  ratingLabel: string; // "4.7 stars 123 reviews" (aria-label on the stars)
  ratingText: string; // "4.7"
  reviewText: string; // "(123)"
  infoText: string; // "Plumber · 123 Main St · Open"
}

/** Detail fields harvested from a place page in phase 2. */
interface DetailRaw {
  phone: string | null;
  website: string | null;
  address: string | null;
  hours: string | null;
  priceLevel: string | null;
  claimed: boolean;
}

export interface GoogleSourceConfig {
  channel?: string;
  maxScrolls?: number;
}

export class GoogleMapsSource implements ScrapeSource {
  readonly name = "google-maps";
  private browser: PwBrowser | null = null;
  private ctx: PwContext | null = null;

  constructor(private cfg: GoogleSourceConfig = {}) {}

  async open(): Promise<void> {
    const { chromium } = (await import("playwright-extra")) as unknown as {
      chromium: { use(p: unknown): void; launch(o: Record<string, unknown>): Promise<PwBrowser> };
    };
    const stealth = (await import("puppeteer-extra-plugin-stealth")) as unknown as { default: () => unknown };
    chromium.use(stealth.default());

    this.browser = await chromium.launch({
      channel: this.cfg.channel ?? "chrome",
      headless: false,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    this.ctx = await this.browser.newContext({
      viewport: randomViewport(),
      userAgent: randomUserAgent(),
      locale: "en-US",
    });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.ctx = null;
  }

  async *search(query: ScrapeQuery, opts: ScrapeSourceOptions): AsyncIterable<RawListing> {
    if (!this.ctx) throw new Error("source not open()ed");
    const page = await this.ctx.newPage();
    opts.onLog("info", `Chrome launched — opening Google Maps: "${query.keyword}" in ${query.zip}`);
    await page.goto(MAPS.searchUrl(query.keyword, query.zip), { waitUntil: "domcontentloaded", timeout: 30000 });
    await actionDelay(opts.signal);
    opts.onLog("info", `page loaded (${page.url().slice(0, 70)}…)`);

    if (/consent\.google|\/consent/i.test(page.url())) {
      opts.onLog("warn", "Google is showing a consent page — dismiss it once in the Chrome window, then re-run");
    }
    await this.assertNotBlocked(page);

    if ((await page.locator(MAPS.resultsFeed).count()) === 0) {
      opts.onLog("error", "results feed not found — Google's layout changed vs our selectors (tune selectors.ts)");
      throw new SelectorMissError("resultsFeed", "results feed not found");
    }

    // ── Phase 1: harvest the feed ──────────────────────────────────────────
    opts.onLog("info", "phase 1 — scrolling the map view and reading preview cards…");
    const cards = await this.harvestFeed(page, opts);
    if (cards.length === 0) {
      opts.onLog("warn", "no result cards read from the feed (card selectors need tuning)");
      return;
    }
    const targets = cards.slice(0, opts.maxLeads);
    const sample = targets[0]!;
    opts.onLog("info", `phase 1 — ${targets.length} businesses in the map view. sample: "${sample.name}" | rating "${sample.ratingLabel || sample.ratingText}" | info "${sample.infoText.slice(0, 60)}"`);

    // ── Phase 2: open each listing for detail ──────────────────────────────
    opts.onLog("info", "phase 2 — opening each listing for phone / website / hours…");
    let done = 0;
    for (const c of targets) {
      if (opts.signal.aborted) return;
      const quick = this.parseCard(c);

      let detail: DetailRaw | null = null;
      try {
        await page.goto(c.href, { waitUntil: "domcontentloaded", timeout: 20000 });
        await actionDelay(opts.signal);
        await this.assertNotBlocked(page);
        detail = await this.extractDetail(page);
      } catch (err) {
        if (err instanceof ScrapeBlockedError) throw err;
        opts.onLog("warn", `"${quick.businessName}": detail failed (${err instanceof Error ? err.message : String(err)}) — preview only`);
      }

      yield {
        ...quick,
        phone: detail?.phone ?? undefined,
        website: detail?.website ?? undefined,
        address: detail?.address ?? quick.address,
        hours: detail?.hours ?? undefined,
        priceLevel: detail?.priceLevel ?? undefined,
        claimed: detail?.claimed,
      } satisfies RawListing;

      done++;
      opts.onLog("info", `phase 2 — ${done}/${targets.length}: ${quick.businessName}`);
      await betweenListingsDelay(opts.signal);
    }
    opts.onLog("info", `done — ${done} businesses captured`);
  }

  private async assertNotBlocked(page: PwPage): Promise<void> {
    if ((await page.locator(MAPS.captcha).count()) > 0) {
      throw new ScrapeBlockedError("CAPTCHA / unusual-traffic page detected");
    }
  }

  /** Phase 1: scroll the feed to load cards, then read them all in one in-page pass. */
  private async harvestFeed(page: PwPage, opts: ScrapeSourceOptions): Promise<CardRaw[]> {
    const maxScrolls = this.cfg.maxScrolls ?? 20;
    let prev = -1;
    for (let s = 0; s < maxScrolls; s++) {
      if (opts.signal.aborted) break;
      const count = await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) feed.scrollTop = feed.scrollHeight;
        return feed ? feed.querySelectorAll('a[href*="/maps/place/"]').length : 0;
      });
      if (count >= opts.maxLeads) break;
      if (count === prev) break; // no new cards loaded — reached the end
      prev = count;
      await sleep(randInt(900, 1700), opts.signal);
    }

    return page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) return [] as CardRaw[];
      const out: CardRaw[] = [];
      const seen = new Set<string>();
      for (const a of Array.from(feed.querySelectorAll<HTMLAnchorElement>('a[href*="/maps/place/"]'))) {
        const href = a.href;
        const name = a.getAttribute("aria-label") ?? "";
        if (!name || seen.has(href)) continue;
        seen.add(href);
        // Walk up to the card container to find the rating/info siblings.
        let card: HTMLElement = a;
        for (let i = 0; i < 5 && card.parentElement; i++) {
          card = card.parentElement;
          if (/Nv2PK|bfdHYd|lI9IFe/.test(card.className)) break;
        }
        const stars = card.querySelector('span[role="img"][aria-label]');
        out.push({
          href,
          name,
          ratingLabel: stars?.getAttribute("aria-label") ?? "",
          ratingText: card.querySelector(".MW4etd")?.textContent?.trim() ?? "",
          reviewText: card.querySelector(".UY7F9")?.textContent?.trim() ?? "",
          infoText: card.querySelector(".W4Efsd")?.textContent?.trim() ?? "",
        });
      }
      return out;
    });
  }

  /** Turn phase-1 card data into the baseline lead (name/rating/reviews/category/address). */
  private parseCard(c: CardRaw): RawListing {
    const placeId = placeIdFromUrl(c.href) ?? `name:${c.name.toLowerCase().replace(/\s+/g, "-")}`;

    // Rating: from the "4.7 stars 123 reviews" label, else the bare number span.
    let rating: number | undefined;
    let reviewCount: number | undefined;
    const rl = c.ratingLabel.match(/([\d.]+)\s*stars?/i);
    if (rl) rating = Number(rl[1]);
    else if (c.ratingText) {
      const n = Number(c.ratingText.replace(",", "."));
      if (n >= 0 && n <= 5) rating = n;
    }
    if (rating !== undefined && (rating < 0 || rating > 5 || Number.isNaN(rating))) rating = undefined;
    const revl = c.ratingLabel.match(/([\d,]+)\s*reviews?/i) ?? c.reviewText.match(/([\d,]+)/);
    if (revl) reviewCount = Number(revl[1]!.replace(/,/g, "")) || undefined;

    // Category + address from the info line "Category · Address · Open …".
    const parts = c.infoText
      .split(/·|⋅/)
      .map((p) => p.trim())
      .filter(Boolean);
    const category = parts[0] && !/\d{2,}/.test(parts[0]) ? parts[0] : undefined;
    const address = parts.find((p) => /\d/.test(p) && !/^\d+(\.\d+)?$/.test(p));

    return { placeId, businessName: c.name, rating, reviewCount, category, address };
  }

  /** Phase 2: read the detail panel of the currently-open place page, in-page. */
  private extractDetail(page: PwPage): Promise<DetailRaw> {
    return page.evaluate(() => {
      const attr = (sel: string, a: string): string | null => document.querySelector(sel)?.getAttribute(a) ?? null;
      const clean = (v: string | null, re: RegExp): string | null => (v ? v.replace(re, "").trim() || null : null);

      const phone =
        clean(attr('button[data-item-id^="phone:tel:"]', "aria-label"), /^Phone:\s*/i) ??
        clean(attr('button[data-item-id^="phone:tel:"]', "data-item-id"), /^phone:tel:/i);
      const website = attr('a[data-item-id="authority"]', "href");
      const address = clean(attr('button[data-item-id="address"]', "aria-label"), /^Address:\s*/i);
      const hours =
        attr('[jsaction*="openhours"] [aria-label]', "aria-label") ??
        document.querySelector(".t39EBf")?.getAttribute("aria-label") ??
        document.querySelector(".t39EBf")?.textContent?.trim() ??
        null;
      const priceLevel = clean(attr('[aria-label*="Price:" i]', "aria-label"), /^Price:\s*/i);
      const claimed = !document.querySelector('a[href*="/maps/business"], button[aria-label*="Claim this business" i]');

      return { phone, website, address, hours, priceLevel, claimed };
    });
  }
}

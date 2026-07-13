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
  evaluate<R, A = undefined>(fn: (arg: A) => R, arg?: A): Promise<R>;
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

/**
 * Detail fields harvested from a place page in phase 2 — the AUTHORITATIVE
 * source. The map feed only gives names; everything worth having (reviews,
 * rating, hours, contact, category) is read here, from the open listing.
 */
interface DetailRaw {
  name: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  hours: string | null;
  priceLevel: string | null;
  photoCount: number | null;
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

    // ── Phase 2: open each listing and read the real data ──────────────────
    // The listing — not the map card — is where the focus is. We read reviews,
    // rating, hours, contact and category HERE; the card is only a fallback.
    opts.onLog("info", "phase 2 — opening each listing to read reviews / rating / hours / contact…");
    let done = 0;
    for (const c of targets) {
      if (opts.signal.aborted) return;
      const quick = this.parseCard(c);

      let detail: DetailRaw | null = null;
      try {
        await page.goto(c.href, { waitUntil: "domcontentloaded", timeout: 20000 });
        await actionDelay(opts.signal);
        await this.assertNotBlocked(page);
        await this.waitForDetail(page, opts.signal); // let the place panel render before reading
        detail = await this.extractDetail(page);
      } catch (err) {
        if (err instanceof ScrapeBlockedError) throw err;
        opts.onLog("warn", `"${quick.businessName}": detail failed (${err instanceof Error ? err.message : String(err)}) — feed preview only`);
      }

      // Listing is authoritative; fall back to the feed card only per-field when
      // detail is missing (e.g. the place panel failed to load).
      const merged: RawListing = {
        placeId: quick.placeId,
        businessName: detail?.name || quick.businessName,
        category: detail?.category ?? quick.category,
        rating: detail?.rating ?? quick.rating,
        reviewCount: detail?.reviewCount ?? quick.reviewCount,
        phone: detail?.phone ?? undefined,
        website: detail?.website ?? undefined,
        address: detail?.address ?? quick.address,
        hours: detail?.hours ?? undefined,
        priceLevel: detail?.priceLevel ?? undefined,
        photoCount: detail?.photoCount ?? undefined,
        claimed: detail?.claimed,
      };
      yield merged;

      done++;
      const stars = merged.rating != null ? `${merged.rating}★` : "?★";
      opts.onLog(
        "info",
        `phase 2 — ${done}/${targets.length}: ${merged.businessName} · ${merged.category ?? "—"} · ${stars} (${merged.reviewCount ?? 0} rev) · ${merged.phone ?? "no phone"} · ${merged.website ? "site" : "no site"} · ${merged.hours ? "hours✓" : "no hours"}`,
      );
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

  /** Wait for the place panel to actually render (its title) before we read it —
   *  domcontentloaded fires before Maps hydrates the detail pane. */
  private async waitForDetail(page: PwPage, signal: AbortSignal): Promise<void> {
    for (let i = 0; i < 10; i++) {
      if (signal.aborted) return;
      if ((await page.locator(MAPS.detail.name).count()) > 0) return;
      await sleep(400, signal);
    }
  }

  /**
   * Phase 2: read the full detail of the currently-open place page, in-page.
   * This is the authoritative extraction — reviews, rating, hours, contact and
   * category all come from here. Selectors are passed in from MAPS.detail so
   * every brittle anchor stays in selectors.ts.
   */
  private extractDetail(page: PwPage): Promise<DetailRaw> {
    return page.evaluate((s) => {
      const q = (sel: string) => document.querySelector(sel);
      const attr = (sel: string, a: string): string | null => q(sel)?.getAttribute(a) ?? null;
      const txt = (sel: string): string | null => q(sel)?.textContent?.trim() ?? null;
      const strip = (v: string | null, re: RegExp): string | null => (v ? v.replace(re, "").trim() || null : null);

      const name = txt(s.name);
      const category = strip(txt(s.category), /\s*[·⋅].*$/);

      // Rating (0–5), sanity-checked against the visible number / stars label.
      let rating: number | null = null;
      const rM = (txt(s.ratingValue) ?? attr(s.starsLabel, "aria-label") ?? "").match(/([\d.]+)/);
      if (rM) {
        const n = Number(rM[1]);
        if (n >= 0 && n <= 5) rating = n;
      }

      // Review count: the "N reviews" control, else the stars label, else the (N)
      // printed right after the rating in the F7nice block.
      let reviewCount: number | null = null;
      const revRaw =
        attr(s.reviewsCount, "aria-label") ?? txt(s.reviewsCount) ?? attr(s.starsLabel, "aria-label") ?? txt("div.F7nice");
      const revM = revRaw?.match(/([\d,]+)\s*review/i) ?? revRaw?.match(/\(([\d,]+)\)/);
      if (revM) {
        const n = Number(revM[1]!.replace(/,/g, ""));
        if (Number.isFinite(n)) reviewCount = n;
      }

      const phone =
        strip(attr(s.phone, "aria-label"), /^Phone:\s*/i) ?? strip(attr(s.phone, "data-item-id"), /^phone:(tel:)?/i);
      const website = attr(s.website, "href") ?? strip(attr(s.website, "aria-label"), /^Website:\s*/i);
      const address = strip(attr(s.address, "aria-label"), /^Address:\s*/i);

      // Hours: pick an aria-label that reads like hours (a day / AM / PM / Open /
      // Closed plus a digit) — never the bare "Hours" header, a rating or a review.
      let hours: string | null = null;
      const candidates: (string | null)[] = [attr(s.hours, "aria-label")];
      for (const el of Array.from(document.querySelectorAll("[aria-label]"))) candidates.push(el.getAttribute("aria-label"));
      for (const h of candidates) {
        if (
          h &&
          h.length < 220 &&
          /\d/.test(h) &&
          /(open|clos|a\.?m\.?\b|p\.?m\.?\b|24 hours|24\/7)/i.test(h) &&
          !/review|star|rating|photo|price/i.test(h)
        ) {
          hours = h.trim();
          break;
        }
      }

      // Price level — the $/$$ marker if the listing exposes one.
      const priceRaw = attr(s.priceLevel, "aria-label") ?? txt(s.priceLevel);
      const priceLevel = priceRaw ? (priceRaw.match(/[$€£¥]{1,4}/)?.[0] ?? strip(priceRaw, /^Price:\s*/i)) : null;

      // Photo count — only when the photos button carries a number (best-effort).
      let photoCount: number | null = null;
      const pM = attr(s.photoCountBtn, "aria-label")?.match(/([\d,]+)\s*photo/i);
      if (pM) {
        const n = Number(pM[1]!.replace(/,/g, ""));
        if (Number.isFinite(n)) photoCount = n;
      }

      // "Claim this business" only appears on UNCLAIMED listings.
      const claimed = !q(s.claimLink);

      return { name, category, rating, reviewCount, phone, website, address, hours, priceLevel, photoCount, claimed };
    }, MAPS.detail);
  }
}

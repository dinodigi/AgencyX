/**
 * Real Google Maps source (§5.2). Playwright driving a REAL Chrome channel
 * (channel:"chrome", not bundled headless Chromium — headless carries automation
 * fingerprints), with playwright-extra + the stealth plugin, randomized
 * viewport/UA, real scrolling, and jittered delays.
 *
 * Selectors live in selectors.ts (one-file fix). This class is the mechanics;
 * the selectors + timing are what you TUNE against real output (roadmap §12.5).
 * Requires: pnpm add playwright-extra puppeteer-extra-plugin-stealth (declared in
 * package.json). Modules are dynamic-imported so the mock path never loads them.
 */

import type { RawListing } from "@dinosales/types";
import type { ScrapeQuery, ScrapeSource, ScrapeSourceOptions } from "./types.ts";
import { ScrapeBlockedError, SelectorMissError } from "./types.ts";
import { actionDelay, betweenListingsDelay, randomUserAgent, randomViewport, sleep, randInt } from "./human.ts";
import { MAPS, parseRatingLabel, placeIdFromUrl } from "./selectors.ts";

// Minimal Playwright surface we depend on — declared locally so this file
// typechecks without the package installed. The runtime objects are the real
// Playwright ones (dynamic-imported below).
interface PwLocator {
  count(): Promise<number>;
  first(): PwLocator;
  nth(i: number): PwLocator;
  getAttribute(name: string): Promise<string | null>;
  textContent(): Promise<string | null>;
  isVisible(): Promise<boolean>;
  click(opts?: { timeout?: number }): Promise<void>;
  scrollIntoViewIfNeeded(opts?: { timeout?: number }): Promise<void>;
}
interface PwPage {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  locator(selector: string): PwLocator;
  url(): string;
  mouse: { wheel(dx: number, dy: number): Promise<void> };
  waitForTimeout(ms: number): Promise<void>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
}
interface PwBrowser {
  newContext(opts: Record<string, unknown>): Promise<PwContext>;
  close(): Promise<void>;
}

export interface GoogleSourceConfig {
  /** Override Chrome channel; default "chrome" (system Google Chrome). */
  channel?: string;
  /** Max scroll passes over the feed before giving up. */
  maxScrolls?: number;
}

export class GoogleMapsSource implements ScrapeSource {
  readonly name = "google-maps";
  private browser: PwBrowser | null = null;
  private ctx: PwContext | null = null;

  constructor(private cfg: GoogleSourceConfig = {}) {}

  async open(): Promise<void> {
    // Dynamic import keeps playwright-extra out of the mock/test path.
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
    const url = MAPS.searchUrl(query.keyword, query.zip);
    opts.onLog("info", `Chrome launched — opening Google Maps: "${query.keyword}" in ${query.zip}`);
    const page = await this.ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await actionDelay(opts.signal);
    opts.onLog("info", `page loaded (${page.url().slice(0, 70)}…)`);

    // Google frequently shows a consent/cookie wall first — a common reason a
    // real run captures nothing. Detect + explain rather than fail silently.
    if (/consent\.google|\/consent/i.test(page.url())) {
      opts.onLog("warn", "Google is showing a consent page — scraping is blocked until it's dismissed (selector-tuning item)");
    }
    await this.assertNotBlocked(page);

    // Empty search vs broken selector are distinct, logged states (§5.2).
    if ((await page.locator(MAPS.noResults).count()) > 0) {
      opts.onLog("info", `Google returned no results for "${query.keyword}" in ${query.zip}`);
      return;
    }
    const feed = page.locator(MAPS.resultsFeed);
    if ((await feed.count()) === 0) {
      opts.onLog("error", "results feed not found — Google's layout changed vs our selectors (needs tuning; see selectors.ts)");
      throw new SelectorMissError("resultsFeed", "results feed not found — DOM may have changed");
    }
    opts.onLog("info", "results feed found — reading listings");

    const seen = new Set<string>();
    let scrolls = 0;
    const maxScrolls = this.cfg.maxScrolls ?? 25;

    while (seen.size < opts.maxLeads && scrolls < maxScrolls) {
      if (opts.signal.aborted) return;
      const cards = page.locator(MAPS.resultCard);
      const n = await cards.count();
      opts.onLog("info", `scroll pass ${scrolls + 1}: ${n} cards on screen, ${seen.size} captured so far`);

      for (let i = 0; i < n && seen.size < opts.maxLeads; i++) {
        if (opts.signal.aborted) return;
        const card = cards.nth(i);
        const href = (await card.getAttribute("href")) ?? "";
        const placeId = placeIdFromUrl(href) ?? placeIdFromUrl(page.url());
        if (!placeId || seen.has(placeId)) continue;
        seen.add(placeId);

        try {
          await card.scrollIntoViewIfNeeded({ timeout: 5000 });
          await actionDelay(opts.signal);
          await card.click({ timeout: 8000 });
          await actionDelay(opts.signal);
          await this.assertNotBlocked(page);
          const listing = await this.extractDetail(page, placeId);
          if (listing) {
            yield listing;
          } else {
            opts.onLog("warn", `listing ${i + 1}: detail panel didn't load a name (skipped)`);
          }
        } catch (err) {
          if (err instanceof ScrapeBlockedError) throw err;
          opts.onLog("warn", `listing ${i + 1} skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
        await betweenListingsDelay(opts.signal);
      }

      // Scroll the feed to load more, human-ish.
      await page.mouse.wheel(0, randInt(600, 1400));
      await sleep(randInt(700, 1600), opts.signal);
      scrolls++;
    }
    opts.onLog("info", `done — ${seen.size} listings captured`);
  }

  private async assertNotBlocked(page: PwPage): Promise<void> {
    if ((await page.locator(MAPS.captcha).count()) > 0) {
      throw new ScrapeBlockedError("CAPTCHA / unusual-traffic page detected");
    }
  }

  private async extractDetail(page: PwPage, placeId: string): Promise<RawListing | null> {
    const d = MAPS.detail;
    const text = async (sel: string): Promise<string | undefined> => {
      const loc = page.locator(sel).first();
      if ((await loc.count()) === 0) return undefined;
      return (await loc.textContent())?.trim() || undefined;
    };
    const attr = async (sel: string, name: string): Promise<string | undefined> => {
      const loc = page.locator(sel).first();
      if ((await loc.count()) === 0) return undefined;
      return (await loc.getAttribute(name)) ?? undefined;
    };

    const businessName = await text(d.name);
    if (!businessName) return null; // detail didn't load — skip rather than store junk

    const ratingLabel = (await attr(d.ratingBlock, "aria-label")) ?? "";
    const { rating, reviewCount } = parseRatingLabel(ratingLabel);
    const website = await attr(d.website, "href");
    const claimVisible = (await page.locator(d.claimLink).count()) > 0;

    return {
      placeId,
      businessName,
      phone: (await attr(d.phone, "aria-label"))?.replace(/^Phone:\s*/i, "") ?? undefined,
      website: website ?? undefined,
      address: (await attr(d.address, "aria-label"))?.replace(/^Address:\s*/i, "") ?? undefined,
      category: await text(d.category),
      hours: await text(d.hours),
      reviewCount,
      rating,
      claimed: !claimVisible, // "Claim this business" present ⇒ unclaimed
      priceLevel: (await attr(d.priceLevel, "aria-label"))?.replace(/^Price:\s*/i, "") ?? undefined,
    } satisfies RawListing;
  }
}

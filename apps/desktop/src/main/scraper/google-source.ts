/**
 * Real Google Maps source (§5.2), TWO-PHASE, rebuilt 2026-07-13 onto STABLE
 * anchors after a fresh-session recon proved the old class-based selectors were
 * the cause of the shaky data ("Results" as a name, 0 reviews, 5.0 ratings):
 *
 *   Phase 1 — discovery: scroll the results feed and read each card's stable bits:
 *     the business NAME from the result link's aria-label, the rating from the
 *     stars aria-label, and both place ids (the /g/ MID + CID) from the href.
 *   Phase 2 — detail: open each place and read the authoritative fields off the
 *     h1, the data-item-id action buttons (phone/website), and the "N stars" /
 *     "N reviews" aria-labels. No CSS class is referenced anywhere.
 *
 * We stay on maps.google.com on purpose: a cold session on google.com/search
 * (tbm=lcl / the Knowledge Panel — which carry the cleaner selectors) trips the
 * /sorry unusual-traffic block; Maps tolerates the anonymous sessions we run.
 *
 * All raw extraction happens IN the page and returns plain strings; parsing lives
 * in Node (selectors.ts) so it's testable and out of the fragile evaluate body.
 */

import type { RawListing, SpeedProfile } from "@dinosales/types";
import type { ScrapeQuery, ScrapeSource, ScrapeSourceOptions } from "./types.ts";
import { ScrapeBlockedError, SelectorMissError } from "./types.ts";
import { actionDelay, betweenListingsDelay, scrollPause, randomUserAgent, randomViewport, sleep } from "./human.ts";
import { MAPS, bestPlaceId, extractPlaceIds, parseStars, parseReviews, parsePhone, cleanWebsite } from "./selectors.ts";

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

/** Raw card strings harvested from the feed in phase 1 (parsed in Node). */
interface CardRaw {
  href: string;
  name: string; // the link's aria-label = the business name
  starsAria: string; // "4.6 stars"
  cardText: string; // scoped to the card, for best-effort reviews/category/address
}

/** Raw detail strings read from a place page (parsed in Node). */
interface DetailRaw {
  url: string;
  h1: string | null;
  phoneAria: string | null;
  phoneId: string | null;
  website: string | null;
  addressAria: string | null;
  ratingAria: string | null; // "5.0 stars"
  reviewsAria: string | null; // "41 reviews"
  hours: string | null;
  claimPresent: boolean;
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
    opts.onLog("info", `Chrome launched — opening Google Maps: "${query.keyword}" near ${query.zip}`);
    await page.goto(MAPS.searchUrl(query.keyword, query.zip), { waitUntil: "domcontentloaded", timeout: 30000 });
    await actionDelay(opts.signal, opts.profile);
    opts.onLog("info", `page loaded (${page.url().slice(0, 70)}…)`);

    if (/\/sorry\//.test(page.url())) {
      throw new ScrapeBlockedError("Google 'unusual traffic' block (/sorry) — cooling down");
    }
    if (/consent\.google|\/consent/i.test(page.url())) {
      opts.onLog("warn", "Google is showing a consent page — dismiss it once in the Chrome window, then re-run");
    }
    await this.assertNotBlocked(page);

    if ((await page.locator(MAPS.resultsFeed).count()) === 0) {
      opts.onLog("error", "results feed not found — Google's layout changed vs our selectors (tune selectors.ts)");
      throw new SelectorMissError("resultsFeed", "results feed not found");
    }

    // ── Phase 1: discovery ─────────────────────────────────────────────────
    opts.onLog("info", "phase 1 — scrolling the results and reading names / ratings / ids…");
    const cards = await this.harvestFeed(page, opts);
    if (cards.length === 0) {
      opts.onLog("warn", "no result cards read from the feed (feed anchors need tuning)");
      return;
    }
    const targets = cards.slice(0, opts.maxLeads);
    const sample = this.parseCard(targets[0]!);
    opts.onLog(
      "info",
      `phase 1 — ${targets.length} businesses. sample: "${sample.businessName}" · ${sample.rating ?? "?"}★ · id ${sample.placeId.slice(0, 22)}`,
    );

    // Preview mode: return the feed cards without opening each listing.
    if (opts.detailLevel === "preview") {
      opts.onLog("info", "preview mode — returning feed cards without opening listings");
      for (const c of targets) {
        if (opts.signal.aborted) return;
        yield this.parseCard(c);
      }
      opts.onLog("info", `done — ${targets.length} businesses captured (preview)`);
      return;
    }

    // ── Phase 2: detail (authoritative) ────────────────────────────────────
    opts.onLog("info", "phase 2 — opening each listing for reviews / rating / phone / website / hours…");
    let done = 0;
    for (const c of targets) {
      if (opts.signal.aborted) return;
      const quick = this.parseCard(c);

      let detail: DetailRaw | null = null;
      try {
        await page.goto(c.href, { waitUntil: "domcontentloaded", timeout: 20000 });
        await actionDelay(opts.signal, opts.profile);
        if (/\/sorry\//.test(page.url())) throw new ScrapeBlockedError("Google /sorry block during detail");
        await this.assertNotBlocked(page);
        await this.waitForDetail(page, opts.signal);
        detail = await this.readDetail(page); // core fields from the clean, un-clicked panel
        detail.hours = await this.readFullHours(page, opts.signal); // then expand-if-needed + read hours
      } catch (err) {
        if (err instanceof ScrapeBlockedError) throw err;
        opts.onLog("warn", `"${quick.businessName}": detail failed (${err instanceof Error ? err.message : String(err)}) — feed data only`);
      }

      const ids = detail ? extractPlaceIds(detail.url) : { mid: null, cid: null };
      const merged: RawListing = {
        placeId: ids.mid ?? ids.cid ?? quick.placeId,
        businessName: detail?.h1 || quick.businessName,
        category: quick.category,
        rating: (detail ? parseStars(detail.ratingAria) : undefined) ?? quick.rating,
        reviewCount: (detail ? parseReviews(detail.reviewsAria) : undefined) ?? quick.reviewCount,
        phone: detail ? parsePhone(detail.phoneAria, detail.phoneId) : undefined,
        website: detail ? cleanWebsite(detail.website) : undefined,
        address: (detail?.addressAria ? detail.addressAria.replace(/^Address:\s*/i, "").trim() : undefined) ?? quick.address,
        hours: detail?.hours ?? undefined,
        claimed: detail ? !detail.claimPresent : undefined,
      };
      yield merged;

      done++;
      const stars = merged.rating != null ? `${merged.rating}★` : "?★";
      opts.onLog(
        "info",
        `phase 2 — ${done}/${targets.length}: ${merged.businessName} · ${merged.category ?? "—"} · ${stars} (${merged.reviewCount ?? 0} rev) · ${merged.phone ?? "no phone"} · ${merged.website ? "site" : "no site"} · ${merged.hours ? "hours✓" : "no hours"}`,
      );
      await betweenListingsDelay(opts.signal, opts.profile);
    }
    opts.onLog("info", `done — ${done} businesses captured`);
  }

  /**
   * Qualification deep re-scrape: find ONE business on Maps and read its full
   * detail off the same stable anchors. Search `name + locationHint`, match the
   * feed card by place id (MID/CID) — falling back to an exact name match, then
   * the first card — and run the phase-2 detail read on it. Returns null when
   * nothing matched; throws ScrapeBlockedError on /sorry / CAPTCHA.
   */
  async lookup(
    businessName: string,
    locationHint: string,
    opts: { signal: AbortSignal; profile: SpeedProfile; onLog: (level: "info" | "warn" | "error", message: string) => void; targetPlaceId?: string },
  ): Promise<RawListing | null> {
    if (!this.ctx) throw new Error("source not open()ed");
    const page = await this.ctx.newPage();
    const query = [businessName, locationHint].filter(Boolean).join(" ");
    opts.onLog("info", `lookup — searching Maps for "${query}"`);
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await actionDelay(opts.signal, opts.profile);
    if (/\/sorry\//.test(page.url())) throw new ScrapeBlockedError("Google 'unusual traffic' block (/sorry) during lookup");
    await this.assertNotBlocked(page);

    // Maps may jump straight to the place page for a specific-enough query —
    // in that case there is no feed, the detail panel is already up.
    let href: string | null = null;
    if (/\/maps\/place\//.test(page.url())) {
      href = page.url();
    } else {
      if ((await page.locator(MAPS.resultsFeed).count()) === 0) {
        opts.onLog("warn", "lookup — no results feed and not a place page; nothing matched");
        return null;
      }
      const feedOpts: ScrapeSourceOptions = { maxLeads: 10, signal: opts.signal, onLog: opts.onLog, profile: opts.profile, detailLevel: "full" };
      const cards = await this.harvestFeed(page, feedOpts);
      if (cards.length === 0) return null;
      const target = opts.targetPlaceId?.trim();
      const byId = target ? cards.find((c) => { const ids = extractPlaceIds(c.href); return ids.mid === target || ids.cid === target; }) : undefined;
      const byName = cards.find((c) => c.name.trim().toLowerCase() === businessName.trim().toLowerCase());
      const chosen = byId ?? byName ?? cards[0]!;
      if (!byId && target) opts.onLog("warn", `lookup — place id not in results; matched by ${byName ? "name" : "first result"}`);
      href = chosen.href;
      await page.goto(href, { waitUntil: "domcontentloaded", timeout: 20000 });
      await actionDelay(opts.signal, opts.profile);
      if (/\/sorry\//.test(page.url())) throw new ScrapeBlockedError("Google /sorry block during lookup detail");
      await this.assertNotBlocked(page);
    }

    await this.waitForDetail(page, opts.signal);
    const detail = await this.readDetail(page);
    detail.hours = await this.readFullHours(page, opts.signal);
    const ids = extractPlaceIds(detail.url);
    const name = detail.h1 || businessName;
    return {
      placeId: ids.mid ?? ids.cid ?? bestPlaceId(detail.url, name),
      businessName: name,
      rating: parseStars(detail.ratingAria),
      reviewCount: parseReviews(detail.reviewsAria),
      phone: parsePhone(detail.phoneAria, detail.phoneId),
      website: cleanWebsite(detail.website),
      address: detail.addressAria ? detail.addressAria.replace(/^Address:\s*/i, "").trim() : undefined,
      hours: detail.hours ?? undefined,
      claimed: !detail.claimPresent,
    };
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
      await scrollPause(opts.signal, opts.profile);
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
        // The card is the ancestor that is a direct child of the feed — scope the
        // text to it so we read this business, not the feed toolbar.
        let card: HTMLElement = a;
        while (card.parentElement && card.parentElement !== feed) card = card.parentElement;
        const stars = card.querySelector('span[role="img"][aria-label]');
        out.push({
          href,
          name,
          starsAria: stars?.getAttribute("aria-label") ?? "",
          cardText: (card.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 220),
        });
      }
      return out;
    });
  }

  /** Turn phase-1 card strings into a baseline lead. Reviews/category/address are
   *  best-effort here — phase 2 overrides them authoritatively. */
  private parseCard(c: CardRaw): RawListing {
    const placeId = bestPlaceId(c.href, c.name);
    const rating = parseStars(c.starsAria);

    // Reviews: the "(1,234)" count printed right after the rating on the card.
    const revM = c.cardText.match(/\(([\d,]+)\)/) ?? c.cardText.match(/([\d,]+)\s*reviews?/i);
    const reviewCount = revM ? Number(revM[1]!.replace(/,/g, "")) || undefined : undefined;

    // Category/address from the "·"-separated info line. Only trust it when real
    // separators exist — otherwise the concatenated card text isn't parseable and
    // an empty field beats garbage (phase 2 / the search keyword cover category).
    const parts = c.cardText
      .split(/·|⋅/)
      .map((p) => p.trim())
      .filter(Boolean);
    const hasSep = parts.length > 1;
    const category = hasSep
      ? parts.find((p) => p.length < 40 && /[a-z]/i.test(p) && !/\d{3,}/.test(p) && p !== c.name && !/review|star|\$|open|clos/i.test(p))
      : undefined;
    const address = hasSep ? parts.find((p) => p.length < 80 && /\d/.test(p) && /[a-z]/i.test(p) && !/review|star/i.test(p)) : undefined;

    return { placeId, businessName: c.name, rating, reviewCount, category, address };
  }

  /** Wait for the place panel's h1 to render — domcontentloaded fires before Maps
   *  hydrates the detail pane. */
  private async waitForDetail(page: PwPage, signal: AbortSignal): Promise<void> {
    for (let i = 0; i < 12; i++) {
      if (signal.aborted) return;
      const ready = await page.evaluate(() => !!document.querySelector("h1")?.textContent?.trim());
      if (ready) return;
      await sleep(450, signal);
    }
  }

  /** Expand the weekly-hours accordion so the full schedule is in the DOM. Some
   *  listings only render the 7 day rows after "Show open hours for the week" is
   *  clicked. Best-effort and non-fatal — hours falls back to the summary line. */
  private async expandHours(page: PwPage, signal: AbortSignal): Promise<void> {
    try {
      const clicked = await page.evaluate(() => {
        const main = (document.querySelector('div[role="main"]') as Element | null) ?? document.body;
        const btn = Array.from(main.querySelectorAll("[aria-label]")).find((e) =>
          /show open hours for the week|see more hours|hours for the week/i.test(e.getAttribute("aria-label") ?? ""),
        ) as HTMLElement | undefined;
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      if (clicked) await sleep(700, signal);
    } catch {
      /* non-fatal — the summary fallback still yields something */
    }
  }

  /** Phase 2: read raw detail strings off stable anchors (h1, data-item-id, aria). */
  private readDetail(page: PwPage): Promise<DetailRaw> {
    return page.evaluate((s) => {
      const q = (sel: string) => document.querySelector(sel);
      const clip = (v: string | null | undefined): string | null => (v ? v.replace(/\s+/g, " ").trim() : null);
      const main = (q('div[role="main"]') as Element | null) ?? document.body;

      // Rating + reviews from standalone aria-labels ("5.0 stars", "41 reviews").
      let ratingAria: string | null = null;
      let reviewsAria: string | null = null;
      for (const el of Array.from(main.querySelectorAll("[aria-label]"))) {
        const t = (el.getAttribute("aria-label") ?? "").trim();
        if (!ratingAria && /^[\d.]+\s*stars?$/i.test(t)) ratingAria = t;
        else if (!reviewsAria && /^\(?[\d,]+\)?\s*reviews?$/i.test(t)) reviewsAria = t;
        if (ratingAria && reviewsAria) break;
      }

      const phoneEl = q(s.phone);
      return {
        url: location.href,
        h1: clip(q(s.name)?.textContent),
        phoneAria: phoneEl?.getAttribute("aria-label") ?? null,
        phoneId: phoneEl?.getAttribute("data-item-id") ?? null,
        website: q(s.website)?.getAttribute("href") ?? null,
        addressAria: q(s.address)?.getAttribute("aria-label") ?? null,
        ratingAria,
        reviewsAria,
        hours: null, // filled by readFullHours after the core fields are safely read
        claimPresent: !!q(s.claimLink),
      };
    }, MAPS.detail);
  }

  /**
   * Read the FULL weekly hours as a "Day: hours" block. Runs AFTER the core
   * fields (expanding the hours accordion can swap the panel to an "Hours"
   * sub-view, which would clobber the name). Prefers the per-day buttons
   * ("Monday, 11 AM to 10 PM, Copy open hours"), then the 7-row table, then the
   * collapsed summary line. Returns null when no hours are shown.
   */
  private async readFullHours(page: PwPage, signal: AbortSignal): Promise<string | null> {
    await this.expandHours(page, signal);
    try {
      return await page.evaluate(() => {
        const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        const dayRe = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i;

        const week: Record<string, string> = {};
        for (const el of Array.from(document.querySelectorAll("[aria-label]"))) {
          const l = (el.getAttribute("aria-label") ?? "").replace(/,\s*Copy open hours\s*$/i, "").trim();
          const m = l.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*(.+)$/i);
          if (m && (/\d/.test(m[2]!) || /closed/i.test(m[2]!))) {
            const day = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
            if (!week[day]) week[day] = m[2]!.trim();
          }
        }
        const listed = DAYS.filter((d) => week[d]);
        if (listed.length >= 2) return listed.map((d) => `${d}: ${week[d]}`).join("\n");

        for (const t of Array.from(document.querySelectorAll("table"))) {
          const rows = Array.from(t.querySelectorAll("tr"))
            .map((r) => (r.textContent ?? "").replace(/\s+/g, " ").trim())
            .filter((r) => dayRe.test(r))
            .map((r) => r.replace(dayRe, (d) => d + ": "));
          if (rows.length >= 2) return rows.join("\n");
        }

        for (const el of Array.from(document.querySelectorAll("[aria-label]"))) {
          const h = el.getAttribute("aria-label");
          if (
            h &&
            h.length < 220 &&
            /\d/.test(h) &&
            /(open|clos|a\.?m\.?\b|p\.?m\.?\b|24 hours|24\/7)/i.test(h) &&
            !/review|star|rating|photo|price/i.test(h)
          ) {
            return h.trim();
          }
        }
        return null;
      });
    } catch {
      return null;
    }
  }
}

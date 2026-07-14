/**
 * Playwright-backed PageReader for the site crawler. Reuses the stealth Chrome
 * infra (same launch shape as the Maps source) but paces gently rather than
 * humanly — this is the prospect's own site, not an anti-bot surface. One page
 * object is reused across reads; extraction runs in-page and returns plain
 * values (crawler logic stays in Node where it's testable).
 */

import { sleep } from "../scraper/human.ts";
import type { PageRead, PageReader } from "./crawler.ts";

// Minimal Playwright surface (declared locally, same pattern as google-source).
interface PwResponse {
  status(): number;
}
interface PwPage {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<PwResponse | null>;
  evaluate<R>(fn: () => R): Promise<R>;
  close(): Promise<void>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
}
interface PwBrowser {
  newContext(opts: Record<string, unknown>): Promise<PwContext>;
  close(): Promise<void>;
}

const PAGE_TIMEOUT_MS = 15_000;
const SETTLE_MS = 600; // let client-rendered sites hydrate before reading

export class PlaywrightPageReader implements PageReader {
  private browser: PwBrowser | null = null;
  private page: PwPage | null = null;

  constructor(private channel = "chrome") {}

  async open(): Promise<void> {
    const { chromium } = (await import("playwright-extra")) as unknown as {
      chromium: { use(p: unknown): void; launch(o: Record<string, unknown>): Promise<PwBrowser> };
    };
    const stealth = (await import("puppeteer-extra-plugin-stealth")) as unknown as { default: () => unknown };
    chromium.use(stealth.default());
    this.browser = await chromium.launch({ channel: this.channel, headless: false });
    const ctx = await this.browser.newContext({ locale: "en-US" });
    this.page = await ctx.newPage();
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }

  async read(url: string, signal: AbortSignal): Promise<PageRead | null> {
    if (!this.page || signal.aborted) return null;
    let status = 0;
    try {
      const res = await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
      status = res?.status() ?? 0;
      await sleep(SETTLE_MS, signal);
    } catch {
      return null; // unreachable page — the crawl just moves on
    }
    if (status >= 400) return { url, status, h2Count: 0, wordCount: 0, internalLinks: 0, externalLinks: 0, images: 0, imagesWithoutAlt: 0, hasCanonical: false, hasViewport: false, hasJsonLd: false, links: [] };

    try {
      const raw = await this.page.evaluate(() => {
        const q = (sel: string) => document.querySelector(sel);
        const meta = (name: string) =>
          (q(`meta[name="${name}"]`) as HTMLMetaElement | null)?.content ??
          (q(`meta[property="${name}"]`) as HTMLMetaElement | null)?.content ??
          undefined;
        const clip = (v: string | null | undefined) => (v ? v.replace(/\s+/g, " ").trim() : undefined);

        const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
        const links: string[] = [];
        let internalLinks = 0;
        let externalLinks = 0;
        for (const a of anchors) {
          const href = a.href;
          if (!/^https?:/.test(href)) continue;
          if (new URL(href).origin === location.origin) {
            internalLinks++;
            links.push(href);
          } else {
            externalLinks++;
          }
        }
        const images = Array.from(document.querySelectorAll("img"));
        return {
          url: location.href,
          title: clip(document.title),
          description: clip(meta("description")),
          h1: clip(q("h1")?.textContent),
          h2Count: document.querySelectorAll("h2").length,
          wordCount: (document.body?.innerText ?? "").trim().split(/\s+/).filter(Boolean).length,
          links,
          internalLinks,
          externalLinks,
          images: images.length,
          imagesWithoutAlt: images.filter((i) => !i.getAttribute("alt")?.trim()).length,
          hasCanonical: !!q('link[rel="canonical"]'),
          robotsMeta: clip(meta("robots")),
          hasViewport: !!q('meta[name="viewport"]'),
          hasJsonLd: !!q('script[type="application/ld+json"]'),
          ogTitle: clip(meta("og:title")),
          html: document.documentElement.outerHTML.slice(0, 120_000),
        };
      });
      return { ...raw, status };
    } catch {
      return null;
    }
  }
}

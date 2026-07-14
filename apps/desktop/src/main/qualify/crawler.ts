/**
 * Bounded same-origin site crawler → on-page SEO signals (§ qualification step
 * 2). "Full" crawl with hard safety caps: page count AND wall-clock, because a
 * calendar plugin can mint infinite URLs. The BFS + assembly logic is pure and
 * driven through a `PageReader`, so the whole thing tests without a browser;
 * the Playwright reader lives in page-reader.ts.
 *
 * Signals only, never bodies: each page contributes a ScanPage; the transient
 * HTML is used for tech detection and dropped.
 */

import type { ScanPage, ScanSite } from "@dinosales/types";

/** What one page read yields: the stored signals + crawl-only extras. */
export interface PageRead extends ScanPage {
  /** Absolute link hrefs found on the page (crawler filters to same-origin). */
  links: string[];
  /** Transient page HTML (capped) — used for tech detection, never stored. */
  html?: string;
}

export interface PageReader {
  read(url: string, signal: AbortSignal): Promise<PageRead | null>;
}

export interface CrawlOptions {
  reader: PageReader;
  startUrl: string;
  signal: AbortSignal;
  /** Hard page cap (the "bounded" in bounded-full). */
  maxPages?: number;
  /** Hard wall-clock cap in ms. */
  maxMs?: number;
  /** HEAD-ish probe for robots.txt / sitemap.xml — returns HTTP status or null. */
  probe?: (url: string) => Promise<number | null>;
  onProgress?: (done: number, queued: number, url: string) => void;
}

const DEFAULT_MAX_PAGES = 30;
const DEFAULT_MAX_MS = 120_000;

/** File-ish or non-page URLs a crawl should never enqueue. */
const SKIP_EXT = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|xml|txt|pdf|docx?|xlsx?|pptx?|zip|rar|mp[34]|webm|mov|avi|woff2?|ttf|eot)(\?|$)/i;

/** Normalize for dedup: drop hash + tracking params, keep real path/query. */
export function normalizeCrawlUrl(href: string, origin: string): string | null {
  try {
    const u = new URL(href, origin);
    if (u.origin !== origin) return null;
    if (!/^https?:$/.test(u.protocol)) return null;
    if (SKIP_EXT.test(u.pathname)) return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|mc_|_hs|ref)$/i.test(key) || /^utm_/i.test(key)) u.searchParams.delete(key);
    }
    return u.toString().replace(/\?$/, "");
  } catch {
    return null;
  }
}

/** Platform/stack fingerprints from page HTML + generator metas. One file to tune. */
export function detectTech(htmlSamples: string[], generators: string[]): string[] {
  const hay = htmlSamples.join("\n").toLowerCase();
  const gen = generators.join("\n").toLowerCase();
  const found = new Set<string>();
  const mark = (name: string, test: boolean) => test && found.add(name);

  mark("WordPress", /wp-content|wp-includes|wp-json/.test(hay) || gen.includes("wordpress"));
  mark("Elementor", hay.includes("elementor"));
  mark("Divi", /\bet_pb_|divi/.test(hay));
  mark("WooCommerce", hay.includes("woocommerce"));
  mark("Shopify", /cdn\.shopify|myshopify\.com/.test(hay) || gen.includes("shopify"));
  mark("Wix", /wixstatic\.com|wix\.com|wixsite/.test(hay) || gen.includes("wix"));
  mark("Squarespace", hay.includes("squarespace") || gen.includes("squarespace"));
  mark("GoDaddy Website Builder", /godaddysites|wsimg\.com/.test(hay) || gen.includes("go daddy") || gen.includes("godaddy"));
  mark("Weebly", hay.includes("weebly") || gen.includes("weebly"));
  mark("Duda", /dudaone|dmws\.|duda\.co/.test(hay) || gen.includes("duda"));
  mark("Webflow", hay.includes("webflow") || gen.includes("webflow"));
  mark("Next.js", /__next_data__|\/_next\//.test(hay) || gen.includes("next.js"));
  mark("React", /data-reactroot|__next_data__/.test(hay));
  mark("jQuery", hay.includes("jquery"));
  return [...found].sort();
}

/** Assemble URL-silo sections: first path segment → page count ("" = root). */
function buildSilo(urls: string[], origin: string): { section: string; pages: number }[] {
  const counts = new Map<string, number>();
  for (const url of urls) {
    let section = "/";
    try {
      const seg = new URL(url, origin).pathname.split("/").filter(Boolean)[0];
      if (seg) section = `/${seg}`;
    } catch {
      /* keep root */
    }
    counts.set(section, (counts.get(section) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([section, pages]) => ({ section, pages }))
    .sort((a, b) => b.pages - a.pages || a.section.localeCompare(b.section));
}

function siteWarnings(pages: ScanPage[], sitemapFound: boolean): string[] {
  const w: string[] = [];
  if (pages.length === 0) return ["no pages could be crawled"];
  const missingTitle = pages.filter((p) => !p.title).length;
  const missingDesc = pages.filter((p) => !p.description).length;
  const missingH1 = pages.filter((p) => !p.h1).length;
  const avgWords = pages.reduce((s, p) => s + p.wordCount, 0) / pages.length;
  if (!sitemapFound) w.push("no sitemap.xml");
  if (missingTitle > 0) w.push(`${missingTitle}/${pages.length} pages missing a <title>`);
  if (missingDesc > pages.length / 2) w.push(`${missingDesc}/${pages.length} pages missing a meta description`);
  if (missingH1 > pages.length / 2) w.push(`${missingH1}/${pages.length} pages missing an h1`);
  if (avgWords < 200) w.push(`thin content — avg ${Math.round(avgWords)} words/page`);
  if (!pages.some((p) => p.hasJsonLd)) w.push("no structured data (JSON-LD) anywhere");
  if (pages.some((p) => !p.hasViewport)) w.push("pages without a viewport meta (mobile)");
  return w;
}

export async function crawlSite(opts: CrawlOptions): Promise<ScanSite> {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const maxMs = opts.maxMs ?? DEFAULT_MAX_MS;
  const started = Date.now();

  let origin: string;
  let start: string;
  try {
    const u = new URL(opts.startUrl);
    origin = u.origin;
    start = normalizeCrawlUrl(opts.startUrl, origin) ?? origin + "/";
  } catch {
    return {
      origin: opts.startUrl,
      startUrl: opts.startUrl,
      pageCount: 0,
      crawledMs: 0,
      truncated: false,
      pages: [],
      silo: [],
      robotsTxtFound: false,
      sitemapFound: false,
      tech: [],
      warnings: [`website URL unparseable: ${opts.startUrl}`],
    };
  }

  const queue: string[] = [start];
  const seen = new Set<string>([start]);
  const pages: ScanPage[] = [];
  const htmlSamples: string[] = [];
  const generators: string[] = [];
  let truncated = false;

  while (queue.length > 0) {
    if (opts.signal.aborted) {
      truncated = true;
      break;
    }
    if (pages.length >= maxPages || Date.now() - started > maxMs) {
      truncated = true;
      break;
    }
    const url = queue.shift()!;
    const read = await opts.reader.read(url, opts.signal);
    if (!read) continue;

    const { links, html, ...page } = read;
    pages.push(page);
    // Keep tech-detection material small: a slice of the first few pages only.
    if (htmlSamples.length < 5 && html) htmlSamples.push(html.slice(0, 60_000));
    const genMatch = html?.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i)?.[1];
    if (genMatch) generators.push(genMatch);

    for (const href of links) {
      const normalized = normalizeCrawlUrl(href, origin);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        queue.push(normalized);
      }
    }
    opts.onProgress?.(pages.length, queue.length, url);
  }
  if (queue.length > 0) truncated = true;

  const [robotsStatus, sitemapStatus] = await Promise.all([
    opts.probe?.(origin + "/robots.txt") ?? Promise.resolve(null),
    opts.probe?.(origin + "/sitemap.xml") ?? Promise.resolve(null),
  ]);
  const robotsTxtFound = robotsStatus !== null && robotsStatus >= 200 && robotsStatus < 300;
  const sitemapFound = sitemapStatus !== null && sitemapStatus >= 200 && sitemapStatus < 300;

  return {
    origin,
    startUrl: start,
    pageCount: pages.length,
    crawledMs: Date.now() - started,
    truncated,
    pages,
    silo: buildSilo(pages.map((p) => p.url), origin),
    robotsTxtFound,
    sitemapFound,
    tech: detectTech(htmlSamples, generators),
    warnings: siteWarnings(pages, sitemapFound),
  };
}

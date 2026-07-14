/**
 * Qualification job pipeline — tested without any browser or network, the same
 * way pipeline.test.ts proves the scrape loop: every collaborator is a fake and
 * the assertions run against what the job WRITES (claim → collect → complete).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ListingAuditsCreate } from "@dinosales/agentx-client";
import type { QualificationScan, RawListing, ScanSite } from "@dinosales/types";
import { scoreBusinessHealth, scoreContent, scoreListing, scoreSeo, scoreUx } from "@dinosales/types";
import { parseUsAddress } from "../src/main/qualify/address.ts";
import {
  crawlSite,
  detectTech,
  normalizeCrawlUrl,
  parseRobotsTxt,
  parseSitemapXml,
  robotsAllows,
  type PageRead,
  type PageReader,
} from "../src/main/qualify/crawler.ts";
import { parseMozReport } from "../src/main/qualify/moz.ts";
import { QualifyRunner, serializeScan, type QualifyJobRow, type QualifyRunnerDeps } from "../src/main/qualify/job.ts";
import { ScrapeBlockedError } from "../src/main/scraper/types.ts";

const noLog = () => {};

// --- address --------------------------------------------------------------

test("parseUsAddress splits street/city/state/zip and tolerates noise", () => {
  assert.deepEqual(parseUsAddress("123 Main St, Los Angeles, CA 90012"), {
    street: "123 Main St",
    city: "Los Angeles",
    state: "CA",
    zip: "90012",
  });
  assert.deepEqual(parseUsAddress("Address: 500 W 2nd St Suite 4, Austin, TX 78701-1234, United States"), {
    street: "500 W 2nd St Suite 4",
    city: "Austin",
    state: "TX",
    zip: "78701",
  });
  assert.equal(parseUsAddress("Los Angeles, CA"), null); // no zip
  assert.equal(parseUsAddress("just a name 90012"), null); // no state / no city split
  assert.equal(parseUsAddress(undefined), null);
});

// --- crawler ----------------------------------------------------------------

function page(url: string, over: Partial<PageRead> = {}): PageRead {
  return {
    url,
    status: 200,
    title: `Title ${url}`,
    description: "desc",
    h1: "H1",
    h2Count: 2,
    wordCount: 400,
    internalLinks: 2,
    externalLinks: 1,
    images: 3,
    imagesWithoutAlt: 1,
    hasCanonical: true,
    hasViewport: true,
    hasJsonLd: true,
    links: [],
    ...over,
  };
}

function fakeReader(pages: Record<string, PageRead>): PageReader {
  return {
    read: (url) => Promise.resolve(pages[url] ?? null),
  };
}

test("normalizeCrawlUrl keeps same-origin pages, drops files/off-site/tracking", () => {
  const origin = "https://biz.example";
  assert.equal(normalizeCrawlUrl("https://biz.example/about#team", origin), "https://biz.example/about");
  assert.equal(normalizeCrawlUrl("https://biz.example/menu?utm_source=x&page=2", origin), "https://biz.example/menu?page=2");
  assert.equal(normalizeCrawlUrl("https://other.example/", origin), null);
  assert.equal(normalizeCrawlUrl("https://biz.example/logo.png", origin), null);
  assert.equal(normalizeCrawlUrl("mailto:hi@biz.example", origin), null);
});

test("crawlSite BFS: same-origin only, silo built, sitemap read", async () => {
  const root = "https://biz.example/";
  const pages: Record<string, PageRead> = {
    [root]: page(root, { links: ["https://biz.example/services/roofing", "https://biz.example/about", "https://other.example/x"] }),
    "https://biz.example/services/roofing": page("https://biz.example/services/roofing", {
      links: ["https://biz.example/services/gutters"],
    }),
    "https://biz.example/about": page("https://biz.example/about"),
    "https://biz.example/services/gutters": page("https://biz.example/services/gutters"),
  };
  const site = await crawlSite({
    reader: fakeReader(pages),
    startUrl: "https://biz.example",
    signal: new AbortController().signal,
    fetchText: async (url) =>
      url.endsWith("/sitemap.xml") ? "<urlset><url><loc>https://biz.example/about</loc></url></urlset>" : null,
  });
  assert.equal(site.pageCount, 4);
  assert.equal(site.truncated, false);
  assert.equal(site.sitemapFound, true);
  assert.equal(site.robotsTxtFound, false);
  const services = site.silo.find((s) => s.section === "/services");
  assert.equal(services?.pages, 2);
});

// --- robots.txt + sitemap (crawl like a search engine) -----------------------

test("parseRobotsTxt keeps only the * group's rules, sitemaps are global", () => {
  const rules = parseRobotsTxt(
    [
      "User-agent: Googlebot",
      "Disallow: /google-only/",
      "",
      "User-agent: *",
      "Disallow: /admin/ # comment",
      "Allow: /admin/public/",
      "",
      "Sitemap: https://biz.example/sitemap.xml",
    ].join("\n"),
  );
  assert.deepEqual(rules.disallow, ["/admin/"]);
  assert.deepEqual(rules.allow, ["/admin/public/"]);
  assert.deepEqual(rules.sitemaps, ["https://biz.example/sitemap.xml"]);
});

test("robotsAllows: longest match wins, wildcards and anchors work", () => {
  const rules = { disallow: ["/admin/", "/*.pdf$", "/search"], allow: ["/admin/public/"], sitemaps: [] };
  assert.equal(robotsAllows(rules, "/menu"), true);
  assert.equal(robotsAllows(rules, "/admin/settings"), false);
  assert.equal(robotsAllows(rules, "/admin/public/page"), true); // allow outranks by length
  assert.equal(robotsAllows(rules, "/files/doc.pdf"), false);
  assert.equal(robotsAllows(rules, "/search?q=x"), false);
});

test("crawlSite respects robots.txt and reports what it skipped", async () => {
  const root = "https://biz.example/";
  const pages: Record<string, PageRead> = {
    [root]: page(root, { links: ["https://biz.example/admin/panel", "https://biz.example/menu"] }),
    "https://biz.example/menu": page("https://biz.example/menu"),
    "https://biz.example/admin/panel": page("https://biz.example/admin/panel"),
  };
  const site = await crawlSite({
    reader: fakeReader(pages),
    startUrl: root,
    signal: new AbortController().signal,
    fetchText: async (url) => (url.endsWith("/robots.txt") ? "User-agent: *\nDisallow: /admin/" : null),
  });
  assert.equal(site.robotsTxtFound, true);
  assert.equal(site.pageCount, 2); // root + /menu — /admin/panel never fetched
  assert.ok(!site.pages.some((p) => p.url.includes("/admin/")));
  assert.ok(site.warnings.some((w) => w.includes("robots.txt")));
});

test("sitemap seeding crawls orphan pages nothing links to", async () => {
  const root = "https://biz.example/";
  const pages: Record<string, PageRead> = {
    [root]: page(root, { links: [] }), // no outbound links at all
    "https://biz.example/hidden-lp": page("https://biz.example/hidden-lp"),
  };
  const site = await crawlSite({
    reader: fakeReader(pages),
    startUrl: root,
    signal: new AbortController().signal,
    fetchText: async (url) =>
      url.endsWith("/sitemap.xml")
        ? "<urlset><url><loc> https://biz.example/hidden-lp </loc></url><url><loc>https://other.example/x</loc></url></urlset>"
        : null,
  });
  assert.equal(site.sitemapFound, true);
  assert.equal(site.pageCount, 2); // root + the orphan; off-site loc ignored
  assert.ok(site.pages.some((p) => p.url === "https://biz.example/hidden-lp"));
});

test("parseSitemapXml: sitemapindex yields children, urlset yields urls", () => {
  const index = parseSitemapXml('<sitemapindex><sitemap><loc>https://biz.example/pages.xml</loc></sitemap></sitemapindex>');
  assert.deepEqual(index.childSitemaps, ["https://biz.example/pages.xml"]);
  assert.deepEqual(index.urls, []);
  const urlset = parseSitemapXml("<urlset><url><loc>https://biz.example/a</loc></url></urlset>");
  assert.deepEqual(urlset.urls, ["https://biz.example/a"]);
});

test("crawlSite respects the page cap and reports truncation", async () => {
  const root = "https://biz.example/";
  const pages: Record<string, PageRead> = {
    [root]: page(root, { links: ["https://biz.example/a", "https://biz.example/b", "https://biz.example/c"] }),
    "https://biz.example/a": page("https://biz.example/a"),
    "https://biz.example/b": page("https://biz.example/b"),
    "https://biz.example/c": page("https://biz.example/c"),
  };
  const site = await crawlSite({
    reader: fakeReader(pages),
    startUrl: root,
    signal: new AbortController().signal,
    maxPages: 2,
  });
  assert.equal(site.pageCount, 2);
  assert.equal(site.truncated, true);
});

test("detectTech fingerprints platforms from html + generator", () => {
  const tech = detectTech(['<link href="/wp-content/themes/x.css"><script src="jquery.min.js"></script>'], ["WordPress 6.4"]);
  assert.ok(tech.includes("WordPress"));
  assert.ok(tech.includes("jQuery"));
  assert.ok(!tech.includes("Shopify"));
});

// --- moz parse ----------------------------------------------------------------

test("parseMozReport reads per-directory rows and prefers the percent score", () => {
  const parsed = parseMozReport({
    result: {
      report: {
        sources: [
          { source: "Google", status: "Correct" },
          { source: "Yelp", status: "Not Found" },
          { source: "Bing", status: "Incomplete" },
        ],
        percentCorrect: 33,
      },
    },
  });
  assert.ok(parsed);
  assert.equal(parsed.checked, 3);
  assert.equal(parsed.found, 2);
  assert.equal(parsed.score, 33);
});

test("parseMozReport derives a score when no percent is present, rejects junk", () => {
  const parsed = parseMozReport([
    { name: "Google", listingStatus: "correct" },
    { name: "Facebook", listingStatus: "correct" },
    { name: "Apple Maps", listingStatus: "not_found" },
  ]);
  assert.ok(parsed);
  assert.equal(parsed.score, 67); // (2 + 0×0.5) / 3
  assert.equal(parseMozReport({ hello: "world" }), null);
  assert.equal(parseMozReport(null), null);
});

// --- scan serialization ---------------------------------------------------

test("serializeScan trims crawl pages until the payload fits the cap", () => {
  const scan: QualificationScan = {
    version: 1,
    collectedAt: "2026-07-13T00:00:00.000Z",
    warnings: [],
    site: {
      origin: "https://biz.example",
      startUrl: "https://biz.example/",
      pageCount: 300,
      crawledMs: 1000,
      truncated: false,
      pages: Array.from({ length: 300 }, (_, i) => page(`https://biz.example/p${i}`, { title: "x".repeat(2000) })),
      silo: [],
      robotsTxtFound: true,
      sitemapFound: true,
      tech: [],
      warnings: [],
    },
  };
  const json = serializeScan(scan);
  assert.ok(json.length <= 350_000);
  const parsed = JSON.parse(json) as QualificationScan;
  assert.ok(parsed.site!.pages.length < 300);
  assert.equal(parsed.site!.truncated, true);
  assert.ok(parsed.warnings.includes("scan_json trimmed to fit size cap"));
  assert.equal(parsed.site!.pageCount, 300); // the true crawl count survives the trim
});

// --- deterministic scoring (step 4 — explainable, never AI-assigned) ---------

function fakeSite(over: Partial<ScanSite> = {}): ScanSite {
  return {
    origin: "https://biz.example",
    startUrl: "https://biz.example/",
    pageCount: 2,
    crawledMs: 100,
    truncated: false,
    pages: [page("https://biz.example/"), page("https://biz.example/about")],
    silo: [],
    robotsTxtFound: true,
    sitemapFound: true,
    tech: [],
    warnings: [],
    ...over,
  };
}

test("scoreSeo rewards full on-page coverage, penalizes the gaps with reasons", () => {
  const good = scoreSeo(fakeSite());
  assert.ok(good.score >= 85, `expected high, got ${good.score}`);

  const bad = scoreSeo(
    fakeSite({
      sitemapFound: false,
      robotsTxtFound: false,
      pages: [page("https://biz.example/", { title: undefined, description: undefined, h1: undefined, hasCanonical: false, hasJsonLd: false })],
    }),
  );
  assert.ok(bad.score <= 15, `expected low, got ${bad.score}`);
  assert.ok(bad.reasons.some((r) => r.includes("meta description")));
  assert.ok(bad.reasons.some((r) => r.includes("no structured data")));
});

test("scoreContent flags thin content; scoreUx flags broken/non-mobile pages", () => {
  const thin = scoreContent(fakeSite({ pages: [page("https://biz.example/", { wordCount: 24, images: 9, imagesWithoutAlt: 8, ogTitle: undefined })] }));
  assert.ok(thin.score < 45, `expected low content score, got ${thin.score}`);
  assert.ok(thin.reasons.some((r) => r.includes("avg 24 words")));

  const ux = scoreUx(
    fakeSite({
      pages: [page("https://biz.example/"), page("https://biz.example/broken", { status: 404, hasViewport: false })],
    }),
  );
  assert.ok(ux.reasons.some((r) => r.includes("broken")));
  assert.ok(ux.score < 90);
});

test("scoreListing passes Moz through; business health averages what exists", () => {
  const listing = scoreListing({ fetched: true, score: 26, directoriesChecked: 19, directoriesFound: 13 });
  assert.equal(listing?.score, 26);
  assert.ok(listing?.reasons.some((r) => r.includes("13/19")));
  assert.equal(scoreListing({ fetched: false }), null); // unknown ≠ zero

  const business = scoreBusinessHealth({ seo: 40, content: 20, listing: 26 });
  assert.equal(business?.score, 29);
  assert.equal(scoreBusinessHealth({}), null);
});

// --- the job ----------------------------------------------------------------

const LISTING: RawListing = {
  placeId: "/g/abc123",
  businessName: "Pizza Palace",
  website: "https://biz.example/",
  address: "123 Main St, Los Angeles, CA 90012",
  rating: 4.6,
  reviewCount: 41,
  claimed: false,
};

function jobRow(over: Partial<QualifyJobRow> = {}): QualifyJobRow {
  return {
    qualId: "q1",
    orgId: "org1",
    leadId: "l1",
    leadName: "Pizza Palace",
    website: "https://biz.example/",
    address: "123 Main St, Los Angeles, CA 90012",
    placeId: "/g/abc123",
    agencyRowId: "ag1",
    deviceRowId: "dev1",
    ...over,
  };
}

interface Recorded {
  claims: string[];
  completes: { qualId: string; result: { scan_json: string; page_count?: number; website_url?: string; collected_at: string } }[];
  fails: string[];
  audits: ListingAuditsCreate[];
  lookups: number;
  readersMade: number;
}

function makeDeps(over: Partial<QualifyRunnerDeps> = {}): { deps: QualifyRunnerDeps; rec: Recorded } {
  const rec: Recorded = { claims: [], completes: [], fails: [], audits: [], lookups: 0, readersMade: 0 };
  const root = "https://biz.example/";
  const sitePages: Record<string, PageRead> = {
    [root]: page(root, { links: ["https://biz.example/about"] }),
    "https://biz.example/about": page("https://biz.example/about"),
  };
  const deps: QualifyRunnerDeps = {
    claim: async (qualId) => {
      rec.claims.push(qualId);
      return { claimed: true };
    },
    complete: async (qualId, result) => {
      rec.completes.push({ qualId, result });
    },
    fail: async (qualId) => {
      rec.fails.push(qualId);
    },
    writeAudit: async (audit) => {
      rec.audits.push(audit);
    },
    lookupListing: async () => {
      rec.lookups++;
      return LISTING;
    },
    makeReader: async () => {
      rec.readersMade++;
      return { reader: fakeReader(sitePages), close: async () => {} };
    },
    runMoz: async () => ({
      reportId: "rep-123",
      submittedAt: "2026-07-13T00:00:00.000Z",
      raw: { sources: [{ source: "Google", status: "Correct" }, { source: "Yelp", status: "Not Found" }] },
      parsed: { directories: [{ source: "Google", status: "Correct" }, { source: "Yelp", status: "Not Found" }], checked: 2, found: 1, score: 50 },
    }),
    fetchText: async () => null,
    onLog: noLog,
    now: () => "2026-07-13T00:00:00.000Z",
    ...over,
  };
  return { deps, rec };
}

test("happy path: claim → collect (listing/crawl/moz) → collected payload", async () => {
  const { deps, rec } = makeDeps();
  const outcome = await new QualifyRunner(deps).run(jobRow(), new AbortController().signal);

  assert.equal(outcome.kind, "completed");
  assert.deepEqual(rec.claims, ["q1"]);
  assert.equal(rec.completes.length, 1);
  assert.equal(rec.fails.length, 0);

  const { result } = rec.completes[0]!;
  assert.equal(result.page_count, 2);
  assert.equal(result.website_url, "https://biz.example/");
  const scan = JSON.parse(result.scan_json) as QualificationScan;
  assert.equal(scan.version, 1);
  assert.equal(scan.listing?.businessName, "Pizza Palace");
  assert.equal(scan.site?.pageCount, 2);
  assert.equal(scan.moz?.score, 50);
  assert.equal(scan.moz?.reportId, "rep-123");

  // The Moz result also landed as a listing_audits row (enrichment schema).
  assert.equal(rec.audits.length, 1);
  const audit = rec.audits[0]!;
  assert.equal(audit.provider, "moz");
  assert.equal(audit.report_id, "rep-123");
  assert.equal(audit.score, 50);
  assert.equal(audit.lead, "l1");
});

test("lost claim: skips without collecting anything", async () => {
  const { deps, rec } = makeDeps({ claim: async () => ({ claimed: false, reason: "lost-race" }) });
  const outcome = await new QualifyRunner(deps).run(jobRow(), new AbortController().signal);
  assert.equal(outcome.kind, "lost-claim");
  assert.equal(rec.lookups, 0);
  assert.equal(rec.completes.length, 0);
  assert.equal(rec.fails.length, 0);
});

test("blocked during lookup: row failed, outcome carries the cool-down", async () => {
  const { deps, rec } = makeDeps({
    lookupListing: async () => {
      throw new ScrapeBlockedError("CAPTCHA", 60_000);
    },
  });
  const outcome = await new QualifyRunner(deps).run(jobRow(), new AbortController().signal);
  assert.equal(outcome.kind, "blocked");
  assert.equal(outcome.backoffMs, 60_000);
  assert.deepEqual(rec.fails, ["q1"]);
  assert.equal(rec.completes.length, 0);
});

test("no website: crawl skipped but the job still completes with the signal", async () => {
  const { deps, rec } = makeDeps({ lookupListing: async () => ({ ...LISTING, website: undefined }) });
  const outcome = await new QualifyRunner(deps).run(jobRow({ website: undefined }), new AbortController().signal);
  assert.equal(outcome.kind, "completed");
  assert.equal(rec.readersMade, 0);
  const scan = JSON.parse(rec.completes[0]!.result.scan_json) as QualificationScan;
  assert.equal(scan.site, undefined);
  assert.ok(scan.warnings.some((w) => w.includes("no website")));
  assert.equal(rec.completes[0]!.result.page_count, undefined);
});

test("degraded collection: failed lookup and Moz timeout still land collected", async () => {
  const { deps, rec } = makeDeps({
    lookupListing: async () => {
      throw new Error("detail pane never rendered");
    },
    runMoz: async () => ({ reportId: "rep-9", submittedAt: "2026-07-13T00:00:00.000Z", error: "timed out" }),
  });
  const outcome = await new QualifyRunner(deps).run(jobRow(), new AbortController().signal);
  assert.equal(outcome.kind, "completed");
  const scan = JSON.parse(rec.completes[0]!.result.scan_json) as QualificationScan;
  assert.equal(scan.listing, undefined);
  assert.ok(scan.warnings.some((w) => w.includes("listing re-scrape failed")));
  assert.equal(scan.moz?.fetched, false);
  assert.equal(scan.moz?.reportId, "rep-9");
  // reportId-only audit row is still written — the report is durable, re-fetchable.
  assert.equal(rec.audits.length, 1);
  assert.equal(rec.audits[0]!.report_id, "rep-9");
  assert.equal(rec.audits[0]!.score, undefined);
});

test("unparseable address: Moz skipped with a warning, job completes", async () => {
  let mozCalled = 0;
  const { deps, rec } = makeDeps({
    lookupListing: async () => ({ ...LISTING, address: "somewhere strange" }),
    runMoz: async () => {
      mozCalled++;
      return { submittedAt: "", error: "should not run" };
    },
  });
  const outcome = await new QualifyRunner(deps).run(jobRow({ address: undefined }), new AbortController().signal);
  assert.equal(outcome.kind, "completed");
  assert.equal(mozCalled, 0);
  const scan = JSON.parse(rec.completes[0]!.result.scan_json) as QualificationScan;
  assert.ok(scan.warnings.some((w) => w.includes("address not parseable")));
  assert.equal(rec.audits.length, 0);
});

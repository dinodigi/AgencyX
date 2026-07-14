/**
 * Shared domain vocabulary + the schema idioms every surface must agree on.
 * These encode decisions from agentx/SPIKE-RESULTS.md and the fit assessment —
 * change them only together with the AgentX schema (agentx/manifest.json).
 */

export const LEAD_STAGES = ["scraped", "qualified", "building", "proposed", "sold", "client"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const QUERY_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type QueryStatus = (typeof QUERY_STATUSES)[number];

export const REVIEW_BUCKETS = ["none", "low", "medium", "high"] as const;
export type ReviewBucket = (typeof REVIEW_BUCKETS)[number];

export const USER_ROLES = ["admin", "scraper", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

// ---------------------------------------------------------------------------
// Dedup keys — THE tenant-scoped uniqueness mechanism.
// AgentX `unique` is collection-wide, so per-org uniqueness is encoded in the
// key itself: `{orgId}:{...}`. A duplicate insert fails with
// 422 E_VALIDATION constraint:"unique" on `dedup_key` → treat as already-synced.
// ---------------------------------------------------------------------------

/** Lowercase, trim, collapse inner whitespace — so "Plumbers " === "plumbers". */
export function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Keep digits (and a leading extension dash form for ZIP+4 → base 5). */
export function normalizeZip(zip: string): string {
  const digits = zip.trim().replace(/[^\d]/g, "");
  return digits.slice(0, 5);
}

/** Per-agency lead identity: same business scraped by two orgs never collides. */
export function makeLeadDedupKey(orgId: string, placeId: string): string {
  return `${orgId}:${placeId.trim()}`;
}

/** Per-agency coverage identity for a keyword+ZIP search unit. */
export function makeQueryDedupKey(orgId: string, keyword: string, zip: string): string {
  return `${orgId}:${normalizeKeyword(keyword)}:${normalizeZip(zip)}`;
}

// ---------------------------------------------------------------------------
// Precomputed filter fields — the delivery API filters by equality only,
// so range/existence questions become write-time fields. Compute these at
// capture time (desktop) and on any enrichment write.
// ---------------------------------------------------------------------------

/** Thresholds are a product decision — tune here, then backfill. */
export function reviewBucket(reviewCount: number | undefined | null): ReviewBucket {
  if (!reviewCount || reviewCount <= 0) return "none";
  if (reviewCount < 10) return "low";
  if (reviewCount < 50) return "medium";
  return "high";
}

export function deriveHasWebsite(website: string | undefined | null): boolean {
  return typeof website === "string" && website.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Raw scrape capture shape (what the scraper engine emits per listing, before
// it is turned into an AgentX LeadsCreate by the sync layer).
// ---------------------------------------------------------------------------

export interface RawListing {
  placeId: string;
  businessName: string;
  phone?: string;
  website?: string;
  address?: string;
  hours?: string;
  category?: string;
  reviewCount?: number;
  rating?: number;
  claimed?: boolean;
  photoCount?: number;
  priceLevel?: string;
}

// ---------------------------------------------------------------------------
// Scrape target filter — the "who do we keep" rules a search carries. Shared so
// the desktop (which applies them while scraping) and the web (which sets them
// on a search_queries row) agree on the exact semantics. Applied AFTER phase-2
// extraction, before a listing becomes a lead.
// ---------------------------------------------------------------------------

export const TARGET_WEBSITE = ["any", "missing", "has"] as const;
export type TargetWebsite = (typeof TARGET_WEBSITE)[number];

export interface ScrapeFilter {
  /** "missing" = only businesses without a website (the classic agency target). */
  targetWebsite?: TargetWebsite;
  /** Keep only listings with at least this many reviews. */
  minReviews?: number;
  /** Keep only listings with at most this many reviews (target weak listings). */
  maxReviews?: number;
  /** Keep only listings rated at least this (0–5). */
  minRating?: number;
}

/** True when a scraped listing matches the search's target filter. */
export function passesFilter(listing: RawListing, f: ScrapeFilter | undefined | null): boolean {
  if (!f) return true;
  if (f.targetWebsite === "missing" && deriveHasWebsite(listing.website)) return false;
  if (f.targetWebsite === "has" && !deriveHasWebsite(listing.website)) return false;
  const reviews = listing.reviewCount ?? 0;
  if (typeof f.minReviews === "number" && reviews < f.minReviews) return false;
  if (typeof f.maxReviews === "number" && reviews > f.maxReviews) return false;
  if (typeof f.minRating === "number" && (listing.rating ?? 0) < f.minRating) return false;
  return true;
}

/** A short human description of a filter for run logs ("no website · ≤20 reviews"). */
export function describeFilter(f: ScrapeFilter | undefined | null): string {
  if (!f) return "no filter";
  const parts: string[] = [];
  if (f.targetWebsite === "missing") parts.push("no website");
  if (f.targetWebsite === "has") parts.push("has website");
  if (typeof f.minReviews === "number") parts.push(`≥${f.minReviews} reviews`);
  if (typeof f.maxReviews === "number") parts.push(`≤${f.maxReviews} reviews`);
  if (typeof f.minRating === "number") parts.push(`≥${f.minRating.toFixed(1)}★`);
  return parts.length ? parts.join(" · ") : "no filter";
}

/** Normalize raw search_queries fields into a ScrapeFilter (drops "any"/empty). */
export function toScrapeFilter(row: {
  target_website?: string | null;
  min_reviews?: number | null;
  max_reviews?: number | null;
  min_rating?: number | null;
}): ScrapeFilter {
  const f: ScrapeFilter = {};
  if (row.target_website === "missing" || row.target_website === "has") f.targetWebsite = row.target_website;
  if (typeof row.min_reviews === "number") f.minReviews = row.min_reviews;
  if (typeof row.max_reviews === "number") f.maxReviews = row.max_reviews;
  if (typeof row.min_rating === "number" && row.min_rating > 0) f.minRating = row.min_rating;
  return f;
}

// ---------------------------------------------------------------------------
// Automation speed — how aggressively the scraper paces itself. This is the
// anti-detection dial the operator controls per search. Presets map to concrete
// delay ranges (ms) the human-pacing helpers read; there is deliberately no
// "instant" — the safety model is built on looking like a person.
// ---------------------------------------------------------------------------

export const SCRAPE_SPEEDS = ["careful", "balanced", "fast"] as const;
export type ScrapeSpeed = (typeof SCRAPE_SPEEDS)[number];
export const DEFAULT_SPEED: ScrapeSpeed = "balanced";

export interface SpeedProfile {
  /** Pause between whole listings — the dominant human-pacing knob. */
  betweenListingsMs: readonly [number, number];
  /** Short settle after a navigation/action within a listing. */
  settleMs: readonly [number, number];
  /** Pause between feed scroll steps during discovery. */
  scrollPauseMs: readonly [number, number];
  /** Rough minutes to expect for ~50 leads at this speed (for UI estimates). */
  minsPer50: number;
}

export const SPEED_PROFILES: Record<ScrapeSpeed, SpeedProfile> = {
  careful: { betweenListingsMs: [8000, 20000], settleMs: [800, 2000], scrollPauseMs: [1400, 2800], minsPer50: 13 },
  balanced: { betweenListingsMs: [4000, 9000], settleMs: [500, 1400], scrollPauseMs: [900, 1700], minsPer50: 7 },
  fast: { betweenListingsMs: [2000, 4000], settleMs: [300, 900], scrollPauseMs: [500, 1100], minsPer50: 4 },
};

/** Coerce an unknown string (e.g. a search_queries.speed value) to a valid speed. */
export function toScrapeSpeed(raw: string | null | undefined): ScrapeSpeed {
  return (SCRAPE_SPEEDS as readonly string[]).includes(raw ?? "") ? (raw as ScrapeSpeed) : DEFAULT_SPEED;
}

export const SCRAPE_DETAIL_LEVELS = ["full", "preview"] as const;
export type ScrapeDetailLevel = (typeof SCRAPE_DETAIL_LEVELS)[number];
export const DEFAULT_DETAIL_LEVEL: ScrapeDetailLevel = "full";

// ---------------------------------------------------------------------------
// Qualification — the scraped→qualified deep-research phase. The desktop
// collects (deep re-scrape + site crawl + Moz audit) and writes `scan_json`;
// the web scores it and Claude writes the brief. This section is the shared
// contract for that JSON blob and the status vocabulary, so the desktop
// (writer) and the web (reader, Phase-4 scoring) can never drift.
// ---------------------------------------------------------------------------

export const QUALIFICATION_STATUSES = ["pending", "collecting", "collected", "scored", "briefed", "failed"] as const;
export type QualificationStatus = (typeof QUALIFICATION_STATUSES)[number];

/** 1:1 lead identity — one qualification row per lead per org. */
export function makeQualificationDedupKey(orgId: string, leadId: string): string {
  return `${orgId}:${leadId.trim()}`;
}

/** One crawled page's on-page SEO signals (no bodies stored — signals only). */
export interface ScanPage {
  url: string;
  status: number;
  title?: string;
  description?: string;
  h1?: string;
  h2Count: number;
  wordCount: number;
  internalLinks: number;
  externalLinks: number;
  images: number;
  imagesWithoutAlt: number;
  hasCanonical: boolean;
  robotsMeta?: string;
  hasViewport: boolean;
  hasJsonLd: boolean;
  ogTitle?: string;
}

/** Site-level crawl result: silo structure, tech fingerprint, warnings. */
export interface ScanSite {
  origin: string;
  startUrl: string;
  pageCount: number;
  crawledMs: number;
  /** True when the page/time cap cut the crawl short (or scan_json was trimmed to fit). */
  truncated: boolean;
  pages: ScanPage[];
  /** URL-silo sections: first path segment → number of pages under it. */
  silo: { section: string; pages: number }[];
  robotsTxtFound: boolean;
  sitemapFound: boolean;
  /** Detected platform/stack markers (WordPress, Shopify, Next.js, …). */
  tech: string[];
  warnings: string[];
}

/** One directory's result from the Moz audit — what that directory has on file. */
export interface MozDirectoryRow {
  source: string;
  status: string;
  businessName?: string;
  address?: string;
  phone?: string;
  rating?: number;
  reviewCount?: number;
  /** The directory's listing page, when Moz surfaced one. */
  url?: string;
}

/** Moz Local free-tool audit outcome (async sub-job; reportId is durable). */
export interface ScanMoz {
  reportId?: string;
  submittedAt?: string;
  /** True when the report JSON was captured; false = submitted but timed out (re-fetch later via reportId). */
  fetched: boolean;
  directoriesChecked?: number;
  directoriesFound?: number;
  /** 0–100 derived listing-health score, when computable. */
  score?: number;
  /** Per-directory results (also stored in listing_audits.directories_json). */
  directories?: MozDirectoryRow[];
  error?: string;
}

/** The `qualifications.scan_json` payload the desktop job assembles. */
export interface QualificationScan {
  version: 1;
  collectedAt: string;
  /** Deep listing re-scrape (fresh Maps detail read); absent when the lookup failed. */
  listing?: RawListing & { fetchedAt: string };
  /** Absent when the lead has no website (itself a scoring signal). */
  site?: ScanSite;
  /** Absent when no address could be parsed for the Moz form. */
  moz?: ScanMoz;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Lead cleanup — runs at qualify time, BEFORE collection, so the Moz form,
// the Maps lookup, and the crawl all get clean inputs. Deterministic fixes
// first (free); the AI pass (web-side, one call) only when the heuristics say
// the lead needs judgment a regex can't provide.
// ---------------------------------------------------------------------------

export interface UsAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

const COUNTRY_SUFFIX = /,?\s*(united states( of america)?|usa|us)\.?$/i;

/** Split "123 Main St, Los Angeles, CA 90012" into Moz-form fields; null when
 *  the pieces can't be recovered (callers then skip or repair the address). */
export function parseUsAddress(raw: string | null | undefined): UsAddress | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^Address:\s*/i, "").replace(COUNTRY_SUFFIX, "").trim();
  if (!cleaned) return null;
  const zipMatch = cleaned.match(/(\d{5})(?:-\d{4})?$/);
  if (!zipMatch) return null;
  const zip = zipMatch[1]!;
  const beforeZip = cleaned.slice(0, zipMatch.index).replace(/[,\s]+$/, "");
  const stateMatch = beforeZip.match(/(?:^|[,\s])([A-Za-z]{2})$/);
  if (!stateMatch) return null;
  const state = stateMatch[1]!.toUpperCase();
  const beforeState = beforeZip.slice(0, stateMatch.index).replace(/[,\s]+$/, "");
  const parts = beforeState.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const city = parts[parts.length - 1]!;
  const street = parts.slice(0, -1).join(", ");
  if (!street || !city) return null;
  return { street, city, state, zip };
}

/** Tracking params platforms staple onto outbound links (mirror of the scraper's list). */
const TRACKING_PARAM = /^(utm_|gclid$|fbclid$|mc_|_hs|yclid$|msclkid$|dclid$|igshid$|ref$|ref_src$|source$|y_source$)/i;

/** Strip tracking noise + hash from a URL; returns the input when unparseable. */
export function stripTrackingParams(url: string): string {
  try {
    const u = new URL(url.trim());
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
    }
    u.hash = "";
    return u.toString().replace(/\?$/, "");
  } catch {
    return url.trim();
  }
}

export interface LeadCleanupFields {
  business_name?: string;
  address?: string;
  phone?: string;
  category?: string;
  website?: string;
}

export interface CleanupResult {
  /** Only the fields that actually changed. */
  patch: LeadCleanupFields;
  /** Human-readable summary of what changed ("stripped emoji from name"). */
  changes: string[];
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The free pass: whitespace, emoji, phone formatting, URL tracking junk.
 *  Never touches meaning — anything requiring judgment goes to the AI pass. */
export function cleanLeadDeterministic(lead: LeadCleanupFields): CleanupResult {
  const patch: LeadCleanupFields = {};
  const changes: string[] = [];

  if (lead.business_name) {
    let name = collapse(lead.business_name);
    const deEmojied = name.replace(/[\p{Extended_Pictographic}️]/gu, "").replace(/\s+/g, " ").trim();
    if (deEmojied !== name && deEmojied.length > 0) {
      name = deEmojied;
      changes.push("stripped emoji from name");
    }
    if (name !== lead.business_name && name.length > 0) patch.business_name = name;
  }

  if (lead.phone) {
    const digits = lead.phone.replace(/[^\d]/g, "");
    const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (ten.length === 10) {
      const formatted = `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
      if (formatted !== lead.phone.trim()) {
        patch.phone = formatted;
        changes.push("normalized phone format");
      }
    }
  }

  if (lead.website) {
    const cleaned = stripTrackingParams(lead.website);
    if (cleaned !== lead.website) {
      patch.website = cleaned;
      changes.push("stripped tracking params from website");
    }
  }

  if (lead.address) {
    const cleaned = collapse(lead.address.replace(COUNTRY_SUFFIX, ""));
    if (cleaned !== lead.address && cleaned.length > 0) {
      patch.address = cleaned;
      changes.push("tidied address");
    }
  }

  if (lead.category) {
    const cleaned = collapse(lead.category);
    if (cleaned !== lead.category && cleaned.length > 0) patch.category = cleaned;
  }

  return { patch, changes };
}

/** Why (if at all) this lead needs the AI judgment pass. Empty = clean enough. */
export function leadNeedsAiCleanup(lead: LeadCleanupFields): string[] {
  const reasons: string[] = [];
  const name = lead.business_name ?? "";
  if (/\s[-–—|]\s|\(|@/.test(name)) reasons.push("name carries a branch/location suffix");
  if (/,\s*[A-Z]{2}\b/.test(name)) reasons.push("name contains a city/state tail");
  const words = name.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
  if (words.length >= 3 && words.every((w) => w === w.toUpperCase())) reasons.push("name is all-caps");
  if (words.length >= 2 && name === name.toLowerCase()) reasons.push("name is all-lowercase");
  if (!lead.address) reasons.push("address is missing");
  else if (!parseUsAddress(lead.address)) reasons.push("address doesn't parse into street/city/state/zip");
  if (!lead.category) reasons.push("category is missing");
  return reasons;
}

// ---------------------------------------------------------------------------
// Deterministic scoring (build-order step 4) — every sub-score is computed
// from concrete scan signals with human-readable reasons, so a score is always
// explainable ("why 42?"). The AI writes narrative ON TOP of these numbers;
// it never assigns them. Weights are product decisions — tune here.
// ---------------------------------------------------------------------------

export interface ScoreDetail {
  /** 0–100. */
  score: number;
  /** The concrete signals that produced the number, for display + the AI brief. */
  reasons: string[];
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
const pct = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

/** On-page/technical SEO health of the crawled site. */
export function scoreSeo(site: ScanSite): ScoreDetail {
  const pages = site.pages.filter((p) => p.status < 400);
  const n = pages.length;
  if (n === 0) return { score: 0, reasons: ["no crawlable pages"] };
  const reasons: string[] = [];
  const titles = pct(pages.filter((p) => p.title).length, n);
  const descs = pct(pages.filter((p) => p.description).length, n);
  const h1s = pct(pages.filter((p) => p.h1).length, n);
  const canonicals = pct(pages.filter((p) => p.hasCanonical).length, n);
  const jsonLd = site.pages.some((p) => p.hasJsonLd);

  reasons.push(`${Math.round(titles * 100)}% of pages have a <title>`);
  reasons.push(`${Math.round(descs * 100)}% have a meta description`);
  reasons.push(`${Math.round(h1s * 100)}% have an h1`);
  if (!jsonLd) reasons.push("no structured data (JSON-LD)");
  if (!site.sitemapFound) reasons.push("no sitemap.xml");
  if (!site.robotsTxtFound) reasons.push("no robots.txt");

  const score = titles * 20 + descs * 20 + h1s * 15 + canonicals * 10 + (jsonLd ? 15 : 0) + (site.sitemapFound ? 12 : 0) + (site.robotsTxtFound ? 8 : 0);
  return { score: clamp(score), reasons };
}

/** Content depth/quality signals of the crawled site. */
export function scoreContent(site: ScanSite): ScoreDetail {
  const pages = site.pages.filter((p) => p.status < 400);
  const n = pages.length;
  if (n === 0) return { score: 0, reasons: ["no crawlable pages"] };
  const reasons: string[] = [];
  const avgWords = pages.reduce((s, p) => s + p.wordCount, 0) / n;
  const thinRatio = pct(pages.filter((p) => p.wordCount < 150).length, n);
  const totalImages = pages.reduce((s, p) => s + p.images, 0);
  const missingAlt = pages.reduce((s, p) => s + p.imagesWithoutAlt, 0);
  const altCoverage = totalImages > 0 ? 1 - missingAlt / totalImages : 1;
  const ogCoverage = pct(pages.filter((p) => p.ogTitle).length, n);

  const wordScore = avgWords >= 800 ? 40 : avgWords >= 400 ? 30 : avgWords >= 200 ? 18 : 8;
  reasons.push(`avg ${Math.round(avgWords)} words/page`);
  if (thinRatio > 0) reasons.push(`${Math.round(thinRatio * 100)}% of pages are thin (<150 words)`);
  if (totalImages > 0) reasons.push(`${Math.round(altCoverage * 100)}% of images have alt text`);
  if (ogCoverage < 0.5) reasons.push("most pages missing Open Graph tags");

  const score = wordScore + (1 - thinRatio) * 25 + altCoverage * 20 + ogCoverage * 15;
  return { score: clamp(score), reasons };
}

/** UX/technical hygiene signals of the crawled site. */
export function scoreUx(site: ScanSite): ScoreDetail {
  const n = site.pages.length;
  if (n === 0) return { score: 0, reasons: ["no crawlable pages"] };
  const reasons: string[] = [];
  const ok = site.pages.filter((p) => p.status < 400);
  const brokenRatio = pct(n - ok.length, n);
  const viewport = pct(ok.filter((p) => p.hasViewport).length, Math.max(1, ok.length));
  const withH2 = pct(ok.filter((p) => p.h2Count > 0).length, Math.max(1, ok.length));
  const avgInternal = ok.length > 0 ? ok.reduce((s, p) => s + p.internalLinks, 0) / ok.length : 0;

  if (brokenRatio > 0) reasons.push(`${Math.round(brokenRatio * 100)}% of crawled pages are broken (4xx/5xx)`);
  reasons.push(`${Math.round(viewport * 100)}% mobile-ready (viewport meta)`);
  if (withH2 < 0.5) reasons.push("weak heading structure (few h2s)");
  reasons.push(`~${Math.round(avgInternal)} internal links/page`);

  const linkScore = avgInternal >= 5 ? 20 : avgInternal >= 2 ? 12 : 5;
  const score = viewport * 35 + (1 - brokenRatio) * 30 + withH2 * 15 + linkScore;
  return { score: clamp(score), reasons };
}

/** Listing health from the Moz audit (directory presence + NAP consistency). */
export function scoreListing(moz: ScanMoz): ScoreDetail | null {
  if (typeof moz.score === "number") {
    const reasons: string[] = [];
    if (typeof moz.directoriesChecked === "number" && typeof moz.directoriesFound === "number") {
      reasons.push(`listed on ${moz.directoriesFound}/${moz.directoriesChecked} directories`);
    }
    reasons.push(`Moz listing accuracy ${moz.score}/100`);
    return { score: clamp(moz.score), reasons };
  }
  return null; // audit not fetched — score unknown, not zero
}

/** The composite: mean of whichever sub-scores exist (absent ≠ zero). */
export function scoreBusinessHealth(sub: {
  seo?: number;
  content?: number;
  ux?: number;
  performance?: number;
  listing?: number;
}): ScoreDetail | null {
  const parts = Object.entries(sub).filter(([, v]) => typeof v === "number") as [string, number][];
  if (parts.length === 0) return null;
  const score = clamp(parts.reduce((s, [, v]) => s + v, 0) / parts.length);
  return { score, reasons: [`mean of ${parts.map(([k, v]) => `${k} ${Math.round(v)}`).join(" · ")}`] };
}

// ---------------------------------------------------------------------------
// The AI brief (build-order step 6) — brief_json contract, shaped by the
// AgencyOS artifact's proven plan sections (seo / brand / proposal).
// ---------------------------------------------------------------------------

export interface QualificationBrief {
  seo: {
    executiveSummary: string;
    audit: { strengths: string[]; weaknesses: string[]; technicalIssues: string[] };
    keywordStrategy: string[];
    siloRecommendation: string[];
    roadmap: string[];
  };
  brand: {
    essence: string;
    voice: string;
    visualDirection: string;
    verifiedFacts: string[];
  };
  proposal: {
    executiveSummary: string;
    scope: string[];
    outcomes: string[];
    recommendedPackages: string[];
  };
}

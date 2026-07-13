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
}

/** True when a scraped listing matches the search's target filter. */
export function passesFilter(listing: RawListing, f: ScrapeFilter | undefined | null): boolean {
  if (!f) return true;
  if (f.targetWebsite === "missing" && deriveHasWebsite(listing.website)) return false;
  if (f.targetWebsite === "has" && !deriveHasWebsite(listing.website)) return false;
  const reviews = listing.reviewCount ?? 0;
  if (typeof f.minReviews === "number" && reviews < f.minReviews) return false;
  if (typeof f.maxReviews === "number" && reviews > f.maxReviews) return false;
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
  return parts.length ? parts.join(" · ") : "no filter";
}

/** Normalize raw search_queries fields into a ScrapeFilter (drops "any"/empty). */
export function toScrapeFilter(row: {
  target_website?: string | null;
  min_reviews?: number | null;
  max_reviews?: number | null;
}): ScrapeFilter {
  const f: ScrapeFilter = {};
  if (row.target_website === "missing" || row.target_website === "has") f.targetWebsite = row.target_website;
  if (typeof row.min_reviews === "number") f.minReviews = row.min_reviews;
  if (typeof row.max_reviews === "number") f.maxReviews = row.max_reviews;
  return f;
}

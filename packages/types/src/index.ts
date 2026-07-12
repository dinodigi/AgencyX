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

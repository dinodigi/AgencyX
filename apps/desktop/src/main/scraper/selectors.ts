/**
 * Centralized Google Maps anchors + parsers (§5.2). Google rotates CSS classes
 * constantly, so NOTHING here keys off a class name — every anchor is a stable
 * primitive verified on a fresh, anonymous session (2026-07-13 recon):
 *
 *   • the results feed is `div[role="feed"]`, each result an `a[href*="/maps/place/"]`
 *     whose `aria-label` IS the business name;
 *   • the place URL carries both ids — the `/g/…` Knowledge-Graph MID (`!16s`) and
 *     the CID hex pair (`!1s`); MID is preferred (most stable, matches Search);
 *   • detail reads off `h1`, `data-item-id` action buttons, and `aria-label`s
 *     ("4.6 stars", "41 reviews") — never the DUwDvf/F7nice/Nv2PK classes that drift.
 *
 * We stay on maps.google.com deliberately: a cold session hitting google.com/search
 * (`tbm=lcl`, the Knowledge Panel) trips the /sorry unusual-traffic block; Maps
 * tolerates the anonymous sessions our scraper actually runs.
 */

export const MAPS = {
  /** Maps search for a keyword near a ZIP (Maps tolerates cold sessions; Search doesn't). */
  searchUrl(keyword: string, zip: string): string {
    return `https://www.google.com/maps/search/${encodeURIComponent(`${keyword} near ${zip}`)}`;
  },

  /** The scrollable results list — role=feed is stable across redesigns. */
  resultsFeed: 'div[role="feed"]',
  /** Each result is an anchor to a place; its aria-label is the business name. */
  resultLink: 'a[href*="/maps/place/"]',
  /** CAPTCHA / unusual-traffic interstitial — triggers cool-down, never bypass. */
  captcha: 'iframe[src*="recaptcha"], form#captcha-form, div#recaptcha',

  /** Detail-panel anchors — all stable primitives (no class names). */
  detail: {
    name: "h1",
    phone: 'button[data-item-id^="phone:tel:"]',
    website: 'a[data-item-id="authority"]',
    address: 'button[data-item-id="address"]',
    /** Only present on UNCLAIMED listings — its absence = claimed. */
    claimLink: 'button[aria-label*="Claim this business" i], a[href*="/maps/business"]',
  },
} as const;

/**
 * Extract Google's stable ids from a Maps place URL. The `/g/…` MID lives in the
 * `!16s` param (URL-encoded `%2Fg%2F…`); the CID hex pair lives in `!1s`.
 * Returns both when present so callers can prefer the MID and fall back to CID.
 */
export function extractPlaceIds(url: string): { mid: string | null; cid: string | null } {
  let mid: string | null = null;
  const m = url.match(/!16s(%2[Ff]g%2[Ff][0-9a-z]+|\/g\/[0-9a-z]+)/i);
  if (m) {
    try {
      mid = decodeURIComponent(m[1]!);
    } catch {
      mid = m[1]!.replace(/%2[Ff]/gi, "/");
    }
  }
  const cid = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1] ?? null;
  return { mid, cid };
}

/** The stable identifier for a place: MID → CID → a name slug (last resort). */
export function bestPlaceId(url: string, name: string): string {
  const { mid, cid } = extractPlaceIds(url);
  return mid ?? cid ?? `name:${name.trim().toLowerCase().replace(/\s+/g, "-")}`;
}

/** "4.6 stars" (or "4.6 stars ") → 4.6, rejecting anything outside 0–5. */
export function parseStars(aria: string | null | undefined): number | undefined {
  const m = aria?.trim().match(/^([\d.]+)\s*stars?$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 0 && n <= 5 ? n : undefined;
}

/** "41 reviews" → 41. Anchored so it ignores histogram rows like "5 stars, 41 reviews". */
export function parseReviews(aria: string | null | undefined): number | undefined {
  const m = aria?.trim().match(/^\(?([\d,]+)\)?\s*reviews?$/i);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/** Clean a phone from either the "Phone: (213) 468-8333" aria-label or the
 *  "phone:tel:+12134688333" data-item-id. */
export function parsePhone(aria: string | null, itemId: string | null): string | undefined {
  const fromAria = aria?.replace(/^Phone:\s*/i, "").trim();
  if (fromAria) return fromAria;
  const fromId = itemId?.replace(/^phone:tel:/i, "").trim();
  return fromId || undefined;
}

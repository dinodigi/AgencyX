/**
 * Centralized Google Maps selectors (§5.2). Google's DOM changes often, so every
 * brittle anchor lives HERE — a break is a one-file fix, not a hunt across the
 * codebase. Prefer stable anchors (aria roles, data attributes) over CSS paths.
 *
 * These are STARTING POINTS to tune against real output (roadmap §12.5). They
 * are intentionally conservative and each has the reasoning noted. The engine
 * treats a miss on a required anchor as SelectorMiss (distinct from 0 results).
 */

export const MAPS = {
  /** Search results are served at this URL shape; keyword+zip are URL-encoded. */
  searchUrl(keyword: string, zip: string): string {
    const q = encodeURIComponent(`${keyword} ${zip}`);
    return `https://www.google.com/maps/search/${q}`;
  },

  /** The scrollable results feed (role=feed is stable across redesigns). */
  resultsFeed: 'div[role="feed"]',

  /** Each result card inside the feed. Cards are links to a place. */
  resultCard: 'div[role="feed"] > div > div[role="article"], a[href*="/maps/place/"]',

  /** "No results" sentinel — distinguishes an empty search from a selector break. */
  noResults: 'div.section-no-results, div[aria-label*="no results" i]',

  /** CAPTCHA / unusual-traffic interstitial — triggers cool-down, never bypass. */
  captcha: 'iframe[src*="recaptcha"], form#captcha-form, div#recaptcha',

  /** Detail panel (opened per card) — the source of rich fields. */
  detail: {
    panel: 'div[role="main"][aria-label]',
    name: 'h1',
    // Action/info buttons carry data-item-id — the most stable rich-field anchors.
    phone: 'button[data-item-id^="phone:"], button[aria-label^="Phone:" i]',
    website: 'a[data-item-id="authority"], a[aria-label^="Website:" i]',
    address: 'button[data-item-id="address"], button[aria-label^="Address:" i]',
    category: 'button[jsaction*="category"]',
    // Rating + review count sit in an aria-label like "4.6 stars 214 reviews".
    ratingBlock: 'div[role="img"][aria-label*="stars" i], span[aria-label*="stars" i]',
    hours: 'div[aria-label*="Hours" i], div[jsaction*="openhours"]',
    // "Claim this business" only shows on UNCLAIMED listings — its presence = unclaimed.
    claimLink: 'a[href*="/maps/business"], button[aria-label*="Claim this business" i]',
    priceLevel: 'span[aria-label*="Price:" i]',
    photoCountBtn: 'button[aria-label*="photo" i]',
  },
} as const;

/** Parse "4.6 stars 214 reviews" → {rating, reviewCount}. Tolerant of missing parts. */
export function parseRatingLabel(label: string | null | undefined): { rating?: number; reviewCount?: number } {
  if (!label) return {};
  const rating = label.match(/([\d.]+)\s*stars?/i);
  const reviews = label.match(/([\d,]+)\s*reviews?/i);
  return {
    rating: rating ? Number(rating[1]) : undefined,
    reviewCount: reviews ? Number(reviews[1]!.replace(/,/g, "")) : undefined,
  };
}

/** Extract Google's stable place id / CID from a maps place URL. */
export function placeIdFromUrl(url: string): string | null {
  // Modern place URLs embed a hex CID after "0x...:0x..." and/or a "!1s<ftid>" token.
  const ftid = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (ftid) return ftid[1]!;
  const cid = url.match(/[?&]cid=(\d+)/);
  if (cid) return cid[1]!;
  const dataHex = url.match(/(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  return dataHex ? dataHex[1]! : null;
}

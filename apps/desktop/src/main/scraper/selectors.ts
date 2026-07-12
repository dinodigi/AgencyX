/**
 * Centralized Google Maps selectors (§5.2). Google's DOM changes often, so every
 * brittle anchor lives HERE — a break is a one-file fix. Prefer stable anchors
 * (aria roles, data-item-id attributes) over CSS classes, which Google rotates.
 *
 * TUNE against real output (roadmap §12.5). The class names below (hfpxzc,
 * DUwDvf, F7nice) are Google's current ones and DO drift — when a field stops
 * extracting, update its line here.
 */

export const MAPS = {
  /** Search results are served at this URL shape; keyword+zip are URL-encoded. */
  searchUrl(keyword: string, zip: string): string {
    const q = encodeURIComponent(`${keyword} ${zip}`);
    return `https://www.google.com/maps/search/${q}`;
  },

  /** The scrollable results feed (role=feed is stable across redesigns). */
  resultsFeed: 'div[role="feed"]',

  /**
   * Each result is an <a> whose aria-label IS the business name and whose href
   * holds the place id. hfpxzc is Google's current card class; the href form is
   * the stable fallback.
   */
  resultCard: 'a.hfpxzc, div[role="feed"] a[href*="/maps/place/"]',

  /** "No results" sentinel — distinguishes an empty search from a selector break. */
  noResults: 'div.section-no-results, div[aria-label*="no results" i]',

  /** CAPTCHA / unusual-traffic interstitial — triggers cool-down, never bypass. */
  captcha: 'iframe[src*="recaptcha"], form#captcha-form, div#recaptcha',

  /** Detail panel (opened per card) — the source of rich fields. Scope to it so
   *  we never grab the feed's "Results" heading. */
  detail: {
    panel: 'div[role="main"]',
    // Business-name h1 in the detail panel (DUwDvf is the current class).
    name: 'div[role="main"] h1.DUwDvf, div[role="main"] h1',
    // Action buttons carry data-item-id — the most stable rich-field anchors.
    phone: 'button[data-item-id^="phone:tel:"], button[data-item-id^="phone:"]',
    website: 'a[data-item-id="authority"], a[aria-label^="Website:" i]',
    address: 'button[data-item-id="address"], button[aria-label^="Address:" i]',
    // Category sits in a button just under the name.
    category: 'button[jsaction*="category"], button.DkEaL',
    // Rating + review count live in .F7nice (aria-label like "4.7 stars 123 reviews").
    ratingBlock: 'div.F7nice, span[role="img"][aria-label*="stars" i]',
    // Hours: the open-hours block; full week is behind an aria-label on the toggle.
    hours: '[jsaction*="openhours"] [aria-label], div.t39EBf[aria-label], [aria-label*="Hours" i]',
    // "Claim this business" only shows on UNCLAIMED listings — its presence = unclaimed.
    claimLink: 'a[href*="/maps/business"], button[aria-label*="Claim this business" i]',
    priceLevel: 'span[aria-label*="Price:" i], span[aria-label*="Price per" i]',
    photoCountBtn: 'button[aria-label*="photo" i]',
  },
} as const;

/** Parse "4.6 stars 214 reviews" (aria-label) OR "4.6(214)" (F7nice text). */
export function parseRatingLabel(label: string | null | undefined): { rating?: number; reviewCount?: number } {
  if (!label) return {};
  const rating = label.match(/([\d.]+)\s*stars?/i) ?? label.match(/^\s*([\d.]+)/);
  const reviews = label.match(/([\d,]+)\s*reviews?/i) ?? label.match(/\(([\d,]+)\)/);
  return {
    rating: rating ? Number(rating[1]) : undefined,
    reviewCount: reviews ? Number(reviews[1]!.replace(/,/g, "")) : undefined,
  };
}

/** Extract Google's stable place id / CID from a maps place URL. */
export function placeIdFromUrl(url: string): string | null {
  const ftid = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (ftid) return ftid[1]!;
  const cid = url.match(/[?&]cid=(\d+)/);
  if (cid) return cid[1]!;
  const dataHex = url.match(/(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  return dataHex ? dataHex[1]! : null;
}

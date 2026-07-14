/**
 * US address splitter for the Moz Local form, which wants discrete
 * Company/Street/City/State/Zip fields while leads carry one comma-joined
 * string ("123 Main St, Los Angeles, CA 90012"). Pure + testable; returns null
 * when the pieces can't be recovered (the job then skips the Moz sub-job with
 * a warning instead of submitting garbage).
 */

export interface UsAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

const COUNTRY_SUFFIX = /,?\s*(united states( of america)?|usa|us)\.?$/i;

export function parseUsAddress(raw: string | null | undefined): UsAddress | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^Address:\s*/i, "").replace(COUNTRY_SUFFIX, "").trim();
  if (!cleaned) return null;

  // ZIP (5 or 5+4) anchored at the end; state is the 2-letter code before it.
  const zipMatch = cleaned.match(/(\d{5})(?:-\d{4})?$/);
  if (!zipMatch) return null;
  const zip = zipMatch[1]!;
  const beforeZip = cleaned.slice(0, zipMatch.index).replace(/[,\s]+$/, "");

  const stateMatch = beforeZip.match(/(?:^|[,\s])([A-Za-z]{2})$/);
  if (!stateMatch) return null;
  const state = stateMatch[1]!.toUpperCase();
  const beforeState = beforeZip.slice(0, stateMatch.index).replace(/[,\s]+$/, "");

  // Whatever remains splits on commas: last segment = city, the rest = street.
  const parts = beforeState.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const city = parts[parts.length - 1]!;
  const street = parts.slice(0, -1).join(", ");
  if (!street || !city) return null;

  return { street, city, state, zip };
}

/**
 * Catalog vocabulary — the shapes and helpers for services, the reusable
 * microservice library, and packages. AgentX has no list/JSON field, so a
 * package's chosen microservices and its highlight points are stored as JSON in
 * text fields (`items`, `highlights`); these helpers are the only place that
 * (de)serializes them, so the format stays consistent across the editor and the
 * future proposal renderer.
 */

export const BILLINGS = ["one_time", "monthly", "quarterly", "annual"] as const;
export type Billing = (typeof BILLINGS)[number];

export const BILLING_LABEL: Record<Billing, string> = {
  one_time: "One-time",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

/** Short price suffix shown after the amount ("$1,500/mo"). */
export const BILLING_SUFFIX: Record<Billing, string> = {
  one_time: "",
  monthly: "/mo",
  quarterly: "/qtr",
  annual: "/yr",
};

export const CURRENCIES = ["usd", "eur", "gbp"] as const;
export type Currency = (typeof CURRENCIES)[number];

const CURRENCY_CODE: Record<Currency, string> = { usd: "USD", eur: "EUR", gbp: "GBP" };

export const SERVICE_CATEGORIES = ["web", "seo", "ads", "social", "branding", "content", "other"] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ServiceCategory, string> = {
  web: "Web",
  seo: "SEO",
  ads: "Paid ads",
  social: "Social",
  branding: "Branding",
  content: "Content",
  other: "Other",
};

/** A package's reference to a library microservice, with optional per-package tweaks. */
export interface PackageItemRef {
  /** microservices row id */
  id: string;
  /** Overrides the library note for this package only. */
  note?: string;
  qty?: number;
  /** false renders as a greyed "not included" row (tier comparison). Default true. */
  included?: boolean;
}

export function parseItems(json: string | null | undefined): PackageItemRef[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v.filter((x) => x && typeof x.id === "string") as PackageItemRef[]) : [];
  } catch {
    return [];
  }
}

export function parseHighlights(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export const serializeItems = (items: PackageItemRef[]): string => JSON.stringify(items);
export const serializeHighlights = (hl: string[]): string => JSON.stringify(hl.map((s) => s.trim()).filter(Boolean));

export function formatPrice(price: number | null | undefined, currency: string | null | undefined): string {
  const code = CURRENCY_CODE[(currency ?? "usd") as Currency] ?? "USD";
  const n = typeof price === "number" ? price : 0;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${n.toLocaleString()}`;
  }
}

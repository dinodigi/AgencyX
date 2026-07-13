/**
 * Search-form vocabulary + normalization, shared by the web app (server action)
 * and the desktop renderer (IPC). Pure — no React, no framework imports — so the
 * server action can pull `normalizeSearch` without dragging in the component.
 *
 * The form is one concept with two modes: "single" is a batch of one. Both modes
 * feed `normalizeSearch`, which produces the keyword × ZIP unit list + the target
 * filter + pacing every caller agrees on.
 */

import {
  SPEED_PROFILES,
  DEFAULT_SPEED,
  DEFAULT_DETAIL_LEVEL,
  normalizeKeyword,
  normalizeZip,
  type ScrapeSpeed,
  type ScrapeDetailLevel,
  type TargetWebsite,
} from "@dinosales/types";

export type SearchMode = "single" | "batch";
/** What to do when a keyword × ZIP unit was already scraped. */
export type RecoverageMode = "skip" | "requeue";

export interface SearchFormValues {
  mode: SearchMode;
  /** Newline/comma separated in batch mode; a single line in single mode. */
  keywords: string;
  zips: string;
  maxLeads: number;
  detailLevel: ScrapeDetailLevel;
  targetWebsite: TargetWebsite;
  /** Kept as strings so an empty field is "unset", not 0. */
  minReviews: string;
  maxReviews: string;
  minRating: string;
  speed: ScrapeSpeed;
  recoverage: RecoverageMode;
}

export const DEFAULT_SEARCH_VALUES: SearchFormValues = {
  mode: "batch",
  keywords: "",
  zips: "",
  maxLeads: 50,
  detailLevel: DEFAULT_DETAIL_LEVEL,
  targetWebsite: "missing",
  minReviews: "",
  maxReviews: "",
  minRating: "",
  speed: DEFAULT_SPEED,
  recoverage: "skip",
};

/** The target filter as it lands on a search_queries row (snake_case fields). */
export interface SearchFilterRow {
  target_website: TargetWebsite;
  min_reviews?: number;
  max_reviews?: number;
  min_rating?: number;
}

export interface NormalizedSearch {
  keywords: string[];
  zips: string[];
  units: number;
  maxLeads: number;
  detailLevel: ScrapeDetailLevel;
  speed: ScrapeSpeed;
  recoverage: RecoverageMode;
  filter: SearchFilterRow;
}

function splitList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function numOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Turn raw form values into the deduped unit list + filter every caller uses. */
export function normalizeSearch(v: SearchFormValues): NormalizedSearch {
  const keywords = [...new Set(splitList(v.keywords).map(normalizeKeyword))];
  const zips = [...new Set(splitList(v.zips).map(normalizeZip))].filter((z) => z.length >= 3);
  const maxLeads = Math.max(1, Math.min(200, Math.round(v.maxLeads) || 50));
  const min_reviews = numOrUndef(v.minReviews);
  const max_reviews = numOrUndef(v.maxReviews);
  const min_rating = numOrUndef(v.minRating);
  return {
    keywords,
    zips,
    units: keywords.length * zips.length,
    maxLeads,
    detailLevel: v.detailLevel,
    speed: v.speed,
    recoverage: v.recoverage,
    filter: {
      target_website: v.targetWebsite,
      ...(min_reviews !== undefined ? { min_reviews } : {}),
      ...(max_reviews !== undefined ? { max_reviews } : {}),
      ...(min_rating !== undefined && min_rating > 0 ? { min_rating } : {}),
    },
  };
}

/** Rough wall-clock estimate for a batch, in minutes (for the UI preview line). */
export function estimateMinutes(units: number, maxLeads: number, speed: ScrapeSpeed, detailLevel: ScrapeDetailLevel): number {
  if (units <= 0) return 0;
  if (detailLevel === "preview") return units * 1.5; // discovery only — a page or two per unit
  return units * maxLeads * (SPEED_PROFILES[speed].minsPer50 / 50);
}

export function formatDuration(mins: number): string {
  if (mins <= 0) return "—";
  if (mins >= 90) return `${(mins / 60).toFixed(1)} h`;
  if (mins >= 1) return `${Math.round(mins)} min`;
  return "<1 min";
}

export const SPEED_LABELS: Record<ScrapeSpeed, { title: string; blurb: string; risk?: string }> = {
  careful: { title: "Careful", blurb: "Human dwell times, long rests", risk: undefined },
  balanced: { title: "Balanced", blurb: "Brisk but plausible" },
  fast: { title: "Fast", blurb: "Higher block odds, auto cool-down", risk: "riskier" },
};

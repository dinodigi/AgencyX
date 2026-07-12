/**
 * Scraper contracts. The engine is source-agnostic: it drives a `ScrapeSource`
 * that yields RawListings for a keyword+zip. Real scraping is GoogleMapsSource
 * (Playwright); MockSource yields deterministic listings so the whole pipeline
 * (claim → scrape → outbox → sync) is testable without touching Google.
 */

import type { RawListing } from "@dinosales/types";

export interface ScrapeQuery {
  keyword: string;
  zip: string;
}

export interface ScrapeSourceOptions {
  /** Hard cap on listings per run — the safety model depends on staying small (§5.1). */
  maxLeads: number;
  /** Cooperative cancellation from the UI / app shutdown. */
  signal: AbortSignal;
  /** Structured status lines for the live run log. */
  onLog: (level: "info" | "warn" | "error", message: string) => void;
}

/**
 * A source produces listings for one keyword+zip as an async stream, so the UI
 * updates and the outbox fills incrementally rather than all-at-once.
 */
export interface ScrapeSource {
  readonly name: string;
  open(): Promise<void>;
  search(query: ScrapeQuery, opts: ScrapeSourceOptions): AsyncIterable<RawListing>;
  close(): Promise<void>;
}

export type ScrapeOutcomeKind = "completed" | "zero-results" | "blocked" | "error" | "cancelled";

export interface ScrapeOutcome {
  kind: ScrapeOutcomeKind;
  captured: number;
  /** For 'blocked': how long the engine recommends pausing this device. */
  backoffMs?: number;
  message?: string;
}

/**
 * Raised by a source when it sees a CAPTCHA or an unusual anti-bot response.
 * The engine catches this, stops the run, and surfaces a cool-down rather than
 * hammering through (§5.5).
 */
export class ScrapeBlockedError extends Error {
  constructor(
    message: string,
    readonly backoffMs = 15 * 60 * 1000,
  ) {
    super(message);
    this.name = "ScrapeBlockedError";
  }
}

/** Raised when a selector that should match doesn't — logged distinctly from 0-results. */
export class SelectorMissError extends Error {
  constructor(
    readonly what: string,
    message: string,
  ) {
    super(message);
    this.name = "SelectorMissError";
  }
}

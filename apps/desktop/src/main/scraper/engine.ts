/**
 * Run engine. Drives a source through ONE keyword+zip, streaming each listing to
 * a callback, and resolves to a single ScrapeOutcome. It owns the safety
 * behavior: cap volume, translate a CAPTCHA into a cool-down (never bypass),
 * and keep "0 results" distinct from a broken selector or a block.
 */

import type { RawListing, SpeedProfile, ScrapeDetailLevel } from "@dinosales/types";
import { SPEED_PROFILES, DEFAULT_SPEED, DEFAULT_DETAIL_LEVEL } from "@dinosales/types";
import type { ScrapeSource, ScrapeQuery, ScrapeOutcome } from "./types.ts";
import { ScrapeBlockedError, SelectorMissError } from "./types.ts";

export interface EngineRunArgs {
  source: ScrapeSource;
  query: ScrapeQuery;
  maxLeads: number;
  signal: AbortSignal;
  onLog: (level: "info" | "warn" | "error", message: string) => void;
  /** Called per captured listing — the runner enqueues it to the outbox here. */
  onListing: (listing: RawListing) => Promise<void> | void;
  /** Human-pacing profile; defaults to balanced when omitted. */
  profile?: SpeedProfile;
  /** Discovery-only ("preview") vs open-each-listing ("full"). */
  detailLevel?: ScrapeDetailLevel;
}

export class ScraperEngine {
  async run({ source, query, maxLeads, signal, onLog, onListing, profile, detailLevel }: EngineRunArgs): Promise<ScrapeOutcome> {
    let captured = 0;
    try {
      await source.open();
      const opts = {
        maxLeads,
        signal,
        onLog,
        profile: profile ?? SPEED_PROFILES[DEFAULT_SPEED],
        detailLevel: detailLevel ?? DEFAULT_DETAIL_LEVEL,
      };
      for await (const listing of source.search(query, opts)) {
        if (signal.aborted) break;
        await onListing(listing);
        captured++;
        onLog("info", `captured ${captured}/${maxLeads}: ${listing.businessName}`);
      }
    } catch (err) {
      if (isAbort(err)) {
        onLog("warn", `run cancelled after ${captured} leads`);
        return { kind: "cancelled", captured };
      }
      if (err instanceof ScrapeBlockedError) {
        const mins = Math.round(err.backoffMs / 60000);
        onLog("error", `blocked (CAPTCHA/anti-bot) after ${captured} leads — cooling down ~${mins}m`);
        return { kind: "blocked", captured, backoffMs: err.backoffMs, message: err.message };
      }
      if (err instanceof SelectorMissError) {
        onLog("error", `selector miss on "${err.what}" — needs maintenance; captured ${captured}`);
        return { kind: "error", captured, message: err.message };
      }
      const message = err instanceof Error ? err.message : String(err);
      onLog("error", `run failed: ${message}`);
      return { kind: "error", captured, message };
    } finally {
      await safeClose(source, onLog);
    }

    if (captured === 0) return { kind: "zero-results", captured };
    return { kind: "completed", captured };
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.message === "Aborted");
}

async function safeClose(source: ScrapeSource, onLog: EngineRunArgs["onLog"]): Promise<void> {
  try {
    await source.close();
  } catch (err) {
    onLog("warn", `source close failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

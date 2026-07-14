/**
 * The typed contract between the Electron main process and the React renderer.
 * Renderer never touches Node, the network, SQLite, or tokens directly — it
 * calls these channels through the preload bridge (see src/preload). Keeping
 * this in one shared file is what stops the two processes from drifting.
 */

import type { LeadStage, QualificationStatus, QueryStatus, ScrapeFilter, ScrapeSpeed, ScrapeDetailLevel } from "@dinosales/types";

/** What the renderer is allowed to know about auth (never the raw token). */
export interface AuthState {
  status: "signed-out" | "signed-in";
  email?: string;
  orgId?: string;
  /** epoch ms of the current access token's expiry, for UI display only. */
  expiresAt?: number;
}

export interface SyncStats {
  pending: number;
  synced: number;
  failed: number;
  lastSyncAt?: number;
  online: boolean;
}

export interface QueueItem {
  id: string;
  keyword: string;
  zip: string;
  status: QueryStatus;
  lastScrapedAt?: string;
  resultCount?: number;
  speed?: ScrapeSpeed;
  detailLevel?: ScrapeDetailLevel;
  queuedAt?: string;
}

/** One row of the qualification queue (deep-research jobs for leads). */
export interface QualItem {
  id: string;
  leadName: string;
  status: QualificationStatus;
  websiteUrl?: string;
  pageCount?: number;
  collectedAt?: string;
}

/** Qualification run state — one collection job at a time, like scrape runs. */
export interface QualRunState {
  running: boolean;
  leadName?: string;
  lastOutcome?: string;
}

/** Desktop auto-run state — surfaced to the renderer for the on/off control. */
export interface AutoRunState {
  /** Operator toggle. Persisted. */
  enabled: boolean;
  /** True while paused by a cool-down (e.g. after a block), with when it lifts. */
  cooldownUntil?: number;
  /** Count of runs auto-started in the current rolling hour (activity budget). */
  ranThisHour: number;
  /** Human note on what the loop is doing right now. */
  status?: string;
}

/** A single line in the live run log the UI streams. */
export interface RunLogLine {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}

/** A lead as it's captured mid-scrape — streamed to the live table. */
export interface CapturedLead {
  at: number;
  placeId: string;
  businessName: string;
  address?: string;
  phone?: string;
  website?: string;
  hasWebsite: boolean;
  category?: string;
  reviewCount?: number;
  rating?: number;
  claimed?: boolean;
}

export interface RunState {
  running: boolean;
  keyword?: string;
  zip?: string;
  captured: number;
  /** Last finished run's outcome kind, for the UI. */
  lastOutcome?: string;
}

/** Local-first lead record as it sits in the SQLite outbox. */
export interface OutboxLead {
  localId: number;
  dedupKey: string;
  placeId: string;
  businessName: string;
  payloadJson: string;
  syncState: "pending" | "synced" | "failed";
  remoteId?: string;
  attempts: number;
  lastError?: string;
  createdAt: number;
}

/** Invoke channels: renderer → main, request/response. */
export interface IpcApi {
  "auth:getState": () => AuthState;
  // Set/refresh the signed-in session — called by the renderer's Clerk bridge
  // (real) or the dev paste-form. Called repeatedly to push refreshed tokens.
  "auth:setSession": (args: { email: string; orgId: string; token: string; expiresAt: number }) => AuthState;
  "auth:signOut": () => AuthState;

  "queue:list": () => QueueItem[];
  "queue:refresh": () => QueueItem[];

  "sync:getStats": () => SyncStats;
  "sync:flushNow": () => SyncStats;

  "device:getInfo": () => { deviceId: string; platform: string; appVersion: string };

  "run:start": (args: {
    keyword: string;
    zip: string;
    mock?: boolean;
    maxLeads?: number;
    filter?: ScrapeFilter;
    speed?: ScrapeSpeed;
    detailLevel?: ScrapeDetailLevel;
  }) => RunState;
  "run:claimNext": () => RunState;
  "run:stop": () => RunState;
  "run:getState": () => RunState;

  // Qualification jobs: list the queue, claim + run the next pending one.
  "qualify:list": () => QualItem[];
  "qualify:runNext": () => QualRunState;
  "qualify:stop": () => QualRunState;
  "qualify:getState": () => QualRunState;

  // Desktop auto-run: claim the next queued search whenever idle. On by default.
  "autorun:getState": () => AutoRunState;
  "autorun:setEnabled": (enabled: boolean) => AutoRunState;

  "update:check": () => { status: "checking" | "current" | "available" | "downloading" | "ready" | "error"; version?: string };
}

/** Event channels: main → renderer, fire-and-forget. */
export interface IpcEvents {
  "auth:changed": AuthState;
  "sync:changed": SyncStats;
  "queue:changed": QueueItem[];
  "run:changed": RunState;
  "qualify:changed": QualRunState;
  "qualify:queue": QualItem[];
  "autorun:changed": AutoRunState;
  "log:line": RunLogLine;
  "lead:captured": CapturedLead;
  "update:status": { status: string; version?: string; percent?: number };
}

export type IpcChannel = keyof IpcApi;
export type IpcEventChannel = keyof IpcEvents;

export const STAGE_INITIAL: LeadStage = "scraped";

/**
 * The typed contract between the Electron main process and the React renderer.
 * Renderer never touches Node, the network, SQLite, or tokens directly — it
 * calls these channels through the preload bridge (see src/preload). Keeping
 * this in one shared file is what stops the two processes from drifting.
 */

import type { LeadStage, QueryStatus } from "@dinosales/types";

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
}

/** A single line in the live run log the UI streams. */
export interface RunLogLine {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
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
  "auth:signIn": (args: { email: string; sessionToken: string; refreshToken?: string; orgId: string; expiresAt: number }) => AuthState;
  "auth:signOut": () => AuthState;

  "queue:list": () => QueueItem[];
  "queue:refresh": () => QueueItem[];

  "sync:getStats": () => SyncStats;
  "sync:flushNow": () => SyncStats;

  "device:getInfo": () => { deviceId: string; platform: string; appVersion: string };

  "update:check": () => { status: "checking" | "current" | "available" | "downloading" | "ready" | "error"; version?: string };
}

/** Event channels: main → renderer, fire-and-forget. */
export interface IpcEvents {
  "auth:changed": AuthState;
  "sync:changed": SyncStats;
  "queue:changed": QueueItem[];
  "log:line": RunLogLine;
  "update:status": { status: string; version?: string; percent?: number };
}

export type IpcChannel = keyof IpcApi;
export type IpcEventChannel = keyof IpcEvents;

export const STAGE_INITIAL: LeadStage = "scraped";

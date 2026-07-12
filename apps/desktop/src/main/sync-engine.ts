/**
 * Outbox drain worker. Posts un-synced leads to AgentX via the shared client's
 * syncLead() — which encodes the S1 spike contract: no delivery-API idempotency
 * exists, so a replayed/duplicate post is resolved through the unique dedup_key
 * (422 unique-conflict → fetch existing id → mark synced). Retries are always
 * safe. AgentX stays the source of truth; SQLite is the buffer.
 */

import type { LeadEngineClient, LeadsCreate } from "@dinosales/agentx-client";
import { isUniqueConflict } from "@dinosales/agentx-client";
import type { Outbox } from "./outbox.ts";
import type { SyncStats } from "../shared/ipc.ts";

export interface SyncEngineDeps {
  outbox: Outbox;
  getClient: () => LeadEngineClient | null;
  onStats: (stats: SyncStats) => void;
  onLog: (level: "info" | "warn" | "error", message: string) => void;
  batchSize?: number;
  intervalMs?: number;
}

export class SyncEngine {
  private deps: Required<SyncEngineDeps>;
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private online = true;
  private lastSyncAt: number | undefined;

  constructor(deps: SyncEngineDeps) {
    this.deps = { batchSize: 25, intervalMs: 8000, ...deps };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.drain(), this.deps.intervalMs);
    void this.drain();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  stats(): SyncStats {
    const s = this.deps.outbox.stats();
    return { ...s, online: this.online, lastSyncAt: this.lastSyncAt };
  }

  private emitStats(): void {
    this.deps.onStats(this.stats());
  }

  /** Force a drain now (UI "sync now" button / after a run completes). */
  async flushNow(): Promise<SyncStats> {
    await this.drain();
    return this.stats();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    const client = this.deps.getClient();
    if (!client) return; // signed out — nothing to do
    this.draining = true;
    try {
      const batch = this.deps.outbox.nextPending(this.deps.batchSize);
      if (batch.length === 0) return;

      for (const item of batch) {
        let lead: LeadsCreate;
        try {
          lead = JSON.parse(item.payloadJson) as LeadsCreate;
        } catch {
          this.deps.outbox.markFailed(item.localId, "corrupt payload_json");
          this.deps.onLog("error", `lead ${item.dedupKey}: corrupt local payload, will not retry`);
          continue;
        }

        try {
          const { id, alreadySynced } = await client.syncLead(lead);
          this.deps.outbox.markSynced(item.localId, id);
          this.online = true;
          this.lastSyncAt = Date.now();
          if (alreadySynced) {
            this.deps.onLog("info", `lead ${item.businessName} already on server (deduped)`);
          }
        } catch (err) {
          // A unique conflict is handled inside syncLead; reaching here is a real failure.
          if (isUniqueConflict(err)) {
            // Extremely unlikely (syncLead resolves it) — treat as synced-unknown-id.
            this.deps.outbox.markFailed(item.localId, "unique conflict unresolved");
            continue;
          }
          const msg = err instanceof Error ? err.message : String(err);
          const isNetwork = /fetch failed|ENOTFOUND|ECONNREFUSED|network|timeout/i.test(msg);
          this.online = !isNetwork;
          this.deps.outbox.markFailed(item.localId, msg);
          this.deps.onLog(isNetwork ? "warn" : "error", `sync ${item.businessName}: ${msg}`);
          if (isNetwork) break; // stop the batch; we're offline — try again next tick
        }
      }
    } finally {
      this.draining = false;
      this.emitStats();
    }
  }

  /** Call on reconnect / manual retry to give failed rows another chance. */
  requeueFailed(): void {
    const n = this.deps.outbox.requeueFailed();
    if (n > 0) this.deps.onLog("info", `requeued ${n} failed leads`);
    this.emitStats();
  }
}

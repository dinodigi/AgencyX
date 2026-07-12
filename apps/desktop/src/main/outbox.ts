/**
 * Local outbox (brief §7.1) — the offline safety-net. Scraped leads write here
 * FIRST, tagged with the device id, then a worker drains them to AgentX. AgentX
 * stays the source of truth; this is a durable buffer that survives crashes and
 * offline stretches.
 *
 * Two implementations behind one interface:
 *  - SqliteOutbox — durable, WAL-mode better-sqlite3 (the real one).
 *  - MemoryOutbox — in-process fallback so the app LAUNCHES and is testable on a
 *    machine without the C++ toolchain to build better-sqlite3. Non-durable:
 *    leads are lost on quit before they sync, so it warns loudly.
 * createOutbox() picks Sqlite and falls back to Memory.
 *
 * Local uniqueness on dedup_key means a device never queues the same business
 * twice in a run; cross-device/tenant dedup is AgentX's unique dedup_key.
 */

import type BetterSqlite3 from "better-sqlite3";
import type { OutboxLead } from "../shared/ipc.ts";

export interface NewLead {
  dedupKey: string;
  placeId: string;
  businessName: string;
  /** Full LeadsCreate payload, already org-stamped and bucketed, as JSON. */
  payloadJson: string;
}

export interface OutboxStore {
  enqueue(lead: NewLead, now: number): "queued" | "duplicate";
  nextPending(limit: number): OutboxLead[];
  markSynced(localId: number, remoteId: string): void;
  markFailed(localId: number, error: string): void;
  requeueFailed(): number;
  stats(): { pending: number; synced: number; failed: number };
  close(): void;
  readonly durable: boolean;
}

export class SqliteOutbox implements OutboxStore {
  readonly durable = true;
  private db: BetterSqlite3.Database;

  constructor(path: string) {
    // Lazy require so a missing/unbuilt native module fails HERE (caught by the
    // factory) instead of at import time, which would crash the whole app.
    const Database = require("better-sqlite3") as typeof BetterSqlite3;
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outbox_leads (
        local_id      INTEGER PRIMARY KEY AUTOINCREMENT,
        dedup_key     TEXT NOT NULL UNIQUE,
        place_id      TEXT NOT NULL,
        business_name TEXT NOT NULL,
        payload_json  TEXT NOT NULL,
        sync_state    TEXT NOT NULL DEFAULT 'pending',
        remote_id     TEXT,
        attempts      INTEGER NOT NULL DEFAULT 0,
        last_error    TEXT,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS outbox_state ON outbox_leads (sync_state);
    `);
  }

  enqueue(lead: NewLead, now: number): "queued" | "duplicate" {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO outbox_leads (dedup_key, place_id, business_name, payload_json, created_at)
         VALUES (@dedupKey, @placeId, @businessName, @payloadJson, @now)`,
      )
      .run({ ...lead, now });
    return res.changes > 0 ? "queued" : "duplicate";
  }

  nextPending(limit: number): OutboxLead[] {
    return this.db
      .prepare(
        `SELECT local_id AS localId, dedup_key AS dedupKey, place_id AS placeId,
                business_name AS businessName, payload_json AS payloadJson,
                sync_state AS syncState, remote_id AS remoteId, attempts,
                last_error AS lastError, created_at AS createdAt
         FROM outbox_leads WHERE sync_state != 'synced'
         ORDER BY created_at ASC LIMIT ?`,
      )
      .all(limit) as OutboxLead[];
  }

  markSynced(localId: number, remoteId: string): void {
    this.db
      .prepare(`UPDATE outbox_leads SET sync_state = 'synced', remote_id = ?, last_error = NULL WHERE local_id = ?`)
      .run(remoteId, localId);
  }

  markFailed(localId: number, error: string): void {
    this.db
      .prepare(`UPDATE outbox_leads SET sync_state = 'failed', attempts = attempts + 1, last_error = ? WHERE local_id = ?`)
      .run(error, localId);
  }

  requeueFailed(): number {
    return this.db.prepare(`UPDATE outbox_leads SET sync_state = 'pending' WHERE sync_state = 'failed'`).run().changes;
  }

  stats(): { pending: number; synced: number; failed: number } {
    const row = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN sync_state = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN sync_state = 'synced'  THEN 1 ELSE 0 END) AS synced,
           SUM(CASE WHEN sync_state = 'failed'  THEN 1 ELSE 0 END) AS failed
         FROM outbox_leads`,
      )
      .get() as { pending: number | null; synced: number | null; failed: number | null };
    return { pending: row.pending ?? 0, synced: row.synced ?? 0, failed: row.failed ?? 0 };
  }

  close(): void {
    this.db.close();
  }
}

interface MemRow extends OutboxLead {}

/** In-memory fallback — same behavior, no persistence. */
export class MemoryOutbox implements OutboxStore {
  readonly durable = false;
  private rows: MemRow[] = [];
  private seq = 0;
  private keys = new Set<string>();

  enqueue(lead: NewLead, now: number): "queued" | "duplicate" {
    if (this.keys.has(lead.dedupKey)) return "duplicate";
    this.keys.add(lead.dedupKey);
    this.rows.push({
      localId: ++this.seq,
      dedupKey: lead.dedupKey,
      placeId: lead.placeId,
      businessName: lead.businessName,
      payloadJson: lead.payloadJson,
      syncState: "pending",
      attempts: 0,
      createdAt: now,
    });
    return "queued";
  }

  nextPending(limit: number): OutboxLead[] {
    return this.rows
      .filter((r) => r.syncState !== "synced")
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  markSynced(localId: number, remoteId: string): void {
    const r = this.rows.find((x) => x.localId === localId);
    if (r) {
      r.syncState = "synced";
      r.remoteId = remoteId;
      r.lastError = undefined;
    }
  }

  markFailed(localId: number, error: string): void {
    const r = this.rows.find((x) => x.localId === localId);
    if (r) {
      r.syncState = "failed";
      r.attempts += 1;
      r.lastError = error;
    }
  }

  requeueFailed(): number {
    let n = 0;
    for (const r of this.rows) if (r.syncState === "failed") (r.syncState = "pending"), n++;
    return n;
  }

  stats(): { pending: number; synced: number; failed: number } {
    const s = { pending: 0, synced: 0, failed: 0 };
    for (const r of this.rows) s[r.syncState] += 1;
    return s;
  }

  close(): void {
    /* nothing to close */
  }
}

/** Build the durable outbox; fall back to in-memory (with a warning) if the
 *  native better-sqlite3 module isn't available (e.g. no C++ toolchain). */
export function createOutbox(path: string, onWarn: (msg: string) => void): OutboxStore {
  try {
    return new SqliteOutbox(path);
  } catch (err) {
    onWarn(
      `SQLite unavailable (${err instanceof Error ? err.message : String(err)}) — using a NON-durable in-memory outbox. ` +
        `Un-synced leads will be lost on quit. Rebuild native modules for persistence (see apps/desktop/README).`,
    );
    return new MemoryOutbox();
  }
}

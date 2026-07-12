/**
 * Local SQLite outbox (brief §7.1) — the offline safety-net. Scraped leads
 * write here FIRST, tagged with the device id, then a worker drains them to
 * AgentX. AgentX stays the source of truth; this is a durable buffer that
 * survives crashes and offline stretches.
 *
 * Uniqueness is enforced locally too (dedup_key UNIQUE) so a device never even
 * queues the same business twice within a run; cross-device/tenant dedup is
 * AgentX's unique dedup_key (see @dinosales/agentx-client syncLead).
 */

import Database from "better-sqlite3";
import type { OutboxLead } from "../shared/ipc.ts";

export interface NewLead {
  dedupKey: string;
  placeId: string;
  businessName: string;
  /** Full LeadsCreate payload, already org-stamped and bucketed, as JSON. */
  payloadJson: string;
}

export class Outbox {
  private db: Database.Database;

  constructor(path: string) {
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

  /** Enqueue a scraped lead. Idempotent locally: a repeat dedup_key is ignored. */
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
      .prepare(
        `UPDATE outbox_leads SET sync_state = 'failed', attempts = attempts + 1, last_error = ? WHERE local_id = ?`,
      )
      .run(error, localId);
  }

  /** Reset transient failures back to pending (e.g. after reconnect). */
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

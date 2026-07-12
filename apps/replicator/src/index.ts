/**
 * AgentX → Postgres replication worker (standing infra, roadmap Phase 0.4).
 *
 * Tails the FULL-TRUST MCP change feed (get_changes) into our own Postgres:
 *   - backup: entry export on the platform truncates at 5,000 rows; this doesn't
 *   - analytics: real SQL over jsonb instead of equality-only delivery filters
 *   - exit hatch: current state + full journal live on infra we control
 *
 * TRUST BOUNDARY: this service holds an MCP credential (full-trust, all
 * tenants). It runs ONLY on our own infra (Render worker) — never in a tenant
 * app. See README ground rule #1.
 *
 * Env: AGENTX_MCP_URL, AGENTX_MCP_TOKEN, DATABASE_URL, POLL_MS (default 5000)
 * Run: node --env-file=.env src/index.ts   (Node >= 23.6 for type stripping)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MCP_URL = process.env.AGENTX_MCP_URL ?? "https://pluggie.app/api/mcp";
const MCP_TOKEN = process.env.AGENTX_MCP_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const POLL_MS = Number(process.env.POLL_MS ?? 5000);
const PAGE_LIMIT = 500;

if (!MCP_TOKEN || !DATABASE_URL) {
  console.error("Missing AGENTX_MCP_TOKEN or DATABASE_URL");
  process.exit(1);
}

interface Change {
  cursor: string;
  collection: string;
  id: string;
  kind: "created" | "updated" | "deleted";
  at: string;
  changedFields?: string[];
  data?: Record<string, unknown>;
  prevData?: Record<string, unknown>;
}

interface ChangesPage {
  changes: Change[];
  cursor?: string;
  hasMore?: boolean;
}

let rpcId = 0;

async function mcpCall<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${MCP_TOKEN}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
  const rpc = (await res.json()) as {
    error?: { message?: string };
    result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  };
  if (rpc.error) throw new Error(`MCP error: ${rpc.error.message ?? "unknown"}`);
  const text = rpc.result?.content?.find((c) => c.type === "text")?.text ?? "";
  if (rpc.result?.isError) throw new Error(`tool error: ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function bootstrap(): Promise<void> {
  const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "schema.sql"), "utf8");
  await pool.query(sql);
}

async function loadCursor(): Promise<string | null> {
  const r = await pool.query("SELECT cursor FROM agentx_sync WHERE id = 1");
  return r.rows[0]?.cursor ?? null;
}

async function applyPage(page: ChangesPage): Promise<void> {
  if (page.changes.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const c of page.changes) {
      await client.query(
        `INSERT INTO agentx_changes (cursor, collection, entry_id, kind, at, changed, data, prev_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (cursor) DO NOTHING`,
        [c.cursor, c.collection, c.id, c.kind, c.at, c.changedFields ?? null, c.data ?? null, c.prevData ?? null],
      );
      if (c.kind === "deleted") {
        await client.query(
          `INSERT INTO agentx_entries (collection, entry_id, deleted, last_kind, last_at, updated_at)
           VALUES ($1, $2, true, 'deleted', $3, now())
           ON CONFLICT (collection, entry_id)
           DO UPDATE SET deleted = true, last_kind = 'deleted', last_at = $3, updated_at = now()`,
          [c.collection, c.id, c.at],
        );
      } else {
        await client.query(
          `INSERT INTO agentx_entries (collection, entry_id, data, deleted, last_kind, last_at, updated_at)
           VALUES ($1, $2, $3, false, $4, $5, now())
           ON CONFLICT (collection, entry_id)
           DO UPDATE SET data = $3, deleted = false, last_kind = $4, last_at = $5, updated_at = now()`,
          [c.collection, c.id, c.data ?? null, c.kind, c.at],
        );
      }
    }
    const last = page.changes[page.changes.length - 1];
    if (last) {
      await client.query("UPDATE agentx_sync SET cursor = $1, updated_at = now() WHERE id = 1", [last.cursor]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

async function main(): Promise<void> {
  await bootstrap();
  let cursor = await loadCursor();
  let backoffMs = 0;
  console.log(`replicator started — cursor: ${cursor ?? "(beginning)"}, poll ${POLL_MS}ms`);

  while (!stopping) {
    try {
      const args: Record<string, unknown> = { limit: PAGE_LIMIT };
      if (cursor) args.since = cursor;
      const page = await mcpCall<ChangesPage>("get_changes", args);
      await applyPage(page);
      if (page.changes.length > 0) {
        cursor = page.changes[page.changes.length - 1]!.cursor;
        console.log(`applied ${page.changes.length} changes → cursor ${cursor}`);
      }
      backoffMs = 0;
      if (!page.hasMore) await sleep(POLL_MS);
    } catch (err) {
      backoffMs = Math.min(backoffMs === 0 ? 2000 : backoffMs * 2, 60_000);
      console.error(`replication error (retry in ${backoffMs}ms):`, err instanceof Error ? err.message : err);
      await sleep(backoffMs);
    }
  }
  await pool.end();
  console.log("replicator stopped cleanly");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});

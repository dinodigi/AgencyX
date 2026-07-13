/**
 * Lead Engine client = generated AgentX delivery client + a thin hand-written
 * layer for the surfaces the generator does not cover (PATCH/DELETE, ?q=
 * search) and for the sync/claim protocols pinned down in
 * agentx/SPIKE-RESULTS.md. Regenerate ./generated.ts after ANY schema change
 * (get_client_code); keep this file stable.
 */

export * from "./generated.ts";

import {
  AgentXError,
  createClient,
  type AgentXClientOptions,
  type Leads,
  type LeadsCreate,
  type LeadsUpdate,
  type SearchQueries,
  type SearchQueriesUpdate,
  type DevicesUpdate,
} from "./generated.ts";

const DEFAULT_BASE_URL = "https://pluggie.app/api/v1";

export type CollectionName =
  | "agencies"
  | "users"
  | "devices"
  | "search_queries"
  | "leads"
  | "listing_audits";

export interface SyncResult {
  id: string;
  /** true = this lead already existed for the org (unique dedup_key) — retry or cross-device duplicate. */
  alreadySynced: boolean;
}

export interface ClaimResult {
  /** true = this device owns the query and should scrape it. */
  claimed: boolean;
  /** Why a claim was not obtained, when it wasn't. */
  reason?: "already-running" | "lost-race" | "not-pending";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** The 422 unique-constraint rejection that means "row already exists" (S1 spike contract). */
export function isUniqueConflict(err: unknown): err is AgentXError {
  return (
    err instanceof AgentXError &&
    err.status === 422 &&
    err.code === "E_VALIDATION" &&
    /already exists — this field is unique|already exists - this field is unique/.test(err.message)
  );
}

export function createLeadEngineClient(options: AgentXClientOptions) {
  const ax = createClient(options);
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  let userToken: string | null = options.userToken ?? null;

  function headers(withBody: boolean): Record<string, string> {
    const h: Record<string, string> = { authorization: "Bearer " + options.token };
    if (withBody) h["content-type"] = "application/json";
    if (userToken) h["x-user-token"] = userToken;
    return h;
  }

  async function raw<T>(method: string, path: string, query?: Record<string, unknown>, body?: unknown): Promise<T> {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), {
      method,
      headers: headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    if (!res.ok) throw new AgentXError(res.status, json?.error ?? "HTTP " + res.status, json?.code);
    return json as T;
  }

  return {
    /** The generated per-collection client (list/get/create + changes feed). */
    ax,

    /** Swap the end-user JWT after login/refresh/logout — affects BOTH layers. */
    setUserToken(t: string | null) {
      userToken = t;
      ax.setUserToken(t);
    },

    // -- generator gaps (PATCH/DELETE exist for owner/claim writers; the
    //    generator only emits create for our access shape) ------------------

    update<T = { id: string }>(collection: CollectionName, id: string, patch: Record<string, unknown>): Promise<T> {
      return raw<T>("PATCH", `/${collection}/${encodeURIComponent(id)}`, undefined, patch);
    },

    remove(collection: CollectionName, id: string): Promise<void> {
      return raw<void>("DELETE", `/${collection}/${encodeURIComponent(id)}`);
    },

    /** Full-text search over public searchable fields (rank-ordered, rate-limited). */
    async search<T>(collection: CollectionName, q: string, opts: { limit?: number; offset?: number } = {}): Promise<T[]> {
      const res = await raw<{ data: T[] }>("GET", `/${collection}`, { q, limit: opts.limit, offset: opts.offset });
      return res.data;
    },

    // -- outbox sync (S1 spike contract) ------------------------------------

    /**
     * Create a lead idempotently WITHOUT platform idempotency keys: a replayed
     * or cross-device duplicate hits the unique dedup_key and is resolved to
     * the existing row's id. Safe to call from a retry loop.
     */
    async syncLead(lead: LeadsCreate): Promise<SyncResult> {
      try {
        const { id } = await ax.leads.create(lead);
        return { id, alreadySynced: false };
      } catch (err) {
        if (!isUniqueConflict(err)) throw err;
        const existing = await ax.leads.list({ filter: { dedup_key: lead.dedup_key }, limit: 1 });
        const row = existing[0];
        if (!row) throw err; // conflict but not visible to us — surface the original error
        return { id: row.id, alreadySynced: true };
      }
    },

    // -- queue claim protocol v1 (S2 spike: same-state writes are silent
    //    no-ops, so the transition alone is NOT a lock; stamp + settle + verify)

    async claimQuery(queryId: string, deviceRowId: string, settleMs = 1200): Promise<ClaimResult> {
      const current = await ax.search_queries.get(queryId);
      if (current.status === "running") return { claimed: false, reason: "already-running" };
      if (current.status !== "pending") return { claimed: false, reason: "not-pending" };
      const patch: SearchQueriesUpdate = { status: "running", device: deviceRowId };
      try {
        await raw("PATCH", `/search_queries/${encodeURIComponent(queryId)}`, undefined, patch);
      } catch (err) {
        // Losing an illegal-move race (someone moved it off pending first) is a normal outcome.
        if (err instanceof AgentXError && err.code === "E_VALIDATION") return { claimed: false, reason: "lost-race" };
        throw err;
      }
      await sleep(settleMs);
      const settled = await ax.search_queries.get(queryId);
      const won = settled.status === "running" && settled.device?.id === deviceRowId;
      return won ? { claimed: true } : { claimed: false, reason: "lost-race" };
    },

    async completeQuery(queryId: string, resultCount: number, scrapedAtIso: string): Promise<void> {
      const patch: SearchQueriesUpdate = {
        status: "completed",
        result_count: resultCount,
        last_scraped_at: scrapedAtIso,
      };
      await raw("PATCH", `/search_queries/${encodeURIComponent(queryId)}`, undefined, patch);
    },

    async failQuery(queryId: string): Promise<void> {
      const patch: SearchQueriesUpdate = { status: "failed" };
      await raw("PATCH", `/search_queries/${encodeURIComponent(queryId)}`, undefined, patch);
    },

    // -- device presence -----------------------------------------------------

    /** Coarse heartbeat — piggyback on sync batches; never tighter than minutes (rate limits are undocumented). */
    async heartbeat(deviceRowId: string, appVersion: string, atIso: string): Promise<void> {
      const patch: DevicesUpdate = { last_seen: atIso, app_version: appVersion };
      await raw("PATCH", `/devices/${encodeURIComponent(deviceRowId)}`, undefined, patch);
    },

    // -- web-app helpers -----------------------------------------------------

    /**
     * Batch-builder upsert: create the keyword×zip row, or surface the existing
     * one (soft coverage — re-runs UPDATE the same row back to pending).
     */
    async upsertSearchQuery(row: {
      org_id: string;
      dedup_key: string;
      keyword: string;
      zip: string;
      max_leads?: number;
      target_website?: "any" | "missing" | "has";
      min_reviews?: number;
      max_reviews?: number;
      min_rating?: number;
      speed?: "careful" | "balanced" | "fast";
      detail_level?: "full" | "preview";
      user?: string;
      agency?: string;
      device?: string;
    }): Promise<SyncResult> {
      try {
        // queued_at drives FIFO claiming on the desktop ("Run next queued").
        const { id } = await ax.search_queries.create({ queued_at: new Date().toISOString(), ...row });
        return { id, alreadySynced: false };
      } catch (err) {
        if (!isUniqueConflict(err)) throw err;
        const existing = await ax.search_queries.list({ filter: { dedup_key: row.dedup_key }, limit: 1 });
        const found = existing[0];
        if (!found) throw err;
        return { id: found.id, alreadySynced: true };
      }
    },
  };
}

export type LeadEngineClient = ReturnType<typeof createLeadEngineClient>;
export type { Leads, LeadsCreate, LeadsUpdate, SearchQueries };

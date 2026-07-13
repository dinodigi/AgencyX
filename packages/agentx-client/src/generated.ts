/**
 * AgentX delivery-API client for "AgencyX" — GENERATED CODE.
 * Regenerate with the get_client_code MCP tool after any schema change;
 * do not edit by hand.
 *
 * Usage:
 *   const ax = createClient({ token: process.env.AGENTX_DELIVERY_TOKEN! });
 *   const rows = await ax.agencies.list();
 *
 * The token is a delivery-scoped project token — keep it server-side.
 * Collections with authenticated/owner access rules also need the signed-in
 * user's JWT: call ax.setUserToken(jwt) (sent as X-User-Token).
 * Errors throw AgentXError with the HTTP status, the server's message, and a
 * stable machine code (E_VALIDATION, E_AUTH, E_NOT_FOUND, E_RATE_LIMITED, …).
 */

const DEFAULT_BASE_URL = "https://pluggie.app/api/v1";

export interface AgentXClientOptions {
  /** Delivery API base; defaults to the deployment this client was generated from. */
  baseUrl?: string;
  /** Delivery-scoped project token (agx_...). */
  token: string;
  /** End-user JWT for authenticated/owner collections. */
  userToken?: string | null;
}

export class AgentXError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = "AgentXError";
  }
}

/** One change from the realtime feed. `data` holds only publicRead fields;
 *  kind:"deleted" carries no data. Treat an unknown id as an upsert. */
export interface ChangeEvent {
  cursor: string;
  collection: string;
  id: string;
  kind: "created" | "updated" | "deleted";
  at: string;
  changedFields?: string[];
  data?: Record<string, unknown>;
}

/** agencies — public view; only publicRead fields are ever returned. */
export interface Agencies {
  id: string;
  name: string;
  tier?: "starter" | "pro" | "enterprise";
  billing_email?: string;
}
export interface AgenciesListOpts {
  /** Equality filters on public fields. */
  filter?: {
    name?: string;
    tier?: "starter" | "pro" | "enterprise";
    billing_email?: string;
  };
  sort?: { field: "name" | "tier" | "billing_email"; dir: "asc" | "desc" };
  limit?: number;
  offset?: number;
}
/** agencies — write shape (relations/assets by id; "created_by" is stamped server-side). */
export interface AgenciesCreate {
  org_id: string;
  name: string;
  tier?: "starter" | "pro" | "enterprise";
  billing_email?: string;
  qualification_key_ref?: string;
}
export type AgenciesUpdate = Partial<AgenciesCreate>;

/** devices — public view; only publicRead fields are ever returned. */
export interface Devices {
  id: string;
  device_id: string;
  user?: { id: string; label: string };
  agency?: { id: string; label: string };
  platform?: "windows" | "mac";
  app_version?: string;
  last_seen?: string;
}
export interface DevicesListOpts {
  /** Equality filters on public fields. */
  filter?: {
    device_id?: string;
    user?: string;
    agency?: string;
    platform?: "windows" | "mac";
    app_version?: string;
    last_seen?: string;
  };
  sort?: { field: "device_id" | "user" | "agency" | "platform" | "app_version" | "last_seen"; dir: "asc" | "desc" };
  limit?: number;
  offset?: number;
}
/** devices — write shape (relations/assets by id; "created_by" is stamped server-side). */
export interface DevicesCreate {
  org_id: string;
  device_id: string;
  user?: string;
  agency?: string;
  platform?: "windows" | "mac";
  app_version?: string;
  last_seen?: string;
}
export type DevicesUpdate = Partial<DevicesCreate>;

/** leads — public view; only publicRead fields are ever returned. */
export interface Leads {
  id: string;
  dedup_key: string;
  place_id: string;
  business_name: string;
  phone?: string;
  website?: string;
  has_website?: boolean;
  address?: string;
  hours?: string;
  category?: string;
  review_count?: number;
  rating?: number;
  review_bucket?: "none" | "low" | "medium" | "high";
  claimed?: boolean;
  photo_count?: number;
  price_level?: string;
  stage?: "scraped" | "qualified" | "building" | "proposed" | "sold" | "client";
  listing_health_score?: number;
  qualification_score?: number;
  created_at?: string;
  search_query?: { id: string; label: string };
  agency?: { id: string; label: string };
  device?: { id: string; label: string };
}
export interface LeadsListOpts {
  /** Equality filters on public fields. */
  filter?: {
    dedup_key?: string;
    place_id?: string;
    business_name?: string;
    phone?: string;
    website?: string;
    has_website?: boolean;
    address?: string;
    hours?: string;
    category?: string;
    review_count?: number;
    rating?: number;
    review_bucket?: "none" | "low" | "medium" | "high";
    claimed?: boolean;
    photo_count?: number;
    price_level?: string;
    stage?: "scraped" | "qualified" | "building" | "proposed" | "sold" | "client";
    listing_health_score?: number;
    qualification_score?: number;
    created_at?: string;
    search_query?: string;
    agency?: string;
    device?: string;
  };
  sort?: { field: "dedup_key" | "place_id" | "business_name" | "phone" | "website" | "has_website" | "address" | "hours" | "category" | "review_count" | "rating" | "review_bucket" | "claimed" | "photo_count" | "price_level" | "stage" | "listing_health_score" | "qualification_score" | "created_at" | "search_query" | "agency" | "device"; dir: "asc" | "desc" };
  limit?: number;
  offset?: number;
}
/** leads — write shape (relations/assets by id; "created_by" is stamped server-side). */
export interface LeadsCreate {
  org_id: string;
  dedup_key: string;
  place_id: string;
  business_name: string;
  phone?: string;
  website?: string;
  has_website?: boolean;
  address?: string;
  hours?: string;
  category?: string;
  review_count?: number;
  rating?: number;
  review_bucket?: "none" | "low" | "medium" | "high";
  claimed?: boolean;
  photo_count?: number;
  price_level?: string;
  stage?: "scraped" | "qualified" | "building" | "proposed" | "sold" | "client";
  listing_health_score?: number;
  qualification_score?: number;
  created_at?: string;
  search_query?: string;
  agency?: string;
  device?: string;
}
export type LeadsUpdate = Partial<LeadsCreate>;

/** listing_audits — public view; only publicRead fields are ever returned. */
export interface ListingAudits {
  id: string;
  lead: { id: string; label: string };
  agency?: { id: string; label: string };
  provider?: "moz" | "brightlocal" | "other";
  directories_checked?: number;
  directories_found?: number;
  inconsistencies?: string;
  checked_at?: string;
}
export interface ListingAuditsListOpts {
  /** Equality filters on public fields. */
  filter?: {
    lead?: string;
    agency?: string;
    provider?: "moz" | "brightlocal" | "other";
    directories_checked?: number;
    directories_found?: number;
    checked_at?: string;
  };
  sort?: { field: "lead" | "agency" | "provider" | "directories_checked" | "directories_found" | "inconsistencies" | "checked_at"; dir: "asc" | "desc" };
  limit?: number;
  offset?: number;
}
/** listing_audits — write shape (relations/assets by id; "created_by" is stamped server-side). */
export interface ListingAuditsCreate {
  org_id: string;
  lead: string;
  agency?: string;
  provider?: "moz" | "brightlocal" | "other";
  directories_checked?: number;
  directories_found?: number;
  inconsistencies?: string;
  raw_result?: string;
  checked_at?: string;
}
export type ListingAuditsUpdate = Partial<ListingAuditsCreate>;

/** search_queries — public view; only publicRead fields are ever returned. */
export interface SearchQueries {
  id: string;
  dedup_key: string;
  keyword: string;
  zip: string;
  status?: "pending" | "running" | "completed" | "failed";
  queued_at?: string;
  last_scraped_at?: string;
  result_count?: number;
  max_leads?: number;
  target_website?: "any" | "missing" | "has";
  min_reviews?: number;
  max_reviews?: number;
  min_rating?: number;
  speed?: "careful" | "balanced" | "fast";
  detail_level?: "full" | "preview";
  user?: { id: string; label: string };
  agency?: { id: string; label: string };
  device?: { id: string; label: string };
}
export interface SearchQueriesListOpts {
  /** Equality filters on public fields. */
  filter?: {
    dedup_key?: string;
    keyword?: string;
    zip?: string;
    status?: "pending" | "running" | "completed" | "failed";
    queued_at?: string;
    last_scraped_at?: string;
    result_count?: number;
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
  };
  sort?: { field: "dedup_key" | "keyword" | "zip" | "status" | "queued_at" | "last_scraped_at" | "result_count" | "max_leads" | "target_website" | "min_reviews" | "max_reviews" | "min_rating" | "speed" | "detail_level" | "user" | "agency" | "device"; dir: "asc" | "desc" };
  limit?: number;
  offset?: number;
}
/** search_queries — write shape (relations/assets by id; "created_by" is stamped server-side). */
export interface SearchQueriesCreate {
  org_id: string;
  dedup_key: string;
  keyword: string;
  zip: string;
  status?: "pending" | "running" | "completed" | "failed";
  queued_at?: string;
  last_scraped_at?: string;
  result_count?: number;
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
}
export type SearchQueriesUpdate = Partial<SearchQueriesCreate>;

/** users — public view; only publicRead fields are ever returned. */
export interface Users {
  id: string;
  email: string;
  name?: string;
  role?: "admin" | "scraper" | "viewer";
  agency?: { id: string; label: string };
}
export interface UsersListOpts {
  /** Equality filters on public fields. */
  filter?: {
    email?: string;
    name?: string;
    role?: "admin" | "scraper" | "viewer";
    agency?: string;
  };
  sort?: { field: "email" | "name" | "role" | "agency"; dir: "asc" | "desc" };
  limit?: number;
  offset?: number;
}
/** users — write shape (relations/assets by id; "created_by" is stamped server-side). */
export interface UsersCreate {
  org_id: string;
  email: string;
  name?: string;
  role?: "admin" | "scraper" | "viewer";
  agency?: string;
}
export type UsersUpdate = Partial<UsersCreate>;

export function createClient(options: AgentXClientOptions) {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  let userToken = options.userToken ?? null;

  async function request<T>(
    method: string,
    path: string,
    query?: Record<string, unknown>,
    body?: unknown,
  ): Promise<T> {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { authorization: "Bearer " + options.token };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (userToken) headers["x-user-token"] = userToken;
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    if (!res.ok) throw new AgentXError(res.status, json?.error ?? "HTTP " + res.status, json?.code);
    return json as T;
  }

  function authHeaders(): Record<string, string> {
    const h: Record<string, string> = { authorization: "Bearer " + options.token };
    if (userToken) h["x-user-token"] = userToken;
    return h;
  }

  /** One page of the change feed. Persist `cursor` and pass it as `since` next
   *  time; `ifNoneMatch` (the previous ETag) yields notModified when idle. */
  async function pollChanges(opts: { since?: string; collections?: string[]; ifNoneMatch?: string } = {}) {
    const url = new URL(baseUrl + "/changes");
    if (opts.since) url.searchParams.set("since", opts.since);
    if (opts.collections?.length) url.searchParams.set("collections", opts.collections.join(","));
    const headers = authHeaders();
    if (opts.ifNoneMatch) headers["if-none-match"] = opts.ifNoneMatch;
    const res = await fetch(url.toString(), { headers });
    const etag = res.headers.get("etag") ?? undefined;
    if (res.status === 304) return { changes: [] as ChangeEvent[], cursor: opts.since ?? "", hasMore: false, notModified: true, etag };
    const json = (await res.json().catch(() => null)) as
      | { changes?: ChangeEvent[]; cursor?: string; hasMore?: boolean; error?: string; code?: string }
      | null;
    if (!res.ok) throw new AgentXError(res.status, json?.error ?? "HTTP " + res.status, json?.code);
    return { changes: json?.changes ?? [], cursor: json?.cursor ?? "", hasMore: Boolean(json?.hasMore), notModified: false, etag };
  }

  return {
    /** Swap the end-user JWT after login/logout. */
    setUserToken(t: string | null) {
      userToken = t;
    },

    /**
     * Realtime change feed (PULL, not push). `poll` fetches changes since a
     * cursor (persist it); `stream` consumes SSE with automatic ?since resume
     * across the bounded-lifetime reconnects and a poll fallback. RECONCILE: on a
     * gap, a whole-collection delete, or a field rename, do a full .list() — the
     * feed is near-exact, not guaranteed-complete. Treat an unknown id as upsert.
     */
    changes: {
      poll: pollChanges,
      /** Consume the SSE stream, invoking onChange per event. Returns a stop fn. */
      stream(onChange: (c: ChangeEvent) => void, opts: { since?: string; collections?: string[] } = {}): () => void {
        let cursor = opts.since;
        let stopped = false;
        (async () => {
          while (!stopped) {
            try {
              const url = new URL(baseUrl + "/changes/stream");
              if (cursor) url.searchParams.set("since", cursor);
              if (opts.collections?.length) url.searchParams.set("collections", opts.collections.join(","));
              const res = await fetch(url.toString(), { headers: authHeaders() });
              if (!res.ok || !res.body) throw new AgentXError(res.status, "stream failed");
              const reader = res.body.getReader();
              const dec = new TextDecoder();
              let buf = "";
              while (!stopped) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += dec.decode(value, { stream: true });
                let i: number;
                while ((i = buf.indexOf("\n\n")) >= 0) {
                  const frame = buf.slice(0, i);
                  buf = buf.slice(i + 2);
                  const id = /^id: (.+)$/m.exec(frame)?.[1];
                  const ev = /^event: (.+)$/m.exec(frame)?.[1];
                  const data = /^data: (.+)$/m.exec(frame)?.[1];
                  if (id) cursor = id;
                  if (ev === "change" && data) onChange(JSON.parse(data) as ChangeEvent);
                  else if (ev === "cursor" && data) cursor = (JSON.parse(data) as { cursor: string }).cursor;
                }
              }
            } catch {
              // Fall back to a poll (also advances the cursor), then reconnect.
              try {
                const p = await pollChanges({ since: cursor });
                for (const c of p.changes) onChange(c);
                if (p.cursor) cursor = p.cursor;
              } catch {
                /* keep trying */
              }
              await new Promise((r) => setTimeout(r, 2000));
            }
          }
        })();
        return () => {
          stopped = true;
        };
      },
    },
    agencies: { // requires setUserToken() for non-public access
      async list(opts: AgenciesListOpts = {}): Promise<Agencies[]> {
        const query: Record<string, unknown> = { limit: opts.limit, offset: opts.offset, ...(opts.filter ?? {}) };
        if (opts.sort) query.sort = opts.sort.field + ":" + opts.sort.dir;
        return (await request<{ data: Agencies[] }>("GET", "/agencies", query)).data;
      },
      async get(id: string): Promise<Agencies> {
        return (await request<{ data: Agencies }>("GET", "/agencies/" + encodeURIComponent(id))).data;
      },
      async create(data: AgenciesCreate): Promise<{ id: string }> {
        return request<{ id: string }>("POST", "/agencies", undefined, data);
      },
    },
    devices: { // requires setUserToken() for non-public access
      async list(opts: DevicesListOpts = {}): Promise<Devices[]> {
        const query: Record<string, unknown> = { limit: opts.limit, offset: opts.offset, ...(opts.filter ?? {}) };
        if (opts.sort) query.sort = opts.sort.field + ":" + opts.sort.dir;
        return (await request<{ data: Devices[] }>("GET", "/devices", query)).data;
      },
      async get(id: string): Promise<Devices> {
        return (await request<{ data: Devices }>("GET", "/devices/" + encodeURIComponent(id))).data;
      },
      async create(data: DevicesCreate): Promise<{ id: string }> {
        return request<{ id: string }>("POST", "/devices", undefined, data);
      },
    },
    leads: { // requires setUserToken() for non-public access
      async list(opts: LeadsListOpts = {}): Promise<Leads[]> {
        const query: Record<string, unknown> = { limit: opts.limit, offset: opts.offset, ...(opts.filter ?? {}) };
        if (opts.sort) query.sort = opts.sort.field + ":" + opts.sort.dir;
        return (await request<{ data: Leads[] }>("GET", "/leads", query)).data;
      },
      async get(id: string): Promise<Leads> {
        return (await request<{ data: Leads }>("GET", "/leads/" + encodeURIComponent(id))).data;
      },
      async create(data: LeadsCreate): Promise<{ id: string }> {
        return request<{ id: string }>("POST", "/leads", undefined, data);
      },
    },
    listing_audits: { // requires setUserToken() for non-public access
      async list(opts: ListingAuditsListOpts = {}): Promise<ListingAudits[]> {
        const query: Record<string, unknown> = { limit: opts.limit, offset: opts.offset, ...(opts.filter ?? {}) };
        if (opts.sort) query.sort = opts.sort.field + ":" + opts.sort.dir;
        return (await request<{ data: ListingAudits[] }>("GET", "/listing_audits", query)).data;
      },
      async get(id: string): Promise<ListingAudits> {
        return (await request<{ data: ListingAudits }>("GET", "/listing_audits/" + encodeURIComponent(id))).data;
      },
      async create(data: ListingAuditsCreate): Promise<{ id: string }> {
        return request<{ id: string }>("POST", "/listing_audits", undefined, data);
      },
    },
    search_queries: { // requires setUserToken() for non-public access
      async list(opts: SearchQueriesListOpts = {}): Promise<SearchQueries[]> {
        const query: Record<string, unknown> = { limit: opts.limit, offset: opts.offset, ...(opts.filter ?? {}) };
        if (opts.sort) query.sort = opts.sort.field + ":" + opts.sort.dir;
        return (await request<{ data: SearchQueries[] }>("GET", "/search_queries", query)).data;
      },
      async get(id: string): Promise<SearchQueries> {
        return (await request<{ data: SearchQueries }>("GET", "/search_queries/" + encodeURIComponent(id))).data;
      },
      async create(data: SearchQueriesCreate): Promise<{ id: string }> {
        return request<{ id: string }>("POST", "/search_queries", undefined, data);
      },
    },
    users: { // requires setUserToken() for non-public access
      async list(opts: UsersListOpts = {}): Promise<Users[]> {
        const query: Record<string, unknown> = { limit: opts.limit, offset: opts.offset, ...(opts.filter ?? {}) };
        if (opts.sort) query.sort = opts.sort.field + ":" + opts.sort.dir;
        return (await request<{ data: Users[] }>("GET", "/users", query)).data;
      },
      async get(id: string): Promise<Users> {
        return (await request<{ data: Users }>("GET", "/users/" + encodeURIComponent(id))).data;
      },
      async create(data: UsersCreate): Promise<{ id: string }> {
        return request<{ id: string }>("POST", "/users", undefined, data);
      },
    },
  };
}

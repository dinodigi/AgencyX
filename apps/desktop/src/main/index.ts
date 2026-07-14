/**
 * Electron main process entry. Wires together: secure token store, the auth
 * manager + refresh loop, the SQLite outbox, the sync engine, the queue reader,
 * and the self-updater — then exposes them to the renderer over the typed IPC
 * contract (src/shared/ipc.ts). The renderer has no Node/network access; node
 * integration is off and contextIsolation is on.
 */

import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import type { AuthState, AutoRunState, CapturedLead, QualItem, QualRunState, QueueItem, RunLogLine, RunState, SyncStats } from "../shared/ipc.ts";
import type { QualificationStatus, RawListing, ScrapeFilter, ScrapeSpeed, ScrapeDetailLevel } from "@dinosales/types";
import { toScrapeFilter, toScrapeSpeed, makeQueryDedupKey, SPEED_PROFILES, DEFAULT_SPEED, QUALIFICATION_STATUSES } from "@dinosales/types";
import type { NormalizedSearch } from "@dinosales/ui/search";
import { AgentXError } from "@dinosales/agentx-client";
import { AuthManager, type SessionInput } from "./auth.ts";
import { getOrCreateDeviceId } from "./device.ts";
import { createOutbox, type OutboxStore } from "./outbox.ts";
import { SyncEngine } from "./sync-engine.ts";
import { initUpdater } from "./updater.ts";
import { ScrapeRunner, type RunContext } from "./scraper/runner.ts";
import { MockSource } from "./scraper/mock-source.ts";
import { GoogleMapsSource } from "./scraper/google-source.ts";
import type { ScrapeSource } from "./scraper/types.ts";
import { ensureRegistration, type Registration } from "./registration.ts";
import { AutoRunController } from "./autorun.ts";
import { QualifyRunner, type QualifyJobRow } from "./qualify/job.ts";
import { PlaywrightPageReader } from "./qualify/page-reader.ts";
import { MozAuditor } from "./qualify/moz.ts";

// The delivery-scoped project token is baked at build time (public read/write
// is still gated by the user JWT, so this is a project identifier, not a secret
// that grants tenant data on its own). Injected via env for now.
const DELIVERY_TOKEN = process.env.AGENTX_DELIVERY_TOKEN ?? "";
const IS_DEV = !app.isPackaged;

let win: BrowserWindow | null = null;
let auth: AuthManager;
let outbox: OutboxStore;
let sync: SyncEngine;
let deviceId = "";
let runAbort: AbortController | null = null;
let runState: RunState = { running: false, captured: 0 };
let qualAbort: AbortController | null = null;
let qualState: QualRunState = { running: false };
let registration: Registration | null = null;
let registeredOrgId: string | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let autorun: AutoRunController | null = null;
let stopChangeFeed: (() => void) | null = null;

const HEARTBEAT_MS = 5 * 60 * 1000; // coarse — presence, not real-time (limits undocumented)
const WRITE_PACE_MS = 200; // gap between delivery-API writes (rate-limit courtesy)

function platformName(): "windows" | "mac" {
  return process.platform === "darwin" ? "mac" : "windows";
}

function send<T>(channel: string, payload: T): void {
  win?.webContents.send(channel, payload);
}

function log(level: RunLogLine["level"], message: string): void {
  const line: RunLogLine = { at: Date.now(), level, message };
  send("log:line", line);
  // eslint-disable-next-line no-console
  console[level === "error" ? "error" : "log"](`[${level}] ${message}`);
}

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0b1220",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (IS_DEV && process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    await win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function registerIpc(): void {
  ipcMain.handle("auth:getState", () => auth.getState());
  ipcMain.handle("auth:setSession", (_e, a: SessionInput) => auth.setSession(a));
  ipcMain.handle("auth:signOut", () => auth.signOut());

  ipcMain.handle("queue:list", () => listQueue());
  ipcMain.handle("queue:refresh", () => listQueue());

  ipcMain.handle("sync:getStats", () => sync.stats());
  ipcMain.handle("sync:flushNow", () => sync.flushNow());

  ipcMain.handle("device:getInfo", () => ({
    deviceId,
    platform: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : process.platform,
    appVersion: app.getVersion(),
  }));

  ipcMain.handle("run:getState", () => runState);
  ipcMain.handle(
    "run:start",
    (
      _e,
      args: {
        keyword: string;
        zip: string;
        mock?: boolean;
        maxLeads?: number;
        filter?: ScrapeFilter;
        speed?: ScrapeSpeed;
        detailLevel?: ScrapeDetailLevel;
      },
    ) => startRun(args),
  );
  ipcMain.handle("run:claimNext", () => claimNextRun());
  ipcMain.handle("run:stop", () => stopRun());

  ipcMain.handle("search:queue", (_e, n: NormalizedSearch) => queueSearchOnDesktop(n));

  ipcMain.handle("qualify:list", () => listQualQueue());
  ipcMain.handle("qualify:runNext", () => qualifyNext());
  ipcMain.handle("qualify:stop", () => stopQualify());
  ipcMain.handle("qualify:getState", () => qualState);

  ipcMain.handle("autorun:getState", () => autorun?.state() ?? { enabled: true, ranThisHour: 0 });
  ipcMain.handle("autorun:setEnabled", (_e, enabled: boolean) => autorun?.setEnabled(enabled) ?? { enabled, ranThisHour: 0 });
}

/**
 * Registration + presence. On sign-in, ensure the org's agency/user/device rows
 * exist and remember their ids so leads carry relations and the queue-claim path
 * can run; on sign-out, drop them and stop the heartbeat.
 */
async function onAuthChanged(state: AuthState): Promise<void> {
  send("auth:changed", state);
  if (state.status === "signed-in" && state.orgId && state.email) {
    // Register on first sign-in or when the active org changed.
    if (state.orgId !== registeredOrgId) {
      stopFeed();
      registration = null;
      await doRegister(state.orgId, state.email);
    }
    startChangeFeed(); // idempotent — no-op if already streaming (fires on token refresh too)
  } else {
    registration = null;
    registeredOrgId = null;
    stopFeed();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function doRegister(orgId: string, email: string): Promise<void> {
  const client = auth.getClient();
  if (!client) return;
  try {
    registration = await ensureRegistration(client, {
      orgId,
      deviceId,
      platform: platformName(),
      appVersion: app.getVersion(),
      email,
    });
    registeredOrgId = orgId;
    log("info", `device registered (${deviceId.slice(0, 8)}…) to agency ${registration.agencyRowId.slice(0, 8)}…`);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => void beat(), HEARTBEAT_MS);
  } catch (err) {
    log("error", `device registration failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Live sync (SSE). Stream AgentX changes so the queue reflects searches created
 * on the web — and status/result changes from any device — without a manual
 * Refresh. The generated client handles reconnect + poll fallback; we just
 * re-list the queue when a search_queries row changes. A persistent process can
 * hold this stream cheaply, so the desktop gets push (the web polls instead).
 */
function startChangeFeed(): void {
  const client = auth.getClient();
  if (!client || stopChangeFeed) return;
  stopChangeFeed = client.ax.changes.stream(
    (c) => {
      if (c.collection === "search_queries") void listQueue();
      if (c.collection === "qualifications") void listQualQueue();
    },
    { collections: ["search_queries", "qualifications"] },
  );
  log("info", "live sync connected");
}

function stopFeed(): void {
  stopChangeFeed?.();
  stopChangeFeed = null;
}

async function beat(): Promise<void> {
  const client = auth.getClient();
  if (!client || !registration) return;
  try {
    await client.heartbeat(registration.deviceRowId, app.getVersion(), new Date().toISOString());
  } catch (err) {
    log("warn", `heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function toCaptured(l: RawListing): CapturedLead {
  return {
    at: Date.now(),
    placeId: l.placeId,
    businessName: l.businessName,
    address: l.address,
    phone: l.phone,
    website: l.website,
    hasWebsite: Boolean(l.website && l.website.length > 0),
    category: l.category,
    reviewCount: l.reviewCount,
    rating: l.rating,
    claimed: l.claimed,
  };
}

/** Build a runner whose claim/complete/fail drive the real search_queries workflow. */
function makeRunner(
  useRealSource: boolean,
  opts: { maxLeads?: number; speed?: ScrapeSpeed; detailLevel?: ScrapeDetailLevel } = {},
): ScrapeRunner {
  const client = auth.getClient()!;
  return new ScrapeRunner({
    outbox,
    makeSource: (): ScrapeSource => (useRealSource ? new GoogleMapsSource() : new MockSource()),
    claim: (queryId, deviceRowId) => client.claimQuery(queryId, deviceRowId),
    complete: (queryId, count, iso) => client.completeQuery(queryId, count, iso),
    fail: (queryId) => client.failQuery(queryId),
    onLog: log,
    onOutcome: (o) => setRunState({ lastOutcome: o.kind }),
    onCaptured: (listing) => send("lead:captured", toCaptured(listing)),
    now: () => new Date().toISOString(),
    maxLeads: opts.maxLeads ?? 80,
    speed: opts.speed,
    detailLevel: opts.detailLevel,
  });
}

function currentContext(orgId: string): RunContext {
  return { orgId, agencyRowId: registration?.agencyRowId, deviceRowId: registration?.deviceRowId };
}

function setRunState(patch: Partial<RunState>): void {
  runState = { ...runState, ...patch };
  send("run:changed", runState);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function isRateLimit(e: unknown): boolean {
  return e instanceof AgentXError && (e.status === 429 || /too many requests/i.test(e.message));
}
async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRateLimit(e) || attempt >= 5) throw e;
      await sleep(500 * 2 ** attempt);
    }
  }
}

/**
 * Desktop side of the shared Search form: create/queue one search_queries row per
 * keyword × ZIP. Mirrors the web's queueSearch (paced + 429-aware). Auto-run (or
 * "Start on this device") picks the rows up from the queue.
 */
async function queueSearchOnDesktop(n: NormalizedSearch): Promise<{ ok: boolean; message?: string; error?: string }> {
  const client = auth.getClient();
  const state = auth.getState();
  if (!client || state.status !== "signed-in" || !state.orgId) return { ok: false, error: "Not signed in." };
  if (n.units === 0) return { ok: false, error: "Enter at least one keyword and one ZIP." };
  if (n.units > 500) return { ok: false, error: `${n.units} units exceeds the 500-unit cap.` };

  const orgId = state.orgId;
  const base = {
    max_leads: n.maxLeads,
    target_website: n.filter.target_website,
    min_reviews: n.filter.min_reviews,
    max_reviews: n.filter.max_reviews,
    min_rating: n.filter.min_rating,
    speed: n.speed,
    detail_level: n.detailLevel,
  };

  let created = 0;
  let requeued = 0;
  let skipped = 0;
  try {
    for (const keyword of n.keywords) {
      for (const zip of n.zips) {
        const dedup_key = makeQueryDedupKey(orgId, keyword, zip);
        const res = await withBackoff(() => client.upsertSearchQuery({ org_id: orgId, dedup_key, keyword, zip, ...base }));
        if (!res.alreadySynced) {
          created++;
        } else if (n.recoverage === "requeue") {
          const current = await withBackoff(() => client.ax.search_queries.get(res.id));
          const patch: Record<string, unknown> = { ...base };
          if (current.status !== "running") {
            patch.status = "pending";
            patch.queued_at = new Date().toISOString();
          }
          await withBackoff(() => client.update("search_queries", res.id, patch));
          requeued++;
        } else {
          skipped++;
        }
        await sleep(WRITE_PACE_MS);
      }
    }
  } catch (e) {
    const done = created + requeued + skipped;
    const msg = isRateLimit(e)
      ? `Queued ${done} of ${n.units}, then AgentX rate-limited. Re-submit — already-created units are skipped.`
      : e instanceof Error
        ? e.message
        : String(e);
    return { ok: false, error: msg };
  }

  void listQueue();
  const parts: string[] = [];
  if (created) parts.push(`${created} queued`);
  if (requeued) parts.push(`${requeued} re-queued`);
  if (skipped) parts.push(`${skipped} already covered`);
  return { ok: true, message: `${parts.join(" · ") || "Nothing to do"}.` };
}

/** Any run finishing — let the auto-run loop chain the next claim (or cool down). */
function onRunFinished(outcome: { kind: string; backoffMs?: number }): void {
  autorun?.notifyFinished(outcome.kind, outcome.backoffMs);
}

async function startRun(args: {
  keyword: string;
  zip: string;
  mock?: boolean;
  maxLeads?: number;
  filter?: ScrapeFilter;
  speed?: ScrapeSpeed;
  detailLevel?: ScrapeDetailLevel;
}): Promise<RunState> {
  const state = auth.getState();
  if (state.status !== "signed-in" || !state.orgId) {
    log("error", "cannot run: not signed in");
    return runState;
  }
  const busy = busyReason();
  if (busy) {
    log("warn", `cannot start a run — ${busy}`);
    return runState;
  }

  runAbort = new AbortController();
  setRunState({ running: true, keyword: args.keyword, zip: args.zip, captured: 0, lastOutcome: undefined });

  // Ad-hoc run: no queue row to claim; leads carry agency/device if registered.
  const ctx = currentContext(state.orgId);
  void makeRunner(args.mock === false, { maxLeads: args.maxLeads, speed: args.speed, detailLevel: args.detailLevel })
    .runAdhoc(args.keyword, args.zip, ctx, runAbort.signal, args.filter)
    .then((outcome) => {
      setRunState({ running: false, captured: outcome.captured, lastOutcome: outcome.kind });
      void sync.flushNow();
      onRunFinished(outcome);
    })
    .catch((err) => {
      log("error", `run crashed: ${err instanceof Error ? err.message : String(err)}`);
      setRunState({ running: false });
    });

  return runState;
}

/** Claim the oldest pending search query for this org and run it end-to-end. */
async function claimNextRun(): Promise<RunState> {
  const state = auth.getState();
  const client = auth.getClient();
  if (state.status !== "signed-in" || !state.orgId || !client) {
    log("error", "cannot run: not signed in");
    return runState;
  }
  const busy = busyReason();
  if (busy) {
    log("warn", `cannot claim a run — ${busy}`);
    return runState;
  }
  if (!registration?.deviceRowId) {
    log("error", "device not registered yet — cannot claim a queued query");
    return runState;
  }

  let pending:
    | {
        id: string;
        keyword: string;
        zip: string;
        max_leads?: number;
        target_website?: string;
        min_reviews?: number;
        max_reviews?: number;
        min_rating?: number;
        speed?: string;
        detail_level?: string;
      }
    | undefined;
  try {
    // FIFO: oldest queued first — so "Run next queued" runs what was queued first,
    // not whatever sorts first alphabetically.
    const rows = await client.ax.search_queries.list({
      filter: { status: "pending" },
      limit: 1,
      sort: { field: "queued_at", dir: "asc" },
    });
    pending = rows[0];
  } catch (err) {
    log("error", `queue read failed: ${err instanceof Error ? err.message : String(err)}`);
    return runState;
  }
  if (!pending) {
    log("info", "no pending queries to claim");
    return runState;
  }

  runAbort = new AbortController();
  setRunState({ running: true, keyword: pending.keyword, zip: pending.zip, captured: 0, lastOutcome: undefined });

  // Queued searches ALWAYS scrape the real Google source — the queue is the
  // production path. (Dry-run/mock is an ad-hoc "Start run" option only.)
  // Speed + detail come from the row so each search runs how it was queued.
  const filter = toScrapeFilter(pending);
  void makeRunner(true, {
    maxLeads: pending.max_leads,
    speed: toScrapeSpeed(pending.speed),
    detailLevel: pending.detail_level === "preview" ? "preview" : "full",
  })
    .runQuery(pending.id, pending.keyword, pending.zip, currentContext(state.orgId), runAbort.signal, filter)
    .then((outcome) => {
      setRunState({ running: false, captured: outcome.captured, lastOutcome: outcome.kind });
      void sync.flushNow();
      void listQueue();
      onRunFinished(outcome);
    })
    .catch((err) => {
      log("error", `run crashed: ${err instanceof Error ? err.message : String(err)}`);
      setRunState({ running: false });
    });

  return runState;
}

function stopRun(): RunState {
  if (runAbort && runState.running) {
    runAbort.abort();
    log("info", "run stop requested");
  }
  return runState;
}

async function listQueue(): Promise<QueueItem[]> {
  const client = auth.getClient();
  if (!client) return [];
  try {
    const rows = await client.ax.search_queries.list({ limit: 200, sort: { field: "queued_at", dir: "desc" } });
    const items: QueueItem[] = rows.map((r) => ({
      id: r.id,
      keyword: r.keyword,
      zip: r.zip,
      status: (r.status ?? "pending") as QueueItem["status"],
      lastScrapedAt: r.last_scraped_at,
      resultCount: r.result_count,
      speed: toScrapeSpeed(r.speed),
      detailLevel: r.detail_level === "preview" ? "preview" : "full",
      queuedAt: r.queued_at,
    }));
    send("queue:changed", items);
    return items;
  } catch (err) {
    log("warn", `queue refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Qualification jobs (build-order step 3): the web queues a qualifications row
// (pending); this device claims it and collects — deep listing re-scrape +
// bounded site crawl + Moz audit — then lands collecting→collected. One
// browser-driving job at a time, shared gate with scrape runs.
// ---------------------------------------------------------------------------

function setQualState(patch: Partial<QualRunState>): void {
  qualState = { ...qualState, ...patch };
  send("qualify:changed", qualState);
}

function busyReason(): string | null {
  if (runState.running) return "a scrape run is in progress";
  if (qualState.running) return "a qualification job is in progress";
  return null;
}

async function listQualQueue(): Promise<QualItem[]> {
  const client = auth.getClient();
  if (!client) return [];
  try {
    const rows = await client.ax.qualifications.list({ limit: 100 });
    const items: QualItem[] = rows.map((r) => ({
      id: r.id,
      leadName: r.lead.label,
      status: (QUALIFICATION_STATUSES as readonly string[]).includes(r.status ?? "") ? (r.status as QualificationStatus) : "pending",
      websiteUrl: r.website_url,
      pageCount: r.page_count,
      collectedAt: r.collected_at,
    }));
    send("qualify:queue", items);
    return items;
  } catch (err) {
    log("warn", `qualification queue refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function makeQualifyRunner(): QualifyRunner {
  const client = auth.getClient()!;
  return new QualifyRunner({
    claim: (qualId, deviceRowId) => client.claimQualification(qualId, deviceRowId),
    complete: (qualId, result) => client.completeQualification(qualId, result),
    fail: (qualId) => client.failQualification(qualId),
    writeAudit: async (audit) => {
      await client.ax.listing_audits.create(audit);
    },
    lookupListing: async (job, signal) => {
      const source = new GoogleMapsSource();
      await source.open();
      try {
        return await source.lookup(job.leadName, job.address ?? "", {
          signal,
          profile: SPEED_PROFILES[DEFAULT_SPEED],
          onLog: log,
          targetPlaceId: job.placeId,
        });
      } finally {
        await source.close().catch(() => {});
      }
    },
    makeReader: async () => {
      const reader = new PlaywrightPageReader();
      await reader.open();
      return { reader, close: () => reader.close() };
    },
    runMoz: (input, signal) => new MozAuditor().run(input, { signal, onLog: log }),
    probe: async (url) => {
      try {
        const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000) });
        return res.status;
      } catch {
        return null;
      }
    },
    onLog: log,
    now: () => new Date().toISOString(),
  });
}

/** Claim the oldest pending qualification and run the collection job. */
async function qualifyNext(): Promise<QualRunState> {
  const state = auth.getState();
  const client = auth.getClient();
  if (state.status !== "signed-in" || !state.orgId || !client) {
    log("error", "cannot qualify: not signed in");
    return qualState;
  }
  const busy = busyReason();
  if (busy) {
    log("warn", `cannot start a qualification — ${busy}`);
    return qualState;
  }
  if (!registration?.deviceRowId) {
    log("error", "device not registered yet — cannot claim a qualification");
    return qualState;
  }

  let job: QualifyJobRow | undefined;
  try {
    const rows = await client.ax.qualifications.list({ filter: { status: "pending" }, limit: 1 });
    const row = rows[0];
    if (row) {
      // The job needs lead fallbacks (website/address/place id) — one extra read.
      const lead = await client.ax.leads.get(row.lead.id);
      job = {
        qualId: row.id,
        orgId: state.orgId,
        leadId: lead.id,
        leadName: lead.business_name,
        website: lead.website,
        address: lead.address,
        placeId: lead.place_id,
        agencyRowId: registration.agencyRowId,
        deviceRowId: registration.deviceRowId,
      };
    }
  } catch (err) {
    log("error", `qualification queue read failed: ${err instanceof Error ? err.message : String(err)}`);
    return qualState;
  }
  if (!job) {
    log("info", "no pending qualifications to claim");
    return qualState;
  }

  qualAbort = new AbortController();
  setQualState({ running: true, leadName: job.leadName, lastOutcome: undefined });
  void makeQualifyRunner()
    .run(job, qualAbort.signal)
    .then((outcome) => {
      setQualState({ running: false, lastOutcome: outcome.kind });
      void listQualQueue();
      onRunFinished(outcome);
    })
    .catch((err) => {
      log("error", `qualification crashed: ${err instanceof Error ? err.message : String(err)}`);
      setQualState({ running: false, lastOutcome: "error" });
    });

  return qualState;
}

function stopQualify(): QualRunState {
  if (qualAbort && qualState.running) {
    qualAbort.abort();
    log("info", "qualification stop requested");
  }
  return qualState;
}

app.whenReady().then(async () => {
  const userData = app.getPath("userData");
  deviceId = getOrCreateDeviceId(join(userData, "device-id"));

  outbox = createOutbox(join(userData, "outbox.sqlite3"), (msg) => log("warn", msg));
  if (!outbox.durable) log("warn", "outbox is in-memory (dev mode) — leads not persisted across restarts");

  auth = new AuthManager(DELIVERY_TOKEN, (state: AuthState) => void onAuthChanged(state), log);

  sync = new SyncEngine({
    outbox,
    getClient: () => auth.getClient(),
    onStats: (s: SyncStats) => send("sync:changed", s),
    onLog: log,
  });

  autorun = new AutoRunController({
    settingsPath: join(userData, "autorun.json"),
    onChange: (s: AutoRunState) => send("autorun:changed", s),
    log,
    // Only claim when signed in, device-registered, and nothing already running.
    canClaim: () => auth.getState().status === "signed-in" && !!registration?.deviceRowId && busyReason() === null,
    claim: async () => {
      if (busyReason()) return false;
      // Searches first (they feed the pipeline), then qualification jobs.
      await claimNextRun();
      if (runState.running) return true;
      await qualifyNext();
      return qualState.running;
    },
  });

  registerIpc();
  await createWindow();
  sync.start();
  autorun.start();

  if (!IS_DEV) {
    const updater = initUpdater({ onStatus: (status, extra) => send("update:status", { status, ...extra }) });
    updater.check();
  }

  if (!DELIVERY_TOKEN) log("warn", "AGENTX_DELIVERY_TOKEN not set — sign-in will not reach AgentX");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  sync?.stop();
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  outbox?.close();
  if (process.platform !== "darwin") app.quit();
});

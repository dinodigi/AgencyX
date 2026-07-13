/**
 * Electron main process entry. Wires together: secure token store, the auth
 * manager + refresh loop, the SQLite outbox, the sync engine, the queue reader,
 * and the self-updater — then exposes them to the renderer over the typed IPC
 * contract (src/shared/ipc.ts). The renderer has no Node/network access; node
 * integration is off and contextIsolation is on.
 */

import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import type { AuthState, CapturedLead, QueueItem, RunLogLine, RunState, SyncStats } from "../shared/ipc.ts";
import type { RawListing, ScrapeFilter } from "@dinosales/types";
import { toScrapeFilter } from "@dinosales/types";
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
let registration: Registration | null = null;
let registeredOrgId: string | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

const HEARTBEAT_MS = 5 * 60 * 1000; // coarse — presence, not real-time (limits undocumented)

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
    (_e, args: { keyword: string; zip: string; mock?: boolean; maxLeads?: number; filter?: ScrapeFilter }) => startRun(args),
  );
  ipcMain.handle("run:claimNext", () => claimNextRun());
  ipcMain.handle("run:stop", () => stopRun());
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
      registration = null;
      await doRegister(state.orgId, state.email);
    }
  } else {
    registration = null;
    registeredOrgId = null;
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
function makeRunner(useRealSource: boolean, maxLeads = 80): ScrapeRunner {
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
    maxLeads,
  });
}

function currentContext(orgId: string): RunContext {
  return { orgId, agencyRowId: registration?.agencyRowId, deviceRowId: registration?.deviceRowId };
}

function setRunState(patch: Partial<RunState>): void {
  runState = { ...runState, ...patch };
  send("run:changed", runState);
}

async function startRun(args: { keyword: string; zip: string; mock?: boolean; maxLeads?: number; filter?: ScrapeFilter }): Promise<RunState> {
  const state = auth.getState();
  if (state.status !== "signed-in" || !state.orgId) {
    log("error", "cannot run: not signed in");
    return runState;
  }
  if (runState.running) {
    log("warn", "a run is already in progress");
    return runState;
  }

  runAbort = new AbortController();
  setRunState({ running: true, keyword: args.keyword, zip: args.zip, captured: 0, lastOutcome: undefined });

  // Ad-hoc run: no queue row to claim; leads carry agency/device if registered.
  const ctx = currentContext(state.orgId);
  void makeRunner(args.mock === false, args.maxLeads)
    .runAdhoc(args.keyword, args.zip, ctx, runAbort.signal, args.filter)
    .then((outcome) => {
      setRunState({ running: false, captured: outcome.captured, lastOutcome: outcome.kind });
      void sync.flushNow();
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
  if (runState.running) {
    log("warn", "a run is already in progress");
    return runState;
  }
  if (!registration?.deviceRowId) {
    log("error", "device not registered yet — cannot claim a queued query");
    return runState;
  }

  let pending:
    | { id: string; keyword: string; zip: string; max_leads?: number; target_website?: string; min_reviews?: number; max_reviews?: number }
    | undefined;
  try {
    const rows = await client.ax.search_queries.list({
      filter: { status: "pending" },
      limit: 1,
      sort: { field: "keyword", dir: "asc" },
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

  const filter = toScrapeFilter(pending);
  void makeRunner(false, pending.max_leads)
    .runQuery(pending.id, pending.keyword, pending.zip, currentContext(state.orgId), runAbort.signal, filter)
    .then((outcome) => {
      setRunState({ running: false, captured: outcome.captured, lastOutcome: outcome.kind });
      void sync.flushNow();
      void listQueue();
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
    const rows = await client.ax.search_queries.list({ limit: 200, sort: { field: "last_scraped_at", dir: "desc" } });
    const items: QueueItem[] = rows.map((r) => ({
      id: r.id,
      keyword: r.keyword,
      zip: r.zip,
      status: (r.status ?? "pending") as QueueItem["status"],
      lastScrapedAt: r.last_scraped_at,
      resultCount: r.result_count,
    }));
    send("queue:changed", items);
    return items;
  } catch (err) {
    log("warn", `queue refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
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

  registerIpc();
  await createWindow();
  sync.start();

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

/**
 * Electron main process entry. Wires together: secure token store, the auth
 * manager + refresh loop, the SQLite outbox, the sync engine, the queue reader,
 * and the self-updater — then exposes them to the renderer over the typed IPC
 * contract (src/shared/ipc.ts). The renderer has no Node/network access; node
 * integration is off and contextIsolation is on.
 */

import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import type { AuthState, QueueItem, RunLogLine, RunState, SyncStats } from "../shared/ipc.ts";
import { initSecureStore } from "./secure-store.ts";
import { AuthManager, type RefreshFn } from "./auth.ts";
import { getOrCreateDeviceId } from "./device.ts";
import { Outbox } from "./outbox.ts";
import { SyncEngine } from "./sync-engine.ts";
import { initUpdater } from "./updater.ts";
import { ScrapeRunner, type RunContext } from "./scraper/runner.ts";
import { MockSource } from "./scraper/mock-source.ts";
import { GoogleMapsSource } from "./scraper/google-source.ts";
import type { ScrapeSource } from "./scraper/types.ts";

// The delivery-scoped project token is baked at build time (public read/write
// is still gated by the user JWT, so this is a project identifier, not a secret
// that grants tenant data on its own). Injected via env for now.
const DELIVERY_TOKEN = process.env.AGENTX_DELIVERY_TOKEN ?? "";
const IS_DEV = !app.isPackaged;

let win: BrowserWindow | null = null;
let auth: AuthManager;
let outbox: Outbox;
let sync: SyncEngine;
let deviceId = "";
let runAbort: AbortController | null = null;
let runState: RunState = { running: false, captured: 0 };

function send<T>(channel: string, payload: T): void {
  win?.webContents.send(channel, payload);
}

function log(level: RunLogLine["level"], message: string): void {
  const line: RunLogLine = { at: Date.now(), level, message };
  send("log:line", line);
  // eslint-disable-next-line no-console
  console[level === "error" ? "error" : "log"](`[${level}] ${message}`);
}

/**
 * Clerk refresh hook. Real implementation calls Clerk's token endpoint with the
 * stored refresh material. Until the Clerk app is wired, this returns null,
 * which makes AuthManager sign out with a clear log rather than 401 mid-run.
 */
const refreshFn: RefreshFn = async (_refreshToken) => {
  // TODO(W1): call Clerk to mint a fresh session JWT from the refresh token.
  return null;
};

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
  ipcMain.handle("auth:signIn", (_e, a: { email: string; sessionToken: string; refreshToken?: string; orgId: string; expiresAt: number }) =>
    auth.signIn(a),
  );
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
  ipcMain.handle("run:start", (_e, args: { keyword: string; zip: string; mock?: boolean }) => startRun(args));
  ipcMain.handle("run:stop", () => stopRun());
}

function setRunState(patch: Partial<RunState>): void {
  runState = { ...runState, ...patch };
  send("run:changed", runState);
}

async function startRun(args: { keyword: string; zip: string; mock?: boolean }): Promise<RunState> {
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

  const ctx: RunContext = { orgId: state.orgId };
  const runner = new ScrapeRunner({
    outbox,
    // Real Google source once selectors are tuned (§12.5); mock is the default/dry-run.
    makeSource: (): ScrapeSource => (args.mock === false ? new GoogleMapsSource() : new MockSource({ count: 8 })),
    claim: async () => ({ claimed: true }),
    complete: async () => {},
    fail: async () => {},
    onLog: log,
    onOutcome: (o) => setRunState({ lastOutcome: o.kind }),
    now: () => new Date().toISOString(),
    maxLeads: 80,
  });

  // Track captured count off the log stream is brittle; wrap onListing via the
  // runner's ad-hoc path and let sync drain. Fire-and-forget; UI follows events.
  void runner
    .runAdhoc(args.keyword, args.zip, ctx, runAbort.signal)
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
  initSecureStore(join(userData, "auth-meta.json"));
  deviceId = getOrCreateDeviceId(join(userData, "device-id"));

  outbox = new Outbox(join(userData, "outbox.sqlite3"));

  auth = new AuthManager(
    DELIVERY_TOKEN,
    refreshFn,
    (state: AuthState) => send("auth:changed", state),
    log,
  );

  sync = new SyncEngine({
    outbox,
    getClient: () => auth.getClient(),
    onStats: (s: SyncStats) => send("sync:changed", s),
    onLog: log,
  });

  registerIpc();
  await auth.restore();
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
  outbox?.close();
  if (process.platform !== "darwin") app.quit();
});

/**
 * The ONLY bridge between renderer and main. contextIsolation is on and node
 * integration is off, so the renderer sees exactly this `leadEngine` object and
 * nothing else — no ipcRenderer, no require, no tokens.
 */

import { contextBridge, ipcRenderer } from "electron";
import type { AuthState, QueueItem, SyncStats, RunLogLine, RunState, CapturedLead } from "../shared/ipc.ts";

const api = {
  auth: {
    getState: (): Promise<AuthState> => ipcRenderer.invoke("auth:getState"),
    setSession: (a: { email: string; orgId: string; token: string; expiresAt: number }): Promise<AuthState> =>
      ipcRenderer.invoke("auth:setSession", a),
    signOut: (): Promise<AuthState> => ipcRenderer.invoke("auth:signOut"),
  },
  queue: {
    list: (): Promise<QueueItem[]> => ipcRenderer.invoke("queue:list"),
    refresh: (): Promise<QueueItem[]> => ipcRenderer.invoke("queue:refresh"),
  },
  sync: {
    getStats: (): Promise<SyncStats> => ipcRenderer.invoke("sync:getStats"),
    flushNow: (): Promise<SyncStats> => ipcRenderer.invoke("sync:flushNow"),
  },
  device: {
    getInfo: (): Promise<{ deviceId: string; platform: string; appVersion: string }> => ipcRenderer.invoke("device:getInfo"),
  },
  run: {
    start: (args: { keyword: string; zip: string; mock?: boolean; maxLeads?: number }): Promise<RunState> =>
      ipcRenderer.invoke("run:start", args),
    claimNext: (): Promise<RunState> => ipcRenderer.invoke("run:claimNext"),
    stop: (): Promise<RunState> => ipcRenderer.invoke("run:stop"),
    getState: (): Promise<RunState> => ipcRenderer.invoke("run:getState"),
  },
  on: {
    authChanged: (cb: (s: AuthState) => void) => subscribe("auth:changed", cb),
    syncChanged: (cb: (s: SyncStats) => void) => subscribe("sync:changed", cb),
    queueChanged: (cb: (q: QueueItem[]) => void) => subscribe("queue:changed", cb),
    runChanged: (cb: (r: RunState) => void) => subscribe("run:changed", cb),
    logLine: (cb: (l: RunLogLine) => void) => subscribe("log:line", cb),
    leadCaptured: (cb: (l: CapturedLead) => void) => subscribe("lead:captured", cb),
    updateStatus: (cb: (u: { status: string; version?: string; percent?: number }) => void) => subscribe("update:status", cb),
  },
};

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("leadEngine", api);

export type LeadEngineBridge = typeof api;

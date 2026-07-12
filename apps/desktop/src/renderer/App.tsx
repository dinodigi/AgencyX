import { useEffect, useState } from "react";
import type { AuthState, QueueItem, SyncStats, RunLogLine } from "../shared/ipc.ts";
import { SignIn } from "./views/SignIn.tsx";
import { Dashboard } from "./views/Dashboard.tsx";

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "signed-out" });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void window.leadEngine.auth.getState().then((s) => {
      setAuth(s);
      setReady(true);
    });
    const off = window.leadEngine.on.authChanged(setAuth);
    return off;
  }, []);

  if (!ready) return <div className="center muted">Starting…</div>;

  return auth.status === "signed-in" ? <Dashboard auth={auth} /> : <SignIn />;
}

/** Shared subscription hook used by the dashboard views. */
export function useLiveState() {
  const [sync, setSync] = useState<SyncStats>({ pending: 0, synced: 0, failed: 0, online: true });
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [log, setLog] = useState<RunLogLine[]>([]);

  useEffect(() => {
    void window.leadEngine.sync.getStats().then(setSync);
    void window.leadEngine.queue.list().then(setQueue);
    const offs = [
      window.leadEngine.on.syncChanged(setSync),
      window.leadEngine.on.queueChanged(setQueue),
      window.leadEngine.on.logLine((line) => setLog((prev) => [...prev.slice(-299), line])),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  return { sync, queue, log };
}

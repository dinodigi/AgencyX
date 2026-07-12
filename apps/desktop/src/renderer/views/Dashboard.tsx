import { useEffect, useState } from "react";
import type { AuthState } from "../../shared/ipc.ts";
import { useLiveState } from "../App.tsx";
import { QueuePanel } from "./QueuePanel.tsx";
import { RunControls } from "./RunControls.tsx";
import { RunLog } from "./RunLog.tsx";
import { StatusBar } from "./StatusBar.tsx";

export function Dashboard({ auth }: { auth: AuthState }) {
  const { sync, queue, log } = useLiveState();
  const [device, setDevice] = useState<{ deviceId: string; platform: string; appVersion: string } | null>(null);

  useEffect(() => {
    void window.leadEngine.device.getInfo().then(setDevice);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand small">Lead Engine</span>
        <span className="spacer" />
        <span className="muted">{auth.email}</span>
        <button className="ghost" onClick={() => void window.leadEngine.auth.signOut()}>
          Sign out
        </button>
      </header>

      <main className="grid">
        <div className="col">
          <RunControls />
          <QueuePanel queue={queue} />
        </div>
        <RunLog lines={log} />
      </main>

      <StatusBar sync={sync} device={device} />
    </div>
  );
}

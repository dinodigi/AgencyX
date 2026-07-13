import { useEffect, useState } from "react";
import { useLiveState } from "../App.tsx";
import { QueuePanel } from "./QueuePanel.tsx";
import { RunControls } from "./RunControls.tsx";
import { RunLog } from "./RunLog.tsx";
import { CapturedLeads } from "./CapturedLeads.tsx";
import { StatusBar } from "./StatusBar.tsx";

export function Dashboard({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const { sync, queue, log } = useLiveState();
  const [device, setDevice] = useState<{ deviceId: string; platform: string; appVersion: string } | null>(null);

  useEffect(() => {
    void window.leadEngine.device.getInfo().then(setDevice);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand-row">
          <span className="brand-mark">AX</span>
          <span className="brand small">
            Agency<span className="x">X</span>
          </span>
        </span>
        <span className="spacer" />
        {email && <span className="muted">{email}</span>}
        <button className="ghost" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      <main className="grid">
        <div className="col">
          <RunControls />
          <QueuePanel queue={queue} />
        </div>
        <div className="col">
          <CapturedLeads />
          <RunLog lines={log} />
        </div>
      </main>

      <StatusBar sync={sync} device={device} />
    </div>
  );
}

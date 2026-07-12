import { useState } from "react";
import type { SyncStats } from "../../shared/ipc.ts";

export function StatusBar({
  sync,
  device,
}: {
  sync: SyncStats;
  device: { deviceId: string; platform: string; appVersion: string } | null;
}) {
  const [flushing, setFlushing] = useState(false);

  async function flush() {
    setFlushing(true);
    try {
      await window.leadEngine.sync.flushNow();
    } finally {
      setFlushing(false);
    }
  }

  return (
    <footer className="statusbar">
      <span className={`dot ${sync.online ? "online" : "offline"}`} />
      <span>{sync.online ? "Online" : "Offline"}</span>
      <span className="sep">·</span>
      <span>
        {sync.pending} pending · {sync.synced} synced
        {sync.failed > 0 && <span className="warn"> · {sync.failed} failed</span>}
      </span>
      <button className="ghost tiny" onClick={flush} disabled={flushing || sync.pending === 0}>
        {flushing ? "Syncing…" : "Sync now"}
      </button>
      <span className="spacer" />
      {device && (
        <span className="muted tiny">
          {device.platform} · v{device.appVersion} · {device.deviceId.slice(0, 8)}
        </span>
      )}
    </footer>
  );
}

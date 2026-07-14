import { useEffect, useState } from "react";
import type { QualItem, QualRunState } from "../../shared/ipc.ts";

const STATUS_CLASS: Record<QualItem["status"], string> = {
  pending: "pill pending",
  collecting: "pill running",
  collected: "pill completed",
  scored: "pill completed",
  briefed: "pill completed",
  failed: "pill failed",
};

/** Qualification queue: deep-research jobs the web app queued per lead. The
 *  desktop claims one at a time (auto-run picks them up after searches). */
export function QualifyPanel() {
  const [items, setItems] = useState<QualItem[]>([]);
  const [state, setState] = useState<QualRunState>({ running: false });

  useEffect(() => {
    void window.leadEngine.qualify.list().then(setItems);
    void window.leadEngine.qualify.getState().then(setState);
    const offs = [window.leadEngine.on.qualifyQueue(setItems), window.leadEngine.on.qualifyChanged(setState)];
    return () => offs.forEach((off) => off());
  }, []);

  const pending = items.filter((i) => i.status === "pending").length;

  return (
    <section className="card panel">
      <div className="panel-head">
        <h2>Qualification queue</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {state.running ? (
            <>
              <span className="muted">collecting “{state.leadName}”…</span>
              <button className="ghost" onClick={() => void window.leadEngine.qualify.stop()}>
                Stop
              </button>
            </>
          ) : (
            <button className="ghost" onClick={() => void window.leadEngine.qualify.runNext()} disabled={pending === 0}>
              Run next ({pending})
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="muted pad">No qualification jobs. Queue one from a lead's page in the web app.</p>
      ) : (
        <table className="queue">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Status</th>
              <th>Website</th>
              <th className="num">Pages</th>
            </tr>
          </thead>
          <tbody>
            {items.map((q) => (
              <tr key={q.id}>
                <td>{q.leadName}</td>
                <td>
                  <span className={STATUS_CLASS[q.status]}>{q.status}</span>
                </td>
                <td className="muted">{q.websiteUrl ? new URL(q.websiteUrl).hostname : "—"}</td>
                <td className="num">{q.pageCount ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

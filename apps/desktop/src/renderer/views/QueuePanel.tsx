import { useState } from "react";
import type { QueueItem } from "../../shared/ipc.ts";

const STATUS_CLASS: Record<QueueItem["status"], string> = {
  pending: "pill pending",
  running: "pill running",
  completed: "pill completed",
  failed: "pill failed",
};

export function QueuePanel({ queue }: { queue: QueueItem[] }) {
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await window.leadEngine.queue.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="card panel">
      <div className="panel-head">
        <h2>Search queue</h2>
        <button className="ghost" onClick={refresh} disabled={refreshing}>
          {refreshing ? "…" : "Refresh"}
        </button>
      </div>

      {queue.length === 0 ? (
        <p className="muted pad">No queries yet. Build a batch in the web app.</p>
      ) : (
        <table className="queue">
          <thead>
            <tr>
              <th>Keyword</th>
              <th>ZIP</th>
              <th>Status</th>
              <th>Last scraped</th>
              <th className="num">Leads</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((q) => (
              <tr key={q.id}>
                <td>{q.keyword}</td>
                <td>{q.zip}</td>
                <td>
                  <span className={STATUS_CLASS[q.status]}>{q.status}</span>
                </td>
                <td className="muted">{q.lastScrapedAt ? new Date(q.lastScrapedAt).toLocaleString() : "—"}</td>
                <td className="num">{q.resultCount ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import type { CapturedLead } from "../../shared/ipc.ts";

/**
 * Live scrape view — each lead appears here the moment it's captured, so you can
 * watch a run fill in real time (works for the mock AND the real Google source).
 * Clears when a new run starts.
 */
export function CapturedLeads() {
  const [leads, setLeads] = useState<CapturedLead[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const offs = [
      window.leadEngine.on.leadCaptured((l) => setLeads((prev) => [l, ...prev].slice(0, 500))),
      window.leadEngine.on.runChanged((r) => {
        setRunning(r.running);
        if (r.running && r.captured === 0) setLeads([]); // fresh run → clear
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  return (
    <section className="card panel grow">
      <div className="panel-head">
        <h2>Captured leads {running && <span className="pill running">live</span>}</h2>
        <span className="muted tiny">{leads.length} this run</span>
      </div>
      {leads.length === 0 ? (
        <p className="muted pad">Leads appear here live as a run scrapes them.</p>
      ) : (
        <div className="leads-scroll">
          <table className="leads">
            <thead>
              <tr>
                <th>Business</th>
                <th>Location</th>
                <th>Phone</th>
                <th>Web</th>
                <th className="num">Reviews</th>
                <th className="num">★</th>
                <th>Claimed</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.placeId + l.at}>
                  <td>
                    <div className="lead-name">{l.businessName}</div>
                    {l.category && <div className="tiny muted">{l.category}</div>}
                  </td>
                  <td className="muted">{l.address ?? "—"}</td>
                  <td className="muted">{l.phone ?? "—"}</td>
                  <td>{l.hasWebsite ? <span className="ok">yes</span> : <span className="warn">no</span>}</td>
                  <td className="num">{l.reviewCount ?? 0}</td>
                  <td className="num">{l.rating ? l.rating.toFixed(1) : "—"}</td>
                  <td>{l.claimed ? "yes" : <span className="warn">no</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

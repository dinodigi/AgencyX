import { useEffect, useState } from "react";
import type { RunState } from "../../shared/ipc.ts";

/**
 * Run controls. Kicks off a keyword+zip scrape. Defaults to the mock source
 * (dry run) — safe, no browser, no ToS exposure — so the desktop loop can be
 * driven now; unchecking "dry run" selects the real Google source once its
 * selectors are tuned against live output (§12.5).
 */
export function RunControls() {
  const [keyword, setKeyword] = useState("plumbers");
  const [zip, setZip] = useState("78704");
  const [mock, setMock] = useState(true);
  const [maxLeads, setMaxLeads] = useState(50);
  const [run, setRun] = useState<RunState>({ running: false, captured: 0 });

  useEffect(() => {
    void window.leadEngine.run.getState().then(setRun);
    return window.leadEngine.on.runChanged(setRun);
  }, []);

  return (
    <section className="card panel runctl">
      <div className="panel-head">
        <h2>Run</h2>
        {run.running && <span className="pill running">running</span>}
        {!run.running && run.lastOutcome && <span className="muted tiny">last: {run.lastOutcome}</span>}
      </div>
      <div className="runctl-body">
        <div className="row">
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="keyword" disabled={run.running} />
          <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="ZIP" disabled={run.running} className="zip" />
        </div>
        <div className="row">
          <label className="check" title="Keep runs small — the anti-detection model depends on low volume (§5.1)">
            Max leads
            <input
              type="number"
              min={1}
              max={200}
              value={maxLeads}
              onChange={(e) => setMaxLeads(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
              disabled={run.running}
              className="num-input"
            />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={mock} onChange={(e) => setMock(e.target.checked)} disabled={run.running} />
          Dry run (mock source — no browser)
        </label>
        <div className="row">
          {run.running ? (
            <button className="ghost" onClick={() => void window.leadEngine.run.stop()}>
              Stop
            </button>
          ) : (
            <>
              <button className="primary" disabled={!keyword || !zip} onClick={() => void window.leadEngine.run.start({ keyword, zip, mock, maxLeads })}>
                Start run
              </button>
              <button className="ghost" title="Claim the oldest pending query from the web queue" onClick={() => void window.leadEngine.run.claimNext()}>
                Run next queued
              </button>
            </>
          )}
          {run.captured > 0 && <span className="muted tiny">captured {run.captured}</span>}
        </div>
      </div>
    </section>
  );
}

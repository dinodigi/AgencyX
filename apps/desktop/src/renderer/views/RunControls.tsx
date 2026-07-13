import { useEffect, useState } from "react";
import type { RunState } from "../../shared/ipc.ts";
import type { TargetWebsite } from "@dinosales/types";

/**
 * Run controls. Kicks off a keyword+zip scrape with the same target options the
 * web Search page offers (website / review-count filters) — so a run started
 * here and a search queued from the web behave identically. Defaults to the mock
 * source (dry run) — safe, no browser — so the loop can be driven now; unchecking
 * "dry run" selects the real Google source (§12.5).
 */
export function RunControls() {
  const [keyword, setKeyword] = useState("plumbers");
  const [zip, setZip] = useState("78704");
  const [mock, setMock] = useState(true);
  const [maxLeads, setMaxLeads] = useState(50);
  const [targetWebsite, setTargetWebsite] = useState<TargetWebsite>("any");
  const [minReviews, setMinReviews] = useState("");
  const [maxReviews, setMaxReviews] = useState("");
  const [run, setRun] = useState<RunState>({ running: false, captured: 0 });

  useEffect(() => {
    void window.leadEngine.run.getState().then(setRun);
    return window.leadEngine.on.runChanged(setRun);
  }, []);

  function start() {
    const filter = {
      targetWebsite: targetWebsite === "any" ? undefined : targetWebsite,
      minReviews: minReviews === "" ? undefined : Math.max(0, Number(minReviews) || 0),
      maxReviews: maxReviews === "" ? undefined : Math.max(0, Number(maxReviews) || 0),
    };
    void window.leadEngine.run.start({ keyword, zip, mock, maxLeads, filter });
  }

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

        {/* Target filter — the same options as the web Search page. */}
        <div className="row">
          <label className="check" title="Target businesses by whether they already have a website">
            Website
            <select value={targetWebsite} onChange={(e) => setTargetWebsite(e.target.value as TargetWebsite)} disabled={run.running} className="num-input">
              <option value="any">Any</option>
              <option value="missing">No website</option>
              <option value="has">Has website</option>
            </select>
          </label>
        </div>
        <div className="row">
          <label className="check" title="Only keep listings with at least this many reviews">
            Min reviews
            <input type="number" min={0} value={minReviews} onChange={(e) => setMinReviews(e.target.value)} disabled={run.running} className="num-input" placeholder="any" />
          </label>
          <label className="check" title="Only keep listings with at most this many reviews (target weak listings)">
            Max reviews
            <input type="number" min={0} value={maxReviews} onChange={(e) => setMaxReviews(e.target.value)} disabled={run.running} className="num-input" placeholder="any" />
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
              <button className="primary" disabled={!keyword || !zip} onClick={start}>
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

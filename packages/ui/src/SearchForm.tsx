/**
 * The one Search form, shared by the web app and the desktop renderer so the two
 * never drift. It's a controlled component: it owns the field state and calls the
 * `onQueue` / `onRunOnDevice` callbacks the host supplies (web → server action,
 * desktop → IPC). Single vs Batch is a mode toggle, not a separate screen.
 *
 * Styling is an injected <style> block using a namespaced palette that reads
 * whichever CSS variables the host defines (web `--color-*`, desktop `--*`), so
 * it looks native in both without a shared stylesheet import.
 */

import { useMemo, useState } from "react";
import { SCRAPE_SPEEDS, type ScrapeSpeed } from "@dinosales/types";
import {
  DEFAULT_SEARCH_VALUES,
  SPEED_LABELS,
  estimateMinutes,
  formatDuration,
  normalizeSearch,
  type SearchFormValues,
  type NormalizedSearch,
} from "./search.ts";

export interface SubmitOutcome {
  ok: boolean;
  message?: string;
  error?: string;
}

export interface SearchFormProps {
  initial?: Partial<SearchFormValues>;
  /** Desktop shows a second "Start on this device" button + auto-run note. */
  showDeviceButton?: boolean;
  onQueue: (n: NormalizedSearch) => Promise<SubmitOutcome>;
  onRunOnDevice?: (n: NormalizedSearch) => Promise<SubmitOutcome>;
}

export function SearchForm({ initial, showDeviceButton, onQueue, onRunOnDevice }: SearchFormProps) {
  const [v, setV] = useState<SearchFormValues>({ ...DEFAULT_SEARCH_VALUES, ...initial });
  const [busy, setBusy] = useState<null | "queue" | "device">(null);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);

  const set = <K extends keyof SearchFormValues>(k: K, val: SearchFormValues[K]) => {
    setV((prev) => ({ ...prev, [k]: val }));
    setOutcome(null);
  };

  const norm = useMemo(() => normalizeSearch(v), [v]);
  const est = useMemo(
    () => formatDuration(estimateMinutes(norm.units, norm.maxLeads, norm.speed, norm.detailLevel)),
    [norm],
  );

  async function submit(kind: "queue" | "device") {
    if (norm.units === 0) {
      setOutcome({ ok: false, error: "Enter at least one keyword and one ZIP." });
      return;
    }
    const fn = kind === "queue" ? onQueue : onRunOnDevice;
    if (!fn) return;
    setBusy(kind);
    setOutcome(null);
    try {
      setOutcome(await fn(norm));
    } catch (e) {
      setOutcome({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const single = v.mode === "single";
  const unitLabel = norm.units === 1 ? "1 search" : `${norm.units} searches`;

  return (
    <div className="axsf">
      <style>{CSS}</style>

      <div className="axsf-head">
        <div className="axsf-title">
          <i className="axsf-dot" aria-hidden />
          <span>Search</span>
          <span className="axsf-sub">same form on web and desktop</span>
        </div>
        <div className="axsf-seg" role="tablist" aria-label="Search mode">
          <button type="button" role="tab" aria-selected={single} className={single ? "on" : ""} onClick={() => set("mode", "single")}>
            Single
          </button>
          <button type="button" role="tab" aria-selected={!single} className={!single ? "on" : ""} onClick={() => set("mode", "batch")}>
            Batch
          </button>
        </div>
      </div>

      <div className="axsf-label">What to find</div>
      <div className="axsf-grid2">
        <label>
          <span>{single ? "Keyword" : "Keywords — one per line"}</span>
          {single ? (
            <input value={v.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder="plumbers" autoComplete="off" />
          ) : (
            <textarea rows={3} value={v.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder={"plumbers\nelectricians\nroofers"} />
          )}
        </label>
        <label>
          <span>{single ? "ZIP code" : "ZIP codes — one per line"}</span>
          {single ? (
            <input value={v.zips} onChange={(e) => set("zips", e.target.value)} placeholder="90028" inputMode="numeric" autoComplete="off" />
          ) : (
            <textarea rows={3} value={v.zips} onChange={(e) => set("zips", e.target.value)} placeholder={"90028\n90038"} />
          )}
        </label>
      </div>
      <div className="axsf-grid2">
        <label>
          <span>Leads per search</span>
          <select value={v.maxLeads} onChange={(e) => set("maxLeads", Number(e.target.value))}>
            {[25, 50, 100, 150].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Detail level</span>
          <select value={v.detailLevel} onChange={(e) => set("detailLevel", e.target.value as SearchFormValues["detailLevel"])}>
            <option value="full">Full — open every listing</option>
            <option value="preview">Preview — list data only (fast)</option>
          </select>
        </label>
      </div>

      <div className="axsf-label">Keep only leads that match</div>
      <div className="axsf-grid3">
        <label>
          <span>Website</span>
          <select value={v.targetWebsite} onChange={(e) => set("targetWebsite", e.target.value as SearchFormValues["targetWebsite"])}>
            <option value="any">Any</option>
            <option value="missing">No website (best for outreach)</option>
            <option value="has">Has a website</option>
          </select>
        </label>
        <label>
          <span>Min rating</span>
          <select value={v.minRating} onChange={(e) => set("minRating", e.target.value)}>
            <option value="">Any</option>
            <option value="3">3.0+</option>
            <option value="4">4.0+</option>
            <option value="4.5">4.5+</option>
          </select>
        </label>
        <div className="axsf-pair">
          <label>
            <span>Min reviews</span>
            <input type="number" min={0} value={v.minReviews} onChange={(e) => set("minReviews", e.target.value)} placeholder="any" />
          </label>
          <label>
            <span>Max reviews</span>
            <input type="number" min={0} value={v.maxReviews} onChange={(e) => set("maxReviews", e.target.value)} placeholder="any" />
          </label>
        </div>
      </div>
      {v.detailLevel === "preview" && (
        <p className="axsf-hint">
          Preview skips opening listings — you get names, ratings, reviews, and category, but no phone / website / hours. Website
          and review filters still apply from the list data.
        </p>
      )}

      <div className="axsf-label">Automation speed</div>
      <div className="axsf-speeds">
        {SCRAPE_SPEEDS.map((s: ScrapeSpeed) => {
          const info = SPEED_LABELS[s];
          const mins = formatDuration(estimateMinutes(1, 50, s, "full"));
          return (
            <button type="button" key={s} className={`axsf-speed${v.speed === s ? " on" : ""}`} onClick={() => set("speed", s)} aria-pressed={v.speed === s}>
              <div className="axsf-speed-top">
                <span className="axsf-speed-name">{info.title}</span>
                {s === "balanced" && <span className="axsf-pill accent">default</span>}
                {info.risk && <span className="axsf-pill warn">{info.risk}</span>}
              </div>
              <div className="axsf-speed-time">50 leads ≈ {mins}</div>
              <div className="axsf-speed-blurb">{info.blurb}</div>
            </button>
          );
        })}
      </div>

      <div className="axsf-grid2">
        <label>
          <span>If a keyword × ZIP was already scraped</span>
          <select value={v.recoverage} onChange={(e) => set("recoverage", e.target.value as SearchFormValues["recoverage"])}>
            <option value="skip">Skip it (keep fresh-only)</option>
            <option value="requeue">Re-queue it for a fresh pass</option>
          </select>
        </label>
      </div>

      <div className="axsf-foot">
        <span className="axsf-est">
          {unitLabel} · up to {(norm.units * norm.maxLeads).toLocaleString()} leads · ≈ {est} at {SPEED_LABELS[norm.speed].title}
        </span>
        <div className="axsf-actions">
          <button type="button" className="axsf-btn primary" disabled={busy !== null} onClick={() => submit("queue")}>
            {busy === "queue" ? "Queuing…" : `Queue ${unitLabel}`}
          </button>
          {showDeviceButton && onRunOnDevice && (
            <button type="button" className="axsf-btn" disabled={busy !== null} onClick={() => submit("device")}>
              {busy === "device" ? "Starting…" : "Start on this device"}
            </button>
          )}
        </div>
      </div>

      {outcome && (
        <div className={`axsf-msg ${outcome.ok ? "ok" : "err"}`}>{outcome.ok ? (outcome.message ?? "Done.") : (outcome.error ?? "Something went wrong.")}</div>
      )}
    </div>
  );
}

const CSS = `
.axsf {
  --_surface: var(--color-surface, var(--surface, #0d1526));
  --_surface2: var(--color-surface-2, var(--surface-2, #16203a));
  --_bg: var(--color-bg, var(--bg, #070b15));
  --_border: var(--color-border, var(--border, #1e2b4a));
  --_ink: var(--color-ink, var(--text, #e9edf8));
  --_muted: var(--color-muted, var(--muted, #8494b2));
  --_brand: var(--color-brand, var(--brand, #7c5cff));
  --_brand2: var(--color-brand-2, var(--brand-2, #22d3ee));
  color: var(--_ink);
  font-size: 13px;
}
.axsf * { box-sizing: border-box; }
.axsf-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
.axsf-title { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 500; }
.axsf-title .axsf-sub { font-size: 12px; color: var(--_muted); font-weight: 400; }
.axsf-dot { width: 9px; height: 9px; border-radius: 50%; background-image: linear-gradient(135deg, var(--_brand), var(--_brand2)); }
.axsf-seg { display: flex; border: 1px solid var(--_border); border-radius: 9px; overflow: hidden; }
.axsf-seg button { background: transparent; border: 0; color: var(--_muted); padding: 6px 16px; font: inherit; font-size: 13px; cursor: pointer; transition: background .15s, color .15s; }
.axsf-seg button.on { background: color-mix(in srgb, var(--_brand) 18%, transparent); color: var(--_ink); font-weight: 500; }
.axsf-label { font-size: 11px; font-weight: 500; letter-spacing: .07em; text-transform: uppercase; color: var(--_muted); margin: 20px 0 8px; }
.axsf-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 12px; }
.axsf-grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.axsf-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.axsf label { display: flex; flex-direction: column; gap: 5px; }
.axsf label > span { font-size: 12px; color: var(--_muted); }
.axsf input, .axsf select, .axsf textarea {
  width: 100%; background: var(--_bg); border: 1px solid var(--_border); border-radius: 9px;
  color: var(--_ink); padding: 8px 11px; font: inherit; font-size: 13px; color-scheme: dark; transition: border-color .15s, box-shadow .15s;
}
.axsf textarea { resize: vertical; min-height: 40px; }
.axsf input:focus, .axsf select:focus, .axsf textarea:focus {
  outline: none; border-color: color-mix(in srgb, var(--_brand) 55%, var(--_border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--_brand) 18%, transparent);
}
.axsf-hint { font-size: 12px; color: var(--_muted); margin: 8px 0 0; line-height: 1.5; }
.axsf-speeds { display: grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap: 12px; }
.axsf-speed { text-align: left; background: var(--_surface); border: 1px solid var(--_border); border-radius: 12px; padding: 12px 14px; cursor: pointer; font: inherit; color: var(--_ink); transition: border-color .15s, transform .12s; }
.axsf-speed:hover { transform: translateY(-1px); }
.axsf-speed.on { border: 2px solid color-mix(in srgb, var(--_brand) 70%, transparent); padding: 11px 13px; }
.axsf-speed-top { display: flex; align-items: center; gap: 8px; }
.axsf-speed-name { font-size: 14px; font-weight: 500; }
.axsf-speed-time { font-size: 12px; color: var(--_ink); margin-top: 5px; }
.axsf-speed-blurb { font-size: 12px; color: var(--_muted); margin-top: 2px; }
.axsf-pill { font-size: 11px; padding: 1px 8px; border-radius: 999px; }
.axsf-pill.accent { background: color-mix(in srgb, var(--_brand2) 20%, transparent); color: var(--_brand2); }
.axsf-pill.warn { background: color-mix(in srgb, #f59e0b 20%, transparent); color: #f59e0b; }
.axsf-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; border-top: 1px solid var(--_border); padding-top: 14px; margin-top: 20px; }
.axsf-est { font-size: 13px; color: var(--_muted); }
.axsf-actions { display: flex; gap: 8px; }
.axsf-btn { background: var(--_surface2); border: 1px solid var(--_border); border-radius: 10px; color: var(--_ink); padding: 9px 15px; font: inherit; font-size: 13px; cursor: pointer; transition: transform .12s, filter .15s, background .15s; }
.axsf-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--_surface2) 60%, var(--_border)); }
.axsf-btn.primary { background-image: linear-gradient(135deg, var(--_brand), color-mix(in srgb, var(--_brand2) 80%, var(--_brand))); border: 0; color: #fff; font-weight: 500; }
.axsf-btn.primary:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
.axsf-btn:disabled { opacity: .55; cursor: default; }
.axsf-msg { margin-top: 12px; font-size: 13px; padding: 9px 12px; border-radius: 9px; }
.axsf-msg.ok { color: #34d399; background: color-mix(in srgb, #34d399 12%, transparent); }
.axsf-msg.err { color: #f87171; background: color-mix(in srgb, #f87171 12%, transparent); }
@media (prefers-reduced-motion: reduce) { .axsf * { transition: none !important; } }
`;

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { advanceStage } from "@/app/actions.ts";
import { STAGE_ORDER } from "@/lib/format.ts";

const STAGE_COLORS: Record<string, string> = {
  scraped: "var(--color-stage-scraped)",
  qualified: "var(--color-stage-qualified)",
  building: "var(--color-stage-building)",
  proposed: "var(--color-stage-proposed)",
  sold: "var(--color-stage-sold)",
  client: "var(--color-stage-client)",
};

/** Pipeline visual + move controls for one lead.
 *
 *  Moves in EITHER direction — Advance to the next stage, or Back to the
 *  previous one (for a mistaken click). The stage lives in local state seeded
 *  from the server prop, so the pipeline moves the instant a write succeeds
 *  (no waiting on a re-fetch); router.refresh() syncs the rest of the page, and
 *  a changed server prop (reload / live-sync) re-seeds it. Failures are always
 *  visible — a rejected move shows its reason, an unreachable action says to
 *  refresh — never a silent no-op.
 *
 *  `qualifyBlock`: safeguard reason why scraped→qualified is currently blocked
 *  (research not run/reviewable). UI-disables the Advance button; the server
 *  action enforces the same rule, so the gate holds even outside this UI. */
export function StageActions({ leadId, stage, qualifyBlock }: { leadId: string; stage: string; qualifyBlock?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [current, setCurrent] = useState(stage);

  useEffect(() => setCurrent(stage), [stage]);

  const idx = STAGE_ORDER.indexOf(current as (typeof STAGE_ORDER)[number]);
  const next = idx >= 0 && idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;
  const prev = idx > 0 ? STAGE_ORDER[idx - 1] : null;

  function move(target: string) {
    setMsg(null);
    start(async () => {
      try {
        const fd = new FormData();
        fd.append("leadId", leadId);
        fd.append("toStage", target);
        const res = await advanceStage({ ok: false }, fd);
        if (res.ok) {
          setCurrent(res.stage ?? target);
          setMsg({ ok: true, text: `Moved to ${res.stage ?? target}.` });
          router.refresh();
        } else {
          setMsg({ ok: false, text: res.error ?? "Couldn't move this lead." });
        }
      } catch {
        setMsg({ ok: false, text: "Couldn't reach the server — refresh the page and try again." });
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Pipeline: dot + connector per stage; done = filled, current = pulsing ring. */}
      <div className="flex items-center overflow-x-auto pb-1">
        {STAGE_ORDER.map((s, i) => {
          const done = i < idx;
          const isCurrent = i === idx;
          const color = STAGE_COLORS[s]!;
          return (
            <div key={s} className="flex items-center" style={{ flex: i < STAGE_ORDER.length - 1 ? "1 0 auto" : "0 0 auto" }}>
              <div className="flex min-w-16 flex-col items-center gap-1.5">
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full border-2 text-[10px] font-bold ${isCurrent ? "pulse-dot" : ""}`}
                  style={
                    done || isCurrent
                      ? { background: color, borderColor: color, color: "#0b1220" }
                      : { borderColor: "var(--color-border)", color: "var(--color-muted)" }
                  }
                >
                  {done ? "✓" : i + 1}
                </span>
                <span
                  className="text-[11px] font-medium capitalize whitespace-nowrap"
                  style={{ color: isCurrent ? color : done ? "var(--color-ink)" : "var(--color-muted)" }}
                >
                  {s}
                </span>
              </div>
              {i < STAGE_ORDER.length - 1 && (
                <span className="mx-1 mb-5 h-0.5 min-w-6 flex-1 rounded-full" style={{ background: i < idx ? color : "var(--color-border)" }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Move controls */}
      <div className="flex flex-wrap items-center gap-3">
        {prev && (
          <button
            type="button"
            onClick={() => move(prev)}
            disabled={pending}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] disabled:opacity-50"
          >
            ← Back to {prev}
          </button>
        )}
        {next ? (
          next === "qualified" && qualifyBlock ? (
            <span className="flex items-center gap-2">
              <button type="button" disabled title={qualifyBlock} className="btn-primary cursor-not-allowed px-4 py-2 text-sm opacity-40">
                Advance to qualified →
              </button>
              <span className="text-sm text-[var(--color-stage-building)]">{qualifyBlock}</span>
            </span>
          ) : (
            <button type="button" onClick={() => move(next)} disabled={pending} className="btn-primary px-4 py-2 text-sm">
              {pending ? "Moving…" : `Advance to ${next} →`}
            </button>
          )
        ) : (
          <span className="text-sm text-[var(--color-stage-client)]">Pipeline complete — this lead is a client.</span>
        )}
        {msg && <span className={`text-sm ${msg.ok ? "text-[var(--color-stage-sold)]" : "text-red-400"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}

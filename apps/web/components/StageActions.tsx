"use client";

import { useActionState } from "react";
import { advanceStage, type StageResult } from "@/app/actions.ts";
import { STAGE_ORDER } from "@/lib/format.ts";

const STAGE_COLORS: Record<string, string> = {
  scraped: "var(--color-stage-scraped)",
  qualified: "var(--color-stage-qualified)",
  building: "var(--color-stage-building)",
  proposed: "var(--color-stage-proposed)",
  sold: "var(--color-stage-sold)",
  client: "var(--color-stage-client)",
};

const INITIAL: StageResult = { ok: false };

/** Pipeline visual + "advance to next stage" action for one lead. */
export function StageActions({ leadId, stage }: { leadId: string; stage: string }) {
  const [state, action, pending] = useActionState(advanceStage, INITIAL);
  const idx = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  const next = idx >= 0 && idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;

  return (
    <div className="flex flex-col gap-5">
      {/* Pipeline: dot + connector per stage; done = filled, current = pulsing ring. */}
      <div className="flex items-center overflow-x-auto pb-1">
        {STAGE_ORDER.map((s, i) => {
          const done = i < idx;
          const current = i === idx;
          const color = STAGE_COLORS[s]!;
          return (
            <div key={s} className="flex items-center" style={{ flex: i < STAGE_ORDER.length - 1 ? "1 0 auto" : "0 0 auto" }}>
              <div className="flex min-w-16 flex-col items-center gap-1.5">
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full border-2 text-[10px] font-bold ${current ? "pulse-dot" : ""}`}
                  style={
                    done || current
                      ? { background: color, borderColor: color, color: "#0b1220" }
                      : { borderColor: "var(--color-border)", color: "var(--color-muted)" }
                  }
                >
                  {done ? "✓" : i + 1}
                </span>
                <span
                  className="text-[11px] font-medium capitalize whitespace-nowrap"
                  style={{ color: current ? color : done ? "var(--color-ink)" : "var(--color-muted)" }}
                >
                  {s}
                </span>
              </div>
              {i < STAGE_ORDER.length - 1 && (
                <span
                  className="mx-1 mb-5 h-0.5 min-w-6 flex-1 rounded-full"
                  style={{ background: i < idx ? color : "var(--color-border)" }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Advance action */}
      <div className="flex items-center gap-3">
        {next ? (
          <form action={action}>
            <input type="hidden" name="leadId" value={leadId} />
            <input type="hidden" name="toStage" value={next} />
            <button type="submit" disabled={pending} className="btn-primary px-4 py-2 text-sm">
              {pending ? "Moving…" : `Advance to ${next} →`}
            </button>
          </form>
        ) : (
          <span className="text-sm text-[var(--color-stage-client)]">Pipeline complete — this lead is a client.</span>
        )}
        {state.error && <span className="text-sm text-red-400">{state.error}</span>}
        {state.ok && <span className="text-sm text-[var(--color-stage-sold)]">Moved to {state.stage}.</span>}
      </div>
    </div>
  );
}

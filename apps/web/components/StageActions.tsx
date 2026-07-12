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

/** Pipeline bar + "advance to next stage" action for one lead. */
export function StageActions({ leadId, stage }: { leadId: string; stage: string }) {
  const [state, action, pending] = useActionState(advanceStage, INITIAL);
  const idx = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  const next = idx >= 0 && idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Pipeline visual */}
      <div className="flex items-center gap-1 overflow-x-auto">
        {STAGE_ORDER.map((s, i) => {
          const done = i < idx;
          const current = i === idx;
          return (
            <div key={s} className="flex items-center gap-1">
              <span
                className="rounded-full px-3 py-1 text-xs font-medium capitalize whitespace-nowrap"
                style={
                  current
                    ? { background: STAGE_COLORS[s], color: "#0b1220" }
                    : done
                      ? { background: "color-mix(in srgb, var(--color-stage-sold) 30%, transparent)", color: "var(--color-ink)" }
                      : { border: "1px solid var(--color-border)", color: "var(--color-muted)" }
                }
              >
                {s}
              </span>
              {i < STAGE_ORDER.length - 1 && <span className="text-[var(--color-border)]">→</span>}
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
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-[var(--color-brand-fg)] disabled:opacity-50"
            >
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

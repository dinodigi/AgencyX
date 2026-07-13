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

/** Pipeline visual + "advance to next stage" for one lead.
 *
 *  The stage is tracked in local state seeded from the server prop, so a
 *  successful advance moves the pipeline IMMEDIATELY — we don't wait for a
 *  re-fetch to re-render (that round-trip is why it looked like nothing
 *  happened). router.refresh() still runs to sync the rest of the page, and a
 *  changed server prop (manual reload or live-sync) re-seeds local state.
 *
 *  Failures are always visible: a rejected transition shows its message; an
 *  unreachable action (e.g. a tab left open across a redeploy) says to refresh —
 *  never a silent no-op. */
export function StageActions({ leadId, stage }: { leadId: string; stage: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [current, setCurrent] = useState(stage);

  // Re-seed from the server if it changes underneath us (reload / live-sync).
  useEffect(() => setCurrent(stage), [stage]);

  const idx = STAGE_ORDER.indexOf(current as (typeof STAGE_ORDER)[number]);
  const next = idx >= 0 && idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;

  function advance() {
    if (!next) return;
    const target = next;
    setMsg(null);
    start(async () => {
      try {
        const fd = new FormData();
        fd.append("leadId", leadId);
        fd.append("toStage", target);
        const res = await advanceStage({ ok: false }, fd);
        if (res.ok) {
          setCurrent(res.stage ?? target); // move the pipeline now
          setMsg({ ok: true, text: `Moved to ${res.stage ?? target}.` });
          router.refresh(); // sync the header badge + other sections
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

      {/* Advance action */}
      <div className="flex items-center gap-3">
        {next ? (
          <button type="button" onClick={advance} disabled={pending} className="btn-primary px-4 py-2 text-sm">
            {pending ? "Moving…" : `Advance to ${next} →`}
          </button>
        ) : (
          <span className="text-sm text-[var(--color-stage-client)]">Pipeline complete — this lead is a client.</span>
        )}
        {msg && <span className={`text-sm ${msg.ok ? "text-[var(--color-stage-sold)]" : "text-red-400"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}

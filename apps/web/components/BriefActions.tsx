"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { scoreAndBrief } from "@/app/actions.ts";

/** Manual trigger for scoring + the Claude brief (tokens cost — never automatic).
 *  Runs PageSpeed + deterministic scoring, then one Claude pass; ~1–2 minutes. */
export function BriefActions({ qualId, leadId, briefed }: { qualId: string; leadId: string; briefed: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onRun() {
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.append("qualId", qualId);
      fd.append("leadId", leadId);
      const res = await scoreAndBrief({ ok: false }, fd);
      setMsg(res.ok ? { ok: true, text: res.message ?? "Done." } : { ok: false, text: res.error ?? "Failed." });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={onRun} disabled={pending} className="btn-primary px-4 py-2 text-sm">
        {pending ? "Scoring + writing brief… (~1–2 min)" : briefed ? "Regenerate score + brief" : "Score + generate AI brief"}
      </button>
      {msg && <span className={`text-sm ${msg.ok ? "text-[var(--color-stage-sold)]" : "text-red-400"}`}>{msg.text}</span>}
    </div>
  );
}

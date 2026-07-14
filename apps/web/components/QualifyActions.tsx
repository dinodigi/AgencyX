"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { queueQualification } from "@/app/actions.ts";

/** Queue (or re-queue) the lead's deep-research qualification job. */
export function QualifyActions({ leadId, status }: { leadId: string; status?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // While a job is queued/being collected there is nothing to click — the row
  // moves on its own (live-sync refreshes the page as statuses change).
  const actionable = !status || status === "failed";
  const label = status === "failed" ? "Retry qualification" : "Qualify this lead";

  function onQueue() {
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.append("leadId", leadId);
      const res = await queueQualification({ ok: false }, fd);
      setMsg(res.ok ? { ok: true, text: res.message ?? "Queued." } : { ok: false, text: res.error ?? "Couldn't queue." });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      {actionable && (
        <button onClick={onQueue} disabled={pending} className="btn-primary px-3 py-1.5 text-sm">
          {pending ? "Queuing…" : label}
        </button>
      )}
      {msg && <span className={`text-sm ${msg.ok ? "text-[var(--color-stage-sold)]" : "text-red-400"}`}>{msg.text}</span>}
    </div>
  );
}

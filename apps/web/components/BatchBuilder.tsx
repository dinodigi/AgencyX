"use client";

import { useActionState } from "react";
import { createBatch, type BatchResult } from "@/app/actions.ts";

const INITIAL: BatchResult = { ok: false };

export function BatchBuilder() {
  const [state, action, pending] = useActionState(createBatch, INITIAL);

  const ta =
    "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-ink)] font-mono";

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Keywords</span>
          <span className="text-xs text-[var(--color-muted)]">one per line (or comma-separated)</span>
          <textarea name="keywords" rows={8} className={ta} placeholder={"plumbers\nroofers\nhvac"} />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">ZIP codes</span>
          <span className="text-xs text-[var(--color-muted)]">one per line (or comma-separated)</span>
          <textarea name="zips" rows={8} className={ta} placeholder={"78704\n78745\n78702"} />
        </label>
      </div>

      <label className="flex items-center gap-3 text-sm">
        <span className="font-medium">Leads per search</span>
        <input
          name="maxLeads"
          type="number"
          min={1}
          max={200}
          defaultValue={50}
          className="w-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-ink)]"
        />
        <span className="text-xs text-[var(--color-muted)]">the desktop scraper stops at this many per search (keep it small)</span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-[var(--color-brand-fg)] disabled:opacity-50"
        >
          {pending ? "Creating…" : "Queue searches"}
        </button>

        {state.error && <span className="text-sm text-red-400">{state.error}</span>}
        {state.ok && (
          <span className="text-sm text-[var(--color-stage-sold)]">
            Queued: {state.created} new · {state.existing} already covered · {state.total} total. Open the desktop app → “Run
            next queued”.
          </span>
        )}
      </div>
    </form>
  );
}

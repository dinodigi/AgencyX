"use client";

import { useActionState } from "react";
import { createSearch, type SearchResult } from "@/app/actions.ts";

const INITIAL: SearchResult = { ok: false };

/**
 * Single search with target options — the richer sibling of the batch builder.
 * One keyword × ZIP, plus the "who to keep" filter (website / review counts)
 * that the desktop applies while scraping. Same options as the desktop Run panel.
 */
export function SearchForm() {
  const [state, action, pending] = useActionState(createSearch, INITIAL);

  const inp =
    "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-ink)]";

  return (
    <form action={action} className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Keyword</span>
          <input name="keyword" className={inp} placeholder="plumbers" autoComplete="off" />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">ZIP code</span>
          <input name="zip" className={inp} placeholder="90028" autoComplete="off" inputMode="numeric" />
        </label>
      </div>

      <fieldset className="flex flex-col gap-4 rounded-xl border border-[var(--color-border)] p-4">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Target — which businesses to keep
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Website</span>
            <select name="target_website" className={inp} defaultValue="any">
              <option value="any">Any</option>
              <option value="missing">No website (best for outreach)</option>
              <option value="has">Has a website</option>
            </select>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Min reviews</span>
            <input name="min_reviews" type="number" min={0} className={inp} placeholder="any" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Max reviews</span>
            <input name="max_reviews" type="number" min={0} className={inp} placeholder="any" />
          </label>
        </div>
        <p className="text-xs text-[var(--color-muted)]">
          The desktop scraper opens each listing and keeps only businesses that match. Leave a field blank to skip it.
        </p>
      </fieldset>

      <label className="flex items-center gap-3 text-sm">
        <span className="font-medium">Leads per search</span>
        <input name="maxLeads" type="number" min={1} max={200} defaultValue={50} className="w-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-ink)]" />
        <span className="text-xs text-[var(--color-muted)]">the scraper stops after this many matches (keep it small)</span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-[var(--color-brand-fg)] disabled:opacity-50"
        >
          {pending ? "Queuing…" : "Queue search"}
        </button>
        {state.error && <span className="text-sm text-red-400">{state.error}</span>}
        {state.ok && (
          <span className="text-sm text-[var(--color-stage-sold)]">
            {state.existing ? "Updated & re-queued" : "Queued"} “{state.keyword}” in {state.zip}. Open the desktop app → “Run
            next queued”.
          </span>
        )}
      </div>
    </form>
  );
}

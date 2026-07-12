"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Lead-table filters. Delivery reads are equality-only, so these map to the
 * precomputed fields (has_website, review_bucket, claimed, stage) — no range
 * queries needed. State lives in the URL so views are shareable/bookmarkable.
 */
export function LeadFilters() {
  const router = useRouter();
  const params = useSearchParams();

  const set = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.push(`/leads?${next.toString()}`);
    },
    [params, router],
  );

  const sel = "rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm text-[var(--color-ink)]";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={sel} value={params.get("stage") ?? ""} onChange={(e) => set("stage", e.target.value)}>
        <option value="">All stages</option>
        {["scraped", "qualified", "building", "proposed", "sold", "client"].map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select className={sel} value={params.get("has_website") ?? ""} onChange={(e) => set("has_website", e.target.value)}>
        <option value="">Website: any</option>
        <option value="false">No website</option>
        <option value="true">Has website</option>
      </select>

      <select className={sel} value={params.get("review_bucket") ?? ""} onChange={(e) => set("review_bucket", e.target.value)}>
        <option value="">Reviews: any</option>
        {["none", "low", "medium", "high"].map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>

      <select className={sel} value={params.get("claimed") ?? ""} onChange={(e) => set("claimed", e.target.value)}>
        <option value="">Claimed: any</option>
        <option value="false">Unclaimed</option>
        <option value="true">Claimed</option>
      </select>

      {/* ZIP lives on search_queries, not leads — filter by coverage instead.
          A lead-level ZIP filter needs relation-hop support in the client wrapper (TODO). */}
    </div>
  );
}

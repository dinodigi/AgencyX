"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { Leads } from "@dinosales/agentx-client";
import { deleteLeads } from "@/app/actions.ts";
import { StageBadge } from "@/components/ui.tsx";

/**
 * The leads table with row selection + delete. Rows are fetched on the server
 * and passed in; selection/delete is client-side (the server list stays a plain
 * data fetch). Delete calls the deleteLeads server action, then refreshes.
 */
export function LeadsTable({ rows }: { rows: Leads[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = selected.size > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(ids)));
  }

  function onDelete() {
    const targets = [...selected];
    if (targets.length === 0) return;
    const label = targets.length === 1 ? "this lead" : `${targets.length} leads`;
    if (!window.confirm(`Delete ${label}? This can't be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteLeads(targets);
      if (!res.ok) {
        setError(res.error ?? "Delete failed.");
        return;
      }
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Selection toolbar — only occupies space once something is selected. */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <button
            onClick={onDelete}
            disabled={pending}
            className="rounded-md bg-red-500/90 px-3 py-1.5 font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {pending ? "Deleting…" : `Delete ${selected.size}`}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-[var(--color-muted)] hover:text-[var(--color-ink)]">
            Clear
          </button>
          {error && <span className="text-red-400">{error}</span>}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" className="cursor-pointer" />
                </th>
                <Th>Business</Th>
                <Th>Category</Th>
                <Th>Website</Th>
                <Th>Reviews</Th>
                <Th>Rating</Th>
                <Th>Claimed</Th>
                <Th>Stage</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const checked = selected.has(l.id);
                return (
                  <tr
                    key={l.id}
                    className={`border-b border-[var(--color-border)] last:border-0 ${checked ? "bg-[var(--color-surface-2)]" : ""}`}
                  >
                    <Td>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(l.id)}
                        aria-label={`Select ${l.business_name}`}
                        className="cursor-pointer"
                      />
                    </Td>
                    <Td>
                      <Link
                        href={`/leads/${l.id}`}
                        className="font-medium hover:text-[var(--color-stage-qualified)] hover:underline"
                      >
                        {l.business_name}
                      </Link>
                      <div className="text-xs text-[var(--color-muted)]">{l.phone ?? l.address ?? ""}</div>
                    </Td>
                    <Td className="text-[var(--color-muted)]">{l.category ?? "—"}</Td>
                    <Td>
                      {l.has_website && l.website ? (
                        <a
                          href={l.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--color-stage-qualified)] hover:underline"
                        >
                          site ↗
                        </a>
                      ) : (
                        <span className="text-[var(--color-muted)]">none</span>
                      )}
                    </Td>
                    <Td>{l.review_count ?? 0}</Td>
                    <Td>{l.rating ? l.rating.toFixed(1) : "—"}</Td>
                    <Td>{l.claimed ? "yes" : <span className="text-[var(--color-stage-building)]">no</span>}</Td>
                    <Td>
                      <StageBadge stage={l.stage} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-medium">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}

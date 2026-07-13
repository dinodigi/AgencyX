"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteLeads } from "@/app/actions.ts";

/** Delete this lead from its detail page, then return to the list. */
export function DeleteLeadButton({ leadId, name }: { leadId: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteLeads([leadId]);
      if (!res.ok) {
        setError(res.error ?? "Delete failed.");
        return;
      }
      router.push("/leads");
    });
  }

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-sm text-red-400">{error}</span>}
      <button
        onClick={onDelete}
        disabled={pending}
        className="rounded-lg border border-red-500/40 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete lead"}
      </button>
    </div>
  );
}

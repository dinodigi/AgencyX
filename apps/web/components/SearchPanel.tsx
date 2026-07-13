"use client";

import { useRouter } from "next/navigation";
import { SearchForm } from "@dinosales/ui/SearchForm";
import type { NormalizedSearch } from "@dinosales/ui/search";
import type { SearchMode } from "@dinosales/ui/search";
import { queueSearch } from "@/app/actions.ts";

/**
 * Web host for the shared SearchForm. The form owns all field state; this only
 * wires its Queue action to the server action and refreshes so Coverage reflects
 * the new units. The web can't scrape, so there's no "run on this device".
 */
export function SearchPanel({ initialMode }: { initialMode?: SearchMode }) {
  const router = useRouter();

  async function onQueue(n: NormalizedSearch) {
    const res = await queueSearch(n);
    if (res.ok) router.refresh();
    return { ok: res.ok, message: res.message, error: res.error };
  }

  return <SearchForm initial={initialMode ? { mode: initialMode } : undefined} onQueue={onQueue} />;
}

"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a server-rendered page fresh without a manual reload. Every `intervalMs`
 * (only while the tab is visible) it asks /api/changes whether any WATCHED
 * collection changed since its cursor; if so it calls router.refresh() to re-run
 * the server component with new data. The first poll just establishes the cursor
 * (the page was just rendered), so it never double-fetches on load.
 *
 * Web uses polling (not SSE): the browser can't put an auth header on an
 * EventSource, and we won't leak a token in a URL. The desktop, a persistent
 * process, streams instead.
 */
export function LiveRefresh({ watch, intervalMs = 10000 }: { watch: string[]; intervalMs?: number }) {
  const router = useRouter();
  const cursor = useRef<string>("");
  const primed = useRef(false);
  const qs = watch.join(","); // stable dep (a new array literal each render would re-prime)

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    async function tick() {
      if (document.hidden) return;
      try {
        const q = new URLSearchParams({ collections: qs });
        if (cursor.current) q.set("since", cursor.current);
        const res = await fetch(`/api/changes?${q.toString()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { cursor?: string; collections?: string[] };
        if (data.cursor) cursor.current = data.cursor;
        // Skip the priming poll; refresh only once we've been watching from a cursor.
        if (primed.current && data.collections && data.collections.length > 0) {
          router.refresh();
        }
        primed.current = true;
      } catch {
        /* transient — try again next tick */
      }
    }

    void tick();
    timer = setInterval(tick, intervalMs);
    // Catch up immediately when the tab regains focus.
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [qs, intervalMs, router]);

  return null;
}

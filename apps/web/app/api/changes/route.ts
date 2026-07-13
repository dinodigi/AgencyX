import { NextResponse } from "next/server";
import { withClient } from "@/lib/agentx.ts";

export const dynamic = "force-dynamic";

/**
 * Same-origin change-feed probe for the client's LiveRefresh poller. Runs the
 * delivery change feed server-side (so the delivery token + the user's JWT never
 * touch the browser) and reports which watched collections changed since the
 * caller's cursor. The feed's ETag makes an idle poll cheap upstream.
 */
export async function GET(req: Request) {
  const ctx = await withClient();
  if (!ctx) return NextResponse.json({ cursor: "", collections: [] });

  const url = new URL(req.url);
  const since = url.searchParams.get("since") ?? undefined;
  const watch = (url.searchParams.get("collections") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const res = await ctx.ax.changes.poll({ since, collections: watch.length ? watch : undefined });
    const collections = [...new Set(res.changes.map((c) => c.collection))];
    return NextResponse.json({ cursor: res.cursor || since || "", collections });
  } catch {
    // Soft-fail: the poller just tries again next tick.
    return NextResponse.json({ cursor: since ?? "", collections: [] });
  }
}

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Unauthenticated liveness probe for Render's health check. */
export function GET() {
  return NextResponse.json({ ok: true, service: "lead-engine-web" });
}

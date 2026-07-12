import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Clerk middleware makes `auth()` available in Server Components/Actions. It does
 * NOT protect routes by itself (no auth.protect() here) — page-level getSession()
 * decides. Progressive: with no Clerk secret configured it's a pass-through, so
 * the app still runs on the dev-stub auth (env/cookie).
 */
const enabled = Boolean(process.env.CLERK_SECRET_KEY);

export default enabled ? clerkMiddleware() : () => NextResponse.next();

export const config = {
  // Run on everything except static assets and Next internals.
  matcher: ["/((?!_next|.*\\..*).*)"],
};

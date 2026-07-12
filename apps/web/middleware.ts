import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Standard Clerk middleware — REQUIRED for auth()/getToken() in Server
 * Components & Route Handlers to detect the session. Must be the direct default
 * export (a conditional/ternary export breaks Clerk's clerkMiddleware detection).
 *
 * Clerk keys (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY) are required
 * at runtime. `next build` does not execute middleware, so the build stays green
 * without keys; a running server needs them.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Run on everything except Next internals and static files…
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ico|webp|woff2?|ttf|map)).*)",
    // …and always on API routes.
    "/(api|trpc)(.*)",
  ],
};

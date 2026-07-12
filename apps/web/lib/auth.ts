import "server-only";
import { cookies } from "next/headers";

/**
 * Auth boundary. A session is the end-user's org id + their Clerk JWT, used to
 * scope every AgentX delivery call. This is the ONE place the app learns who the
 * user is.
 *
 * Two modes, chosen at runtime:
 *  - Clerk (when CLERK_SECRET_KEY is set): the real flow — auth() gives the
 *    active org id, getToken() mints the session JWT forwarded as X-User-Token.
 *  - Dev stub (otherwise): a pasted JWT + org id via env or cookie, so the app
 *    runs before Clerk is configured. Keeps `next build` green with no env.
 */

export interface Session {
  orgId: string;
  userToken: string;
}

// Read at call time (not module load) so an env change + hot reload can't leave
// a stale value that disagrees with the middleware.
function clerkEnabled(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY);
}

export function isClerkEnabled(): boolean {
  return clerkEnabled();
}

/**
 * Richer than getSession so the UI can distinguish "signed out" from "signed in
 * but no active organization" — an authed user with no org must be shown an org
 * picker, NOT a "not signed in" screen.
 */
export type AuthStatus = "signed-out" | "no-org" | "ready";

export async function getAuthStatus(): Promise<AuthStatus> {
  if (!clerkEnabled()) return (await getDevSession()) ? "ready" : "signed-out";
  try {
    const { auth } = await import("@clerk/nextjs/server");
    const { userId, orgId } = await auth();
    if (!userId) return "signed-out";
    if (!orgId) return "no-org";
    return "ready";
  } catch (err) {
    // Most common: clerkMiddleware() isn't active for this request yet — e.g. the
    // env changed without a full server restart. Degrade to signed-out instead of
    // 500-ing the page; a restart makes auth() work.
    console.error("getAuthStatus: Clerk auth() failed (restart the dev server after env changes):", err);
    return "signed-out";
  }
}

export async function getSession(): Promise<Session | null> {
  if (!clerkEnabled()) return getDevSession();
  try {
    return await getClerkSession();
  } catch (err) {
    console.error("getSession: Clerk auth() failed (restart the dev server after env changes):", err);
    return null;
  }
}

async function getClerkSession(): Promise<Session | null> {
  // Dynamic import so @clerk/nextjs/server never loads in dev-stub mode.
  const { auth } = await import("@clerk/nextjs/server");
  const { orgId, getToken } = await auth();
  if (!orgId) return null; // signed in but no active org ⇒ can't scope org data
  // Default session token. If AgentX's org_id/org_role claims aren't present,
  // set a Clerk JWT template named "agentx" and pass { template: "agentx" }.
  const userToken = await getToken();
  if (!userToken) return null;
  return { orgId, userToken };
}

async function getDevSession(): Promise<Session | null> {
  const envToken = process.env.AGENTX_DEV_USER_TOKEN;
  const envOrg = process.env.AGENTX_DEV_ORG_ID;
  if (envToken && envOrg) return { orgId: envOrg, userToken: envToken };

  const jar = await cookies();
  const cookieToken = jar.get("le_user_token")?.value;
  const cookieOrg = jar.get("le_org_id")?.value;
  if (cookieToken && cookieOrg) return { orgId: cookieOrg, userToken: cookieToken };

  return null;
}

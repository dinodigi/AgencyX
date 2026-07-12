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

const clerkEnabled = Boolean(process.env.CLERK_SECRET_KEY);

export function isClerkEnabled(): boolean {
  return clerkEnabled;
}

export async function getSession(): Promise<Session | null> {
  if (clerkEnabled) return getClerkSession();
  return getDevSession();
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

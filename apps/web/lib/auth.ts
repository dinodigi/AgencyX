import "server-only";
import { cookies } from "next/headers";

/**
 * Auth boundary. A session is the end-user's org id + their Clerk JWT, used to
 * scope every AgentX delivery call. This is the ONE place the app learns who the
 * user is — swap the dev stub for @clerk/nextjs's `auth()` when Clerk is wired.
 *
 * Dev stub: reads a JWT + org id from env (single-tenant local dev) or from a
 * cookie set by a throwaway sign-in. Returns null when neither is present, which
 * renders the signed-out state instead of hitting AgentX with no identity.
 */

export interface Session {
  orgId: string;
  userToken: string;
}

export async function getSession(): Promise<Session | null> {
  // TODO(Clerk): const { getToken, orgId } = await auth(); return orgId ? { orgId, userToken: await getToken() } : null;
  const envToken = process.env.AGENTX_DEV_USER_TOKEN;
  const envOrg = process.env.AGENTX_DEV_ORG_ID;
  if (envToken && envOrg) return { orgId: envOrg, userToken: envToken };

  const jar = await cookies();
  const cookieToken = jar.get("le_user_token")?.value;
  const cookieOrg = jar.get("le_org_id")?.value;
  if (cookieToken && cookieOrg) return { orgId: cookieOrg, userToken: cookieToken };

  return null;
}

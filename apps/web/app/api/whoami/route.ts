import { NextResponse } from "next/server";
import { getSession, isClerkEnabled } from "@/lib/auth.ts";

export const dynamic = "force-dynamic";

/**
 * Diagnostic: decode the current session token and report whether it carries the
 * claims AgentX's access rules require (flat `org_id` + `org_role`). Hit this
 * signed in to confirm Clerk is "good to go" for multi-tenant scoping. Decodes
 * only — no signature verification (that's AgentX's job); never logs the token.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ mode: isClerkEnabled() ? "clerk" : "dev-stub", signedIn: false }, { status: 401 });
  }

  const claims = decodeJwtPayload(session.userToken) ?? {};
  const hasOrgId = typeof claims.org_id === "string" && claims.org_id.length > 0;
  const hasOrgRole = typeof claims.org_role === "string" && claims.org_role.length > 0;

  return NextResponse.json({
    mode: isClerkEnabled() ? "clerk" : "dev-stub",
    signedIn: true,
    activeOrgId: session.orgId,
    claims: {
      // Report just the claims that matter for AgentX scoping (not the whole token).
      org_id: claims.org_id ?? null,
      org_role: claims.org_role ?? null,
      sub: claims.sub ?? null,
      iss: claims.iss ?? null,
    },
    agentxReady: hasOrgId && hasOrgRole,
    hint:
      hasOrgId && hasOrgRole
        ? "Token carries org_id + org_role — AgentX org scoping will work."
        : "Missing flat org_id/org_role. In Clerk → Sessions → Customize session token add: { \"org_id\": \"{{org.id}}\", \"org_role\": \"{{org.role}}\" }",
  });
}

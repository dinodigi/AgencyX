/**
 * Release gate: prove AGENTX_DELIVERY_TOKEN is really delivery-scoped BEFORE it
 * gets baked into an installer.
 *
 * Why this exists: v0.1.1 shipped with the MCP token sitting under the delivery
 * token's variable name. Nothing checked, so a full-trust credential — one that
 * bypasses org scoping across every tenant — went into a public binary, and we
 * only found out when the installed app failed at runtime. A variable's name is
 * not evidence of what's in it; only the API's answer is.
 *
 * How it discriminates: the delivery API rejects an MCP token with a specific
 * "mcp-scoped (authoring)" error. A delivery token gets PAST that check and
 * then succeeds, or fails for an unrelated reason (no X-User-Token, so no org
 * rows are readable). So we look for that one marker rather than for overall
 * success — a 401 about a missing user token is a healthy result here.
 *
 * Two ways to fail, both observed against the live API:
 *   - "mcp-scoped (authoring)"          → right project, wrong kind of token
 *   - "invalid or missing project token" → not accepted at all (typo, revoked)
 * Anything else passes: a valid delivery token clears project-token auth and
 * then succeeds, or fails further in about the missing X-User-Token, which is
 * the healthy result here.
 *
 * Exit 0 = safe to bake. Exit 1 = stop the release.
 */
import { existsSync } from "node:fs";

const BASE = (process.env.AGENTX_BASE_URL ?? "https://pluggie.app/api/v1").replace(/\/+$/, "");

// CI passes the token as env. Locally, fall back to .env so you can check the
// value before it ever reaches a repo secret — where you can't read it back.
if (!process.env.AGENTX_DELIVERY_TOKEN && existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* ignore */
  }
}
const token = process.env.AGENTX_DELIVERY_TOKEN;

// Set the exit code and return rather than process.exit(): killing the process
// while undici's socket is still closing trips a libuv assertion on Windows,
// which turns a clean "1" into a crash dump.
function fail(msg) {
  console.error(`\n✗ token check FAILED\n  ${msg}\n`);
  process.exitCode = 1;
}

async function main() {
  if (!token) {
    return fail("AGENTX_DELIVERY_TOKEN is not set. A tagged release must bake a delivery token in.");
  }

  // Never print the token, a prefix, or a hash — CI logs are readable by anyone
  // with repo access, and this is exactly the class of value that leaked.
  console.log(`Checking AGENTX_DELIVERY_TOKEN scope against ${BASE} …`);

  let res;
  let body = "";
  try {
    res = await fetch(`${BASE}/agencies?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    body = await res.text();
  } catch (e) {
    // Fail closed. A release is rare and re-runnable; shipping an unverified
    // credential is not.
    return fail(`Could not reach the delivery API to verify the token: ${e instanceof Error ? e.message : String(e)}`);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* non-JSON body — fall back to matching the raw text */
  }
  const err = String(parsed?.error ?? body ?? "");

  if (/mcp[-\s]?scoped|authoring/i.test(err)) {
    return fail(
      "This is the MCP token, not a delivery token.\n" +
        "  The MCP token is full-trust: it bypasses org scoping across every tenant.\n" +
        "  Baking it into an installer publishes it. See agentx/TOKENS.md.\n" +
        "  Fix: mint a delivery token (project Settings → Tokens) and replace the\n" +
        "  AGENTX_DELIVERY_TOKEN repo secret with it.",
    );
  }

  if (/invalid or missing project token/i.test(err)) {
    return fail(
      `The delivery API rejected this token outright (${res.status} ${parsed?.code ?? ""}).\n` +
        "  It's mistyped, truncated, revoked, or from another project — shipping it\n" +
        "  would produce an installer that can't reach AgentX at all.",
    );
  }

  console.log(`✓ delivery-scoped (API replied ${res.status}) — safe to bake in\n`);
}

await main();

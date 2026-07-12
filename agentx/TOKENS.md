# AgentX tokens

AgentX issues two kinds of `agx_…` token. Use the right one in the right place.

| | **Delivery token** | **MCP token** |
|---|---|---|
| Endpoint | `/api/v1/*` (delivery API) | `/api/mcp` (JSON-RPC) |
| Trust | Project-scoped. **Can't read any data by itself** — every org-scoped read/write also needs the end-user's Clerk JWT (`X-User-Token`). | **Full-trust.** Bypasses org scoping; can do schema + CRUD across all orgs. |
| Safe to distribute? | Yes — it's a project identifier, useless without a valid JWT. Fine to bake into the desktop app. | **No.** Own-infra/server-side only. Never in a tenant app or the browser. |
| Env var | `AGENTX_DELIVERY_TOKEN` | `AGENTX_MCP_TOKEN` |

## Who uses which

| Component | Token | Why |
|---|---|---|
| Web app (`apps/web`) | **Delivery** | Server-only; attaches the signed-in user's Clerk JWT per request. |
| Desktop app (`apps/desktop`) | **Delivery** | Ships to user machines; JWT (from Clerk sign-in) does the scoping. |
| Replicator (`apps/replicator`) | **MCP** | Full-trust `get_changes` over the whole project. Own infra only. |
| Qualification svc (Phase 3) | **MCP** | Needs `update_entry_if` / `transact` (MCP-only). Own infra only. |
| `~/.claude.json` MCP server / schema work | **MCP** | Admin operations (define_collection, seeding, etc.). |

## Rotating

Both are managed in the project admin dashboard (https://pluggie.app/admin/52bd98fd-695e-4e1e-ba38-b4ec00df74eb). Rotate the **MCP** token if it's ever exposed (it's the powerful one) and update `~/.claude.json` + the replicator/qualification env. The delivery token is lower-risk but rotate it too if leaked; update Render + desktop builds.

# AgentX Design Spikes — Empirical Results (2026-07-12)

Run against the live AgencyX project. These answers are load-bearing design inputs for the sync engine (W1), the scraper queue (W2), and the Phase-3 qualification receiver. Re-verify only if the platform version changes (server self-reported v0.1.0 at test time).

## S1 — Delivery API idempotency: **NO** ❌
- `Idempotency-Key` header is **silently ignored** (same key on two POSTs → two different ids).
- `idempotencyKey` in the body → `422 E_VALIDATION unknown_field` (strict validation).
- The generated TS client's `create()` exposes no idempotency parameter (CRUD only).

**Consequence — outbox retry contract:** retry safety comes from the unique `dedup_key`. A replayed POST that already succeeded returns:
`HTTP 422, code: "E_VALIDATION", issues: [{field: "dedup_key", constraint: "unique"}]` → treat as **already-synced** (then resolve the id via a list query on `dedup_key` if needed).

## S2 — Same-state workflow writes: **silent no-op** ⚠️
- `update_entry {status: <current value>}` succeeds (200-equivalent), changes nothing, fires **no** transition event.
- Consequence for the device queue claim (`pending→running`): the **losing racer also gets a success response** (its write is a same-state no-op). The transition alone is NOT a claim lock.

**Claim protocol v1 (MVP):** PATCH `{status:'running', device:<me>}`, wait ~1s, re-read; proceed only if `device == me`. Acceptable for a handful of devices per org. **Claim protocol v2 (if fleets grow):** a tiny coordinator on our infra assigns queries via MCP `update_entry_if` (true CAS); devices only poll for their assignments.
- A real illegal move is properly rejected: `E_VALIDATION: "<x>" is not a transition target for "<field>" — valid targets: ...`
- Creating an entry with a non-initial state is rejected: `workflow: "status" must start at "<initial>"`.

## S3 — Trash-restore & version rollback: **safe, with one receiver rule** ✅
- Restore preserves the workflow state (deleted at `active`, restored at `active`).
- Restore **re-emits `entry.created`** with `{restored: true, deletedAt: ...}` in the payload → **every `entry.created` consumer (Phase-3 qualification) must skip when `restored === true`** (or it will re-process a lead that may be mid-pipeline).
- `restore_entry_version` does **not** move the workflow field backward (no undeclared-transition side door via rollback). Non-workflow fields restore normally.

## S4 — bulk_create × hooks contradiction: **RESOLVED — hooks run per item** ✅
- `bulk_create_entries` on a hooked collection is NOT refused; the beforeCreate hook runs per item; failures are per-item `E_HOOK_FAILED` (with `onError:'reject'` the item is not inserted; others proceed independently).
- The `define_collection.hooks` doc line saying bulk is "refused" is stale/wrong. (Feedback note #7 to vendor.)

## S5 — `when` clauses on workflow transition actions: **ACCEPTED BUT IGNORED** ❌
- `define_collection` accepts a transition action carrying `when:[...]` without complaint, but at fire time the webhook fired for entries that did NOT match the clause.
- **Rule: transition actions are unconditional.** Any conditional or delayed side effect goes on `events.updated` with a `when` clause on the stage field (fully honored there). Never put a `when` on a transition action — it lies.

## Bonus facts captured
- Event webhooks (created/transitioned) are **async with 3 delivery attempts** (at-least-once); sync hooks log instantly with 1 attempt. Delivery-log payload shapes captured below.
- `entry.transitioned` payload: `{entry:{id,data}, previous:{data}, collection, transition:{field,from,to}}`.
- `entry.created` payload: `{entry:{id,data}, collection}` (+ `restored`, `deletedAt` on restore).
- Hook envelope: `{event:'entry.before_create', collection, candidate:{data}}`, HMAC-signed (`x-agentx-signature: t=...,v1=...`, ±300s window) — verification stub ships in the generated client.
- Field names MUST be snake_case (platform rule — the brief's camelCase names are illegal); relation fields take top-level `targetCollection`/`labelField`.
- Fail-closed verified on `leads`: no project token → 401; project token without `X-User-Token` JWT → `401 E_AUTH "sign-in required"`. Full org-claim isolation test pending a real Clerk org/user (needs two orgs + JWTs).

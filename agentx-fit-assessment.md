# Lead Engine Brief × AgentX — Fit Assessment

_Generated 2026-07-12 from an adversarially-verified review of the live AgentX contract (42 MCP tool schemas + delivery-API reference) against `lead-engine-build-brief.md`. 86 requirements mapped; the 40 contested/load-bearing ones re-verified by independent adversarial checkers._

**Scorecard: 34 SUPPORTED · 35 PARTIAL (workaround needed) · 5 UNSUPPORTED · 12 UNKNOWN (docs silent/contradictory)**

**Bottom line: build on it for the MVP — with the hedges below. The two existential capabilities (org isolation, workflow state machine) are verified word-for-word. But 5 sentences in the brief are flat-out wrong, billing/secrets/admin assumptions need redesign, and a day-1 replication hedge is mandatory because export caps make AgentX un-backupable at scale.**

---

## 1. What maps cleanly (verified against the contract)

| Brief | Capability | Status |
|---|---|---|
| §4 | `access.org {claim,field}` — org field server-stamped from Clerk JWT claim on create, stripped from PATCH bodies, fail-closed 403, hooks can never move it. Clerk connector live. | ✅ verified exactly as described (delivery API only — see §2.1) |
| §9 | `workflow` on one enum field: initial stage enforced on **every** create path (delivery, bulk, MCP), illegal moves rejected with allowed targets, overlapping transitions rejected at define time, actor-gated (`mcp`/`admin`/`delivery`), per-transition webhook/email actions. Phases 3–5 genuinely bolt onto transitions. | ✅ verified |
| §7.1/§8 | Clerk JWT auth (`X-User-Token`), device coverage reads (keyword+zip equality filters), tenant-gated changes feed + SSE for the live run log, ETag/304, full-text search, one-hop relation filters (ZIP via searchQuery), atomic `transact` (25 ops) for enrichment write-backs, MCP idempotency keys on create/transact | ✅ |
| §6/§9 | Events with `when` clauses + `after` delays (1m–365d), Resend templating, delivery log + `refire_delivery`, `test_hook` dry-runs, preset schedules for Moz sweeps | ✅ |
| ops | Audit log (actor + userId on delivery writes), per-entry versions (last 20), ~30-day trash, generated typed TS client (CRUD surface) | ✅ |

## 2. Where the brief is wrong (all 5 verified UNSUPPORTED)

1. **§8 "the branded admin panel… both read the same isolated data" — inverted.** The admin panel and MCP are full-trust surfaces over *all* tenants' rows; org scoping applies only to the delivery API. Admin URL = internal back-stop for your own staff only, never tenant-facing.
2. **§4 "No collection is missing this" is discipline, not enforcement.** A collection defined without `access.org` silently has no isolation. Mitigation: version `export_project` in git + CI lint that every collection carries `access.org` (and that every Leads redefine keeps the `workflow` block — omitting it silently drops all enforcement).
3. **§4 "qualificationApiKey (text, encrypted)" — no encrypted field type exists.** A text field is plaintext in Neon, the admin panel, any MCP session, exports, version history, and the change feed. Store BYO keys in a vault on the qualification service; keep only a reference/fingerprint in AgentX.
4. **§9 hooks cannot gate WHO drives a transition.** The hook envelope carries no caller identity, and CAS updates (`update_entry_if`) skip hooks entirely. Actor control = the `actors[]` gate (coarse) + JWT claim write-rules.
5. **§10/§11.4 in-platform Stripe is a dead end for this product.** Checkout is payment-mode only (no subscriptions/invoicing/refunds) and requires public-read collections — structurally incompatible with org-scoped data. All billing (tiers, per-seat) is own-infra Stripe Billing; AgentX just stores `tier`/`stripeCustomerId`. Stripe connector is also not yet connected in the live project.

**Errata:** §3's "AgentX job drain (Render Cron)" describes a component that doesn't exist — the platform drains its own job queue. Delete it.

## 3. Load-bearing workarounds to budget (top PARTIALs)

- **Two-field tenancy.** The stamped org field must be a **text** field (Clerk org id) — the brief's `agency` relation cannot be it. Every collection: `orgId` (text, stamped, the enforcement key) + optional `agency` relation for labels/joins. Configure Clerk's session token template to carry org + role claims (JWT claims, not the Users.role field, are the enforcement source).
- **Trust boundary.** Tenant surfaces (web, desktop) speak *only* delivery API with Clerk JWTs. MCP credentials live only on own-infra services; an MCP-side bug can write cross-tenant with no platform guard.
- **`placeId` "unique per agency" isn't a primitive** — unique is collection-wide (cross-tenant insert blocking + existence leak). Use a unique `dedupKey` = `{orgId}:{placeId}` text field instead; decide stamping (client-stamped = prefix-squat risk; hook/computed = has unknowns to test).
- **Outbox idempotency on the desktop's actual path is UNKNOWN.** `idempotencyKey` is verified on MCP create/transact but undocumented on delivery POST. Day-1 spike. Fallback: the unique `dedupKey` makes replays safe (treat unique-conflict as already-synced).
- **Queue-claim races:** no CAS on the delivery surface. Put SearchQueries.status under a workflow (`pending→running`, actors include `delivery`) — the losing device's move is rejected.
- **"Exactly-once" means emission, not delivery.** Transition actions fire once per state change but deliver at-least-once (plus a manual replay button). Every webhook receiver must be idempotent (key: entry id + to-state); don't send proposal emails via replayable actions without dedupe.
- **No `after` delays on transition actions** — put delayed follow-ups on `events.updated` with a `when: stage=X` clause instead.
- **Lead-table filters:** delivery reads filter by equality only — precompute `hasWebsite` (boolean) and review-count buckets (enum) at write time rather than proxying queries through your own API (which would re-implement isolation in app code).
- **Sync qualification is effectively dead** (5s hook ceiling vs LLM latency; hooks may not run on delivery writes at all). §11.1 decision resolved: **async** (entry.created webhook → score → CAS write-back) — the platform-prescribed, verified path.
- **Backup/exit:** `export_entries` caps at 5,000 rows; change feed ≈30-day retention; versions last-20. **Run continuous `get_changes` replication into your own Postgres from day 1** — it is simultaneously backup, analytics store (real filters/aggregates), and the vendor-risk exit hatch.
- **TS client covers CRUD only** (documented). Wrap search, changes/SSE, uploads in one thin hand-written layer inside `packages/agentx-client`.
- **Agencies bootstrap ordering:** a delivery create only stamps `orgId` if the JWT already carries the claim — the tenant-root creation flow needs a defined order (create Clerk org → mint JWT → create Agencies row).

## 4. Unknowns to spike before code depends on them (from 12 UNKNOWN)

1. Delivery POST `idempotencyKey` — docs contradict (writeBack implies yes; API reference silent; strict validation may reject unknown fields).
2. Hooks on delivery-API writes (gates the sync-scoring option; async path unaffected).
3. `bulk_create_entries` × beforeCreate hooks — vendor docs flatly contradict each other (per-item vs refused).
4. Same-stage no-op write: rejected, ignored, or re-fires actions?
5. Trash-restore / version-rollback vs workflow legality — restore re-emits `entry.created` (with `restored:true`), so the qualification trigger re-fires for restored leads; consumers must check the flag.
6. Rate limits: none documented anywhere — coarse heartbeats, handle 429 with backoff.
7. Clerk JWT refresh for multi-hour scrape runs — Electron must run a refresh loop; a stored session token is not enough.
8. Row/field size caps (Moz `rawResult`) — hedge: store big payloads as assets.
9. Compliance: SOC2/GDPR/residency/at-rest encryption all undocumented; image-variant URLs are **unauthenticated by design**. Get written vendor answers before selling an enterprise tier.
10. Transition-action `when`/templating parity with events (one dry-run settles it).
11. Whether lifecycle event webhooks are signed (hooks are HMAC-signed; events not documented as such) — verify or treat receivers as untrusted-input endpoints.
12. Platform maturity: server self-reports v0.1.0, single hosted deployment, "UTC-only for now" — the vendor-risk backdrop for everything above.

## 5. Verdict

**Good option for the MVP; conditional beyond it.** The pieces that would take a small team weeks to build correctly — fail-closed row isolation, an enforced pipeline state machine, eventing with observability, typed client generation — are real and verified, and the brief's architecture (all custom compute on own infra) already matches the platform's model. The scraper stays the moat; AgentX removes the undifferentiated backend.

The honest counterweight: a pre-1.0, single-instance vendor as the *sole* canonical store, with export caps that make self-replication mandatory anyway, ~35 requirements needing workarounds, and unanswerable compliance questions today. The skeptic's alternative (Neon/Supabase + thin TS API + RLS + a 1–2 week state machine) is credible — but it spends the novelty budget on plumbing before the product proves itself.

**Proceed if you adopt the hedges:** day-1 `get_changes` replication, the trust-boundary rule, CI schema lint, external vault for BYO keys, own-infra billing, and the spikes in §4 before the outbox is built. Re-evaluate at two gates: Phase 3 (the qualification service concentrates full-trust MCP credentials) and before the first external tenant (compliance answers + admin-panel lockdown). Exit cost stays bounded: one HTTP contract behind `packages/agentx-client` plus data you already replicated.

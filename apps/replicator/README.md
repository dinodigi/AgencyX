# Replicator

Tails AgentX's full-trust MCP change feed into our own Postgres. This is the standing hedge from the fit assessment: backup (platform export caps at 5,000 rows), analytics store (real SQL vs equality-only delivery filters), and the vendor-exit hatch — all in one small worker.

- Deploy: Render Background Worker. `node --env-file=.env src/index.ts` (Node ≥ 23.6).
- Holds the full-trust MCP token → our infra only, never a tenant surface.
- Resumable: cursor persisted in `agentx_sync`; re-running from scratch replays the feed (retention ~30 days — do the initial run BEFORE real data flows so the journal is complete from day one).
- Reconcile rule (platform contract): on a feed gap, whole-collection delete, or field rename, run a full `query_entries` dump to resync `agentx_entries`.
- Monthly restore drill: verify `agentx_entries` row counts per collection against `count_entries`.

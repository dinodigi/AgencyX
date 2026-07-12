-- Replicated AgentX state. Two tables + a cursor:
--   agentx_changes  — append-only journal (survives the platform's ~30-day feed retention)
--   agentx_entries  — current state per entry (upsert target; deletes are tombstoned)
--   agentx_sync     — single-row cursor state
-- The replicator bootstraps this schema itself; this file is documentation +
-- a hand-run option.

CREATE TABLE IF NOT EXISTS agentx_changes (
  cursor      text PRIMARY KEY,
  collection  text NOT NULL,
  entry_id    uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('created', 'updated', 'deleted')),
  at          timestamptz NOT NULL,
  changed     text[],
  data        jsonb,
  prev_data   jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agentx_changes_entry ON agentx_changes (collection, entry_id, at);

CREATE TABLE IF NOT EXISTS agentx_entries (
  collection  text NOT NULL,
  entry_id    uuid NOT NULL,
  data        jsonb,
  deleted     boolean NOT NULL DEFAULT false,
  last_kind   text,
  last_at     timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, entry_id)
);
CREATE INDEX IF NOT EXISTS agentx_entries_org ON agentx_entries ((data ->> 'org_id'));

CREATE TABLE IF NOT EXISTS agentx_sync (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cursor      text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO agentx_sync (id, cursor) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;

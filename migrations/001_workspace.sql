-- New, empty production state. No local exercise data is imported.
BEGIN;
CREATE SCHEMA IF NOT EXISTS relay_private;
REVOKE ALL ON SCHEMA relay_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS relay_private.workspace (
  id integer PRIMARY KEY CHECK(id=1),
  snapshot jsonb NOT NULL DEFAULT '{"records":[],"actions":[],"metadata":[]}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE relay_private.workspace ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON relay_private.workspace FROM PUBLIC, anon, authenticated;
INSERT INTO relay_private.workspace(id) VALUES(1) ON CONFLICT DO NOTHING;
COMMIT;

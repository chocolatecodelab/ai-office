-- Rules and memory that people add on top of the read-only context/ package. agent_type NULL means every agent of
-- the brand. They are put into the agent's prompt after the official context, which always wins (agent-notes.ts).
CREATE TABLE agent_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    text NOT NULL REFERENCES brands(id),
  agent_type  text,
  kind        text NOT NULL CHECK (kind IN ('rule', 'memory')),
  title       text NOT NULL,
  body        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_by  text NOT NULL,
  updated_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_notes_scope ON agent_notes (brand_id, agent_type);

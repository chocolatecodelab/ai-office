-- Model overrides per agent role and task weight (server/office/model-routes.ts). The role is organisation-wide,
-- like context/agents/<role>.md, so there is no brand_id; every change is also written to audit_log.
CREATE TABLE agent_routes (
  agent_type       text NOT NULL,
  weight           text NOT NULL CHECK (weight IN ('simple', 'complex', 'urgent')),
  source           text NOT NULL CHECK (source IN ('codex', 'litellm')),
  model            text,                        -- Codex model id, or the LiteLLM alias (cepat, final, video)
  reasoning_effort text NOT NULL CHECK (reasoning_effort IN ('low', 'high')),
  updated_by       text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_type, weight)
);

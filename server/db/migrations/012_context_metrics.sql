ALTER TABLE cost_events ADD COLUMN cache_read_tokens integer;
ALTER TABLE cost_events ADD COLUMN cache_write_tokens integer;
CREATE TABLE chat_context_metrics (
  task_id uuid PRIMARY KEY REFERENCES tasks(id),
  brand_id text NOT NULL REFERENCES brands(id),
  agent_type text NOT NULL,
  metrics jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE document_context_cache (
  attachment_id uuid NOT NULL REFERENCES chat_attachments(id) ON DELETE CASCADE,
  source_hash text NOT NULL,
  budget integer NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(attachment_id,source_hash,budget)
);

CREATE TABLE chat_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL,
  agent_type text NOT NULL,
  name text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL,
  data bytea,
  extracted text,
  warning text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'Unggahan',
  removed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (brand_id,agent_type) REFERENCES agents(brand_id,agent_type)
);
CREATE INDEX chat_attachments_owner ON chat_attachments(brand_id,agent_type,created_at DESC);
CREATE TABLE agent_chat_memory (
  brand_id text NOT NULL,
  agent_type text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  automatic boolean NOT NULL DEFAULT true,
  summary text NOT NULL DEFAULT '',
  through_at timestamptz NOT NULL DEFAULT 'epoch',
  revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(brand_id,agent_type),
  FOREIGN KEY(brand_id,agent_type) REFERENCES agents(brand_id,agent_type)
);
CREATE TABLE chat_inputs (
  task_id uuid PRIMARY KEY REFERENCES tasks(id),
  brand_id text NOT NULL,
  agent_type text NOT NULL,
  attachment_ids uuid[] NOT NULL DEFAULT '{}',
  skills text[] NOT NULL DEFAULT '{}',
  use_memory boolean NOT NULL DEFAULT true,
  trace jsonb NOT NULL DEFAULT '{}',
  FOREIGN KEY(brand_id,agent_type) REFERENCES agents(brand_id,agent_type)
);

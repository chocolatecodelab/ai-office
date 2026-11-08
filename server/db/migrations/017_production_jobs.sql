-- Engine payloads stay separate from conversational briefs. Tasks retain queue/approval semantics.
CREATE TABLE production_jobs (
  task_id uuid PRIMARY KEY REFERENCES tasks(id),
  brand_id text NOT NULL REFERENCES brands(id),
  agent_type text NOT NULL CHECK (agent_type IN ('content-creator','video-editor')),
  payload jsonb NOT NULL,
  stage text NOT NULL DEFAULT 'queued',
  report jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX production_jobs_brand ON production_jobs(brand_id, updated_at DESC);

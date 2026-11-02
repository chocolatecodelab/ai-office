-- L1 schema (docs/PLAN.md 5.4). Every brand-owned row carries brand_id; the repositories in
-- server/office/ always filter on it (FR-31).

CREATE TABLE brands (
  id          text PRIMARY KEY,                -- slug from context/brands/<slug>
  name        text NOT NULL,
  color       text NOT NULL,                   -- floor colour from visual.json
  paused      boolean NOT NULL DEFAULT false,  -- kill switch for the whole brand (FR-26)
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agents (
  brand_id    text NOT NULL REFERENCES brands(id),
  agent_type  text NOT NULL,                   -- context/agents/<agent_type>.md
  active      boolean NOT NULL DEFAULT true,   -- listed in the brand's agents.json
  -- The avatar status (idle, working, waiting_quota, ...) is derived from the agent's tasks.
  paused      boolean NOT NULL DEFAULT false,  -- kill switch for one agent (FR-26)
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, agent_type)
);

CREATE TABLE events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    text NOT NULL REFERENCES brands(id),
  title       text NOT NULL,
  brief       text NOT NULL DEFAULT '',
  details     jsonb NOT NULL DEFAULT '{}',     -- tanggal, harga, narasumber, benefit, ...
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_brand ON events (brand_id, created_at DESC);

CREATE TABLE tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      text NOT NULL,
  agent_type    text NOT NULL,
  parent_id     uuid REFERENCES tasks(id),
  event_id      uuid REFERENCES events(id),
  kind          text NOT NULL,                 -- work type, picks the approval route (FR-21)
  title         text NOT NULL,
  brief         text NOT NULL DEFAULT '',
  priority      smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  urgent        boolean NOT NULL DEFAULT false,
  complex       boolean NOT NULL DEFAULT false, -- high reasoning on Codex (FR-12)
  status        text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'waiting_quota', 'waiting_approval', 'revision', 'approved', 'done', 'failed', 'paused', 'cancelled')),
  attempts      integer NOT NULL DEFAULT 0,
  run_id        text,
  result        text,
  error         text,
  retry_at      timestamptz,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  FOREIGN KEY (brand_id, agent_type) REFERENCES agents(brand_id, agent_type)
);
CREATE INDEX tasks_brand_status ON tasks (brand_id, status, created_at DESC);
CREATE INDEX tasks_event ON tasks (event_id);

CREATE TABLE task_events (
  id          bigserial PRIMARY KEY,
  task_id     uuid NOT NULL REFERENCES tasks(id),
  brand_id    text NOT NULL,
  type        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_events_task ON task_events (task_id, id);

CREATE TABLE approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        uuid NOT NULL REFERENCES tasks(id),
  brand_id       text NOT NULL,
  approval_type  text NOT NULL CHECK (approval_type IN ('konten', 'publikasi', 'iklan', 'budget', 'event', 'consent')),
  decision       text CHECK (decision IN ('approved', 'rejected')),
  note           text,
  decided_by     text,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approvals_open ON approvals (brand_id, created_at) WHERE decision IS NULL;

CREATE TABLE assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES tasks(id),
  brand_id    text NOT NULL,
  kind        text NOT NULL,
  version     integer NOT NULL,
  content     text NOT NULL,
  qc          jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, version)
);

CREATE TABLE speaker_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id),
  brand_id    text NOT NULL,
  position    smallint NOT NULL,
  speaker     text NOT NULL DEFAULT '',
  question    text NOT NULL,
  answer      text,
  status      text NOT NULL DEFAULT 'belum_dikirim' CHECK (status IN ('belum_dikirim', 'terkirim', 'dijawab')),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX speaker_questions_event ON speaker_questions (event_id, position);

CREATE TABLE cost_events (
  id             bigserial PRIMARY KEY,
  task_id        uuid REFERENCES tasks(id),
  brand_id       text NOT NULL,
  source         text NOT NULL CHECK (source IN ('codex', 'litellm')),
  model          text NOT NULL,
  input_tokens   integer NOT NULL DEFAULT 0,
  output_tokens  integer NOT NULL DEFAULT 0,
  cost_usd       numeric(10, 6),               -- null for Codex (subscription)
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cost_events_brand ON cost_events (brand_id, created_at);

CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  actor        text NOT NULL,
  action       text NOT NULL,
  object_type  text NOT NULL,
  object_id    text NOT NULL,
  brand_id     text,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_brand ON audit_log (brand_id, created_at DESC);

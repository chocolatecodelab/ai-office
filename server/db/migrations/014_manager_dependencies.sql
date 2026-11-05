CREATE TABLE manager_dependency_contexts (
  brand_id text NOT NULL REFERENCES brands(id),
  task_id uuid NOT NULL REFERENCES tasks(id),
  source_task_id uuid NOT NULL REFERENCES tasks(id),
  source_asset_id uuid NOT NULL REFERENCES assets(id),
  source_hash text NOT NULL,
  budget integer NOT NULL CHECK(budget>0),
  content text NOT NULL,
  summarized boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(task_id,source_asset_id,source_hash,budget)
);

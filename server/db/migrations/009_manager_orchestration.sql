-- Persist the plan independently from the final result so retries/restarts never create another crew.
CREATE TABLE manager_plans (
  task_id uuid PRIMARY KEY REFERENCES tasks(id),
  brand_id text NOT NULL REFERENCES brands(id),
  plan jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_parent ON tasks (brand_id, parent_id);

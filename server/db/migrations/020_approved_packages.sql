CREATE TABLE approved_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id),
  source_task_id uuid NOT NULL UNIQUE REFERENCES tasks(id),
  approval_id uuid NOT NULL UNIQUE REFERENCES approvals(id),
  smm_task_id uuid NOT NULL UNIQUE REFERENCES tasks(id),
  assets jsonb NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  drive_status text NOT NULL DEFAULT 'pending' CHECK (drive_status IN ('pending','synced','failed')),
  drive_folder_id text
);
CREATE INDEX approved_packages_brand ON approved_packages(brand_id, approved_at DESC);

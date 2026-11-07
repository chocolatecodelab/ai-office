CREATE TABLE task_checkpoints (
 task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 brand_id text NOT NULL REFERENCES brands(id),
 checkpoint_key text NOT NULL,
 generation integer NOT NULL DEFAULT 0,
 run_id text,
 result jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(task_id,checkpoint_key)
);

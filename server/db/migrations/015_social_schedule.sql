-- A local publishing plan. No worker or provider is allowed to treat this as a published post.
CREATE TABLE social_schedule (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 brand_id text NOT NULL REFERENCES brands(id),
 task_id uuid NOT NULL REFERENCES tasks(id),
 asset_id uuid NOT NULL REFERENCES assets(id),
 asset_version integer NOT NULL,
 approval_id uuid NOT NULL REFERENCES approvals(id),
 platform text NOT NULL CHECK(platform IN ('instagram','facebook')),
 scheduled_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','cancelled')),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(task_id,platform)
);
CREATE INDEX social_schedule_brand ON social_schedule(brand_id,scheduled_at);

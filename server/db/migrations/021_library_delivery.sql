CREATE TABLE brand_drive_libraries (
  brand_id text PRIMARY KEY REFERENCES brands(id),
  folder_id text NOT NULL UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE approved_packages ADD COLUMN drive_error text;
ALTER TABLE approved_packages ADD COLUMN publication_asset_id uuid REFERENCES assets(id);
ALTER TABLE approved_packages ADD COLUMN drive_files jsonb NOT NULL DEFAULT '{}';
ALTER TABLE approved_packages ADD COLUMN drive_parent_id text;
ALTER TABLE approved_packages ADD COLUMN drive_location text NOT NULL DEFAULT 'approved' CHECK (drive_location IN ('approved','published'));
ALTER TABLE social_schedule DROP CONSTRAINT social_schedule_status_check;
ALTER TABLE social_schedule ADD CONSTRAINT social_schedule_status_check CHECK(status IN ('planned','cancelled','published'));
CREATE TABLE social_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id text NOT NULL REFERENCES brands(id),
  schedule_id uuid NOT NULL UNIQUE REFERENCES social_schedule(id),
  package_id uuid NOT NULL REFERENCES approved_packages(id),
  post_url text NOT NULL,
  published_at timestamptz NOT NULL,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

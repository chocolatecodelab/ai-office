CREATE TABLE brand_asset_library (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 brand_id text NOT NULL REFERENCES brands(id),
 attachment_id uuid NOT NULL REFERENCES chat_attachments(id),
 category text NOT NULL CHECK(category IN ('logo','mascot','photo','material')),
 source text NOT NULL,
 license text NOT NULL,
 evidence text NOT NULL DEFAULT '',
 status text NOT NULL CHECK(status IN ('pending','cleared','revoked')) DEFAULT 'pending',
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(brand_id,attachment_id)
);

-- Registry foundation only; publishing/ingest gates must consult current consent explicitly.
CREATE TABLE sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 brand_id text NOT NULL REFERENCES brands(id),
 title text NOT NULL CHECK(length(trim(title))>0),
 source_url text,
 creator text NOT NULL DEFAULT '',
 retrieved_at timestamptz,
 permission_status text NOT NULL DEFAULT 'pending' CHECK(permission_status IN ('pending','permitted','denied','revoked')),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,brand_id)
);
CREATE INDEX sources_brand ON sources(brand_id,created_at);
CREATE TABLE consents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 brand_id text NOT NULL REFERENCES brands(id),
 source_id uuid NOT NULL,
 subject_reference text NOT NULL,
 usage_scope text NOT NULL CHECK(length(trim(usage_scope))>0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','granted','denied','revoked')),
 evidence_reference text,
 expires_at timestamptz,
 recorded_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(source_id,brand_id) REFERENCES sources(id,brand_id),
 CHECK(status<>'granted' OR length(trim(coalesce(evidence_reference,'')))>0)
);
CREATE INDEX consents_brand_source ON consents(brand_id,source_id);

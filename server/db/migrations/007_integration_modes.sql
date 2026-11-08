-- The mode (mock, sandbox, live) each brand asks for per outside service (FR-40). What actually runs also depends on
-- whether credentials exist and the adapter is written (integrations/catalog.ts). Credentials are not stored here.
CREATE TABLE integration_modes (
  brand_id    text NOT NULL REFERENCES brands(id),
  service     text NOT NULL,
  mode        text NOT NULL CHECK (mode IN ('mock', 'sandbox', 'live')),
  updated_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, service)
);

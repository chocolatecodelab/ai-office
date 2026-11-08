-- A scheduled plan stays manual until a person explicitly enables API delivery.
CREATE TABLE social_deliveries (
  schedule_id uuid PRIMARY KEY REFERENCES social_schedule(id),
  brand_id text NOT NULL REFERENCES brands(id),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','preparing','publishing','published','failed','uncertain','cancelled')),
  account jsonb NOT NULL,
  caption text NOT NULL,
  checkpoint jsonb NOT NULL DEFAULT '{}',
  provider_id text,
  error text,
  armed_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX social_deliveries_pending ON social_deliveries(brand_id,state);

-- Accounts connected through OAuth (Google Drive first), one per brand and service. Tokens are stored encrypted
-- (integrations/crypto.ts); the key is only in the environment. Nothing here is ever sent to the browser or to Hermes.
CREATE TABLE integration_connections (
  brand_id      text NOT NULL REFERENCES brands(id),
  service       text NOT NULL,
  account       text NOT NULL,
  access_token  text NOT NULL,
  refresh_token text,
  expires_at    timestamptz,
  scopes        text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reauth')),
  connected_by  text NOT NULL,
  connected_at  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, service)
);

-- One row per started connection, used once by the callback; holds the PKCE verifier that must not travel in a URL.
CREATE TABLE oauth_states (
  state_hash   text PRIMARY KEY,
  brand_id     text NOT NULL REFERENCES brands(id),
  service      text NOT NULL,
  verifier     text NOT NULL,
  redirect_uri text NOT NULL,
  created_by   text NOT NULL,
  expires_at   timestamptz NOT NULL
);

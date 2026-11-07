CREATE TABLE chat_video_files (
  attachment_id uuid PRIMARY KEY REFERENCES chat_attachments(id),
  brand_id text NOT NULL REFERENCES brands(id),
  storage_key text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  metadata jsonb NOT NULL
);

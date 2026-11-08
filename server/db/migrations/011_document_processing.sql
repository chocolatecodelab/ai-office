ALTER TABLE chat_attachments ADD COLUMN processing jsonb NOT NULL DEFAULT '{}';
ALTER TABLE chat_inputs ADD COLUMN page_ranges jsonb NOT NULL DEFAULT '{}';
CREATE TABLE chat_attachment_pages (
  attachment_id uuid NOT NULL REFERENCES chat_attachments(id) ON DELETE CASCADE,
  page integer NOT NULL CHECK(page>0),
  content text NOT NULL,
  method text NOT NULL,
  PRIMARY KEY(attachment_id,page)
);

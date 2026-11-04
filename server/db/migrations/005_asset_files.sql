-- Binary results (PDF now; images and video later) live in the file store; the asset row keeps their key.
-- For a PDF, content holds the Markdown it was made from, so the source can still be read and searched.
ALTER TABLE assets
  ADD COLUMN mime        text,
  ADD COLUMN storage_key text,
  ADD COLUMN size_bytes  integer;

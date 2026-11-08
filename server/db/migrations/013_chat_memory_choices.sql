ALTER TABLE chat_inputs
  ADD COLUMN excluded_memory_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN use_summary boolean NOT NULL DEFAULT true;

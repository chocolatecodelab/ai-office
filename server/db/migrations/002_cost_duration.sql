-- FR-14: every model run is recorded with how long it took, next to its model and tokens.
ALTER TABLE cost_events ADD COLUMN duration_ms integer;  -- null for runs recorded before this column existed

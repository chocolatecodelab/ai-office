-- Files an agent writes in a chat reply are saved as assets of kind 'artifact', each with its file name.
ALTER TABLE assets ADD COLUMN name text;  -- null for the reply itself

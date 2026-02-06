-- Clear existing channels to start fresh
TRUNCATE TABLE channels CASCADE;

-- Add account_id with Cascade Delete
ALTER TABLE channels ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE;

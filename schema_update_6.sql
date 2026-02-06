-- Rename current 'channels' table to 'channels_old' to migrate data manually if needed, or just drop if empty/test.
-- Since user cleaned up before, we assume we can start fresh or migrate.
-- Let's just create the new structure.

-- 1. Create LOGICAL channels table (The wrapper)
CREATE TABLE IF NOT EXISTS channels_logical (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    logo_url TEXT,
    category VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Create PHYSICAL streams table (The links)
CREATE TABLE IF NOT EXISTS channel_streams (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER REFERENCES channels_logical(id) ON DELETE CASCADE,
    stream_url TEXT NOT NULL,
    priority INTEGER DEFAULT 1,
    provider_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL, -- Optional link to source
    created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Migration (Optional): If there are existing channels in the old 'channels' table, move them.
-- INSERT INTO channels_logical (name, logo_url, category) SELECT name, logo_url, category FROM channels;
-- INSERT INTO channel_streams (channel_id, stream_url, provider_id) ... (Need to map IDs, tricky in SQL alone without stored proc).
-- For this "Clean Slate" approach requested earlier, we will just DROP the simple 'channels' table and replace it.

DROP TABLE IF EXISTS channels CASCADE;
ALTER TABLE channels_logical RENAME TO channels;

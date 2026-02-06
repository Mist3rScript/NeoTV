-- Rename existing channels table to catalog
ALTER TABLE channels RENAME TO provider_catalog;

-- Create new empty channels table (Live Lineup)
CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    stream_url TEXT NOT NULL,
    logo_url TEXT,
    category VARCHAR(255),
    provider_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Note: provider_catalog already has account_id from previous update

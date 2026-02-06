CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE,
    password VARCHAR(255),
    mac_address VARCHAR(17) UNIQUE,
    type VARCHAR(50) NOT NULL, -- 'm3u', 'stalker'
    is_active BOOLEAN DEFAULT TRUE,
    expiration_date TIMESTAMP,
    max_connections INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_accounts_auth ON accounts(username, password, mac_address);

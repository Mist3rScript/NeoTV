-- Create table for channels
CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    logo_url TEXT,
    stream_url TEXT NOT NULL,
    category VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create table for activation keys
CREATE TABLE IF NOT EXISTS activation_keys (
    id SERIAL PRIMARY KEY,
    key_code VARCHAR(11) NOT NULL UNIQUE, -- 11-digit numeric key
    duration_days INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    device_id VARCHAR(255), -- Stores the ID of the first device to use it
    expiration_date TIMESTAMP,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create table for categories
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    logo_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

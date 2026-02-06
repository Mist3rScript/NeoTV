CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    message TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'info',
    created_at TIMESTAMP DEFAULT NOW(),
    read BOOLEAN DEFAULT FALSE
);

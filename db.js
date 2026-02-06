const { Pool } = require('pg');
require('dotenv').config();

// Debugging: Check for missing env vars
const requiredEnv = ['DB_USER', 'DB_HOST', 'DB_NAME', 'DB_PASSWORD', 'DB_PORT'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);

if (missingEnv.length > 0) {
  console.error('[DB-ERROR] Missing required environment variables:', missingEnv.join(', '));
  // We don't exit here so we can see the log in Vercel, but the pool will likely fail.
}


let pool;

try {
  // Only create pool if minimal env vars are present to avoid immediate crash
  if (process.env.DB_HOST && process.env.DB_USER) {
    pool = new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
      ssl: {
        rejectUnauthorized: false
      }
    });

    pool.on('error', (err, client) => {
      console.error('Unexpected error on idle client', err);
      // Do not exit process in serverless; just log
      // process.exit(-1);
    });
  } else {
    throw new Error('Missing DB_HOST or DB_USER');
  }
} catch (e) {
  console.error('[DB-INIT-ERROR] Failed to initialize connection pool:', e.message);
  // Create a mock pool that always fails queries, allowing the app to start
  pool = {
    query: async () => {
      console.error('[DB-MOCK] Database is not initialized. Check server logs.');
      throw new Error('Database connection failed to initialize');
    },
    on: () => { }
  };
}

module.exports = {
  query: (text, params) => pool.query(text, params),
};

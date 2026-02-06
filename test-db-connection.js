const db = require('./db');

(async () => {
    try {
        console.log('Testing connection to Supabase...');
        const res = await db.query('SELECT NOW()');
        console.log('Connection successful! Time:', res.rows[0].now);

        const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
        console.log('Tables found:', tables.rows.map(r => r.table_name).join(', '));
    } catch (err) {
        console.error('Connection failed:', err);
    } finally {
        // Force exit since pool might keep open
        process.exit(0);
    }
})();

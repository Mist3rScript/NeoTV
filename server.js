const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./db');
require('dotenv').config();
const fetch = require('node-fetch'); // Ensure we use node-fetch for stream piping compatibility

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve admin panel files

// Create tables on startup
// Create tables on startup (DISABLED FOR VERCEL STABILITY - Schema applied manually)
// const fs = require('fs');
// const path = require('path');
// const schemaPath = path.join(__dirname, 'schema.sql');
// const schemaSql = fs.readFileSync(schemaPath, 'utf8');

// (async () => {
//     try {
//         await db.query(schemaSql);
//         console.log('Database tables verified/created.');
//     } catch (err) {
//         console.error('Error initializing database:', err);
//     }
// })();

// Basic Health Check (Explicitly serve index.html for Vercel)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/test', (req, res) => {
    res.send('CODE_VERSION_4_LIVE');
});

if (require.main === module) {
    console.log('[API] Local Server starting...');
} else {
    console.log('[Vercel] Serverless function invoked (v2)');
}

// Generate stable device ID from browser fingerprint
app.post('/api/get-device-id', (req, res) => {
    const { fingerprint } = req.body;
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(fingerprint || Date.now().toString()).digest('hex');
    const deviceId = 'device_' + hash.substring(0, 16);
    res.json({ deviceId });
});

// --- API ROUTES ---

// 1. Verify Key & Device
app.post('/api/verify', async (req, res) => {
    const { key, deviceId } = req.body;

    if (!key || !deviceId) {
        return res.status(400).json({ valid: false, message: 'Missing key or deviceId' });
    }

    try {
        const result = await db.query('SELECT * FROM activation_keys WHERE key_code = $1', [key]);

        if (result.rows.length === 0) {
            return res.status(401).json({ valid: false, message: 'Invalid key' });
        }

        const keyData = result.rows[0];

        if (!keyData.is_active) {
            return res.status(403).json({ valid: false, message: 'Key is banned or inactive' });
        }

        // Check if key is already bound to a device
        if (keyData.device_id) {
            if (keyData.device_id !== deviceId) {
                return res.status(403).json({ valid: false, message: 'Key already used on another device' });
            }
        } else {
            // First use: Bind to this device and set expiration
            const expirationDate = new Date();
            expirationDate.setDate(expirationDate.getDate() + keyData.duration_days);

            await db.query(
                'UPDATE activation_keys SET device_id = $1, used_at = NOW(), expiration_date = $2 WHERE id = $3',
                [deviceId, expirationDate, keyData.id]
            );
        }

        // Check expiration
        if (keyData.expiration_date && new Date() > new Date(keyData.expiration_date)) {
            return res.status(403).json({ valid: false, message: 'Key expired' });
        }

        res.json({ valid: true, message: 'Access granted', expiration: keyData.expiration_date || 'Calculated on first use' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ valid: false, message: 'Server error' });
    }
});

// 2. Get Channels (Protected)
app.get('/api/channels', async (req, res) => {
    const { key, deviceId } = req.query;

    if (!key || !deviceId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Reuse verification logic ideally, or simple check
    try {
        const result = await db.query('SELECT * FROM activation_keys WHERE key_code = $1', [key]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid key' });

        const keyData = result.rows[0];
        if (keyData.device_id !== deviceId) return res.status(403).json({ error: 'Device mismatch' });
        if (!keyData.is_active) return res.status(403).json({ error: 'Inactive key' });
        if (keyData.expiration_date && new Date() > new Date(keyData.expiration_date)) {
            return res.status(403).json({ error: 'Key expired' });
        }

        // Disable caching
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        // Fetch channels with their primary streams
        const channels = await db.query('SELECT * FROM channels ORDER BY id ASC');
        const channelIds = channels.rows.map(ch => ch.id);

        // Fetch all streams for these channels WITH account type JOIN
        const streamsRes = await db.query(
            `SELECT cs.*, a.type as account_type 
             FROM channel_streams cs
             LEFT JOIN accounts a ON cs.provider_id = a.id
             WHERE cs.channel_id = ANY($1) 
             ORDER BY cs.channel_id, cs.priority ASC`,
            [channelIds]
        );

        // Build response with stream URLs
        const response = channels.rows.map(ch => {
            const channelStreams = streamsRes.rows.filter(s => s.channel_id === ch.id);

            if (channelStreams.length > 0) {
                const primaryStream = channelStreams[0]; // First stream (sorted by priority)

                // For Stalker, use our local FULL PROXY to bypass all server checks!
                let streamUrl = primaryStream.stream_url;
                if (primaryStream.account_type === 'stalker') {
                    streamUrl = `${req.protocol}://${req.get('host')}/api/stream/live/${ch.id}`;
                }

                return {
                    id: ch.id,
                    name: ch.name,
                    logo: ch.logo_url || '',
                    category: ch.category || '',
                    url: streamUrl,
                    // Include additional stream info
                    streams: channelStreams.map(s => ({
                        url: s.account_type === 'stalker'
                            ? `${req.protocol}://${req.get('host')}/api/stream/live/${ch.id}`
                            : s.stream_url,
                        priority: s.priority,
                        type: s.account_type
                    }))
                };
            }

            // Channel without streams (shouldn't happen, but handle gracefully)
            return {
                id: ch.id,
                name: ch.name,
                logo: ch.logo_url || '',
                category: ch.category || '',
                url: '',
                streams: []
            };
        });

        res.json(response);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// 3. Get M3U Playlist (Protected: Key OR User/Pass OR MAC)
app.get('/api/playlist.m3u', async (req, res) => {
    // Disable caching
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const { key, deviceId, username, password, mac } = req.query;

    let authorized = false;

    try {
        // Method 1: Activation Key
        if (key && deviceId) {
            const result = await db.query('SELECT * FROM activation_keys WHERE key_code = $1', [key]);
            if (result.rows.length > 0) {
                const keyData = result.rows[0];
                if (keyData.is_active) {
                    // Check if key needs device binding (first use)
                    if (!keyData.device_id) {
                        // Bind device on first playlist access (like /api/verify)
                        const expirationDate = new Date();
                        expirationDate.setDate(expirationDate.getDate() + keyData.duration_days);
                        await db.query(
                            'UPDATE activation_keys SET device_id = $1, used_at = NOW(), expiration_date = $2 WHERE id = $3',
                            [deviceId, expirationDate, keyData.id]
                        );
                        authorized = true;
                    } else if (keyData.device_id === deviceId) {
                        // Device already bound, verify expiration
                        if (!keyData.expiration_date || new Date() < new Date(keyData.expiration_date)) {
                            authorized = true;
                        }
                    }
                }
            }
        }

        // Method 2: Username/Password (M3U/Xtream)
        if (!authorized && username && password) {
            const acc = await db.query('SELECT * FROM accounts WHERE username = $1 AND password = $2 AND type = $3', [username, password, 'm3u']);
            if (acc.rows.length > 0 && acc.rows[0].is_active) {
                if (!acc.rows[0].expiration_date || new Date() < new Date(acc.rows[0].expiration_date)) {
                    authorized = true;
                }
            }
        }

        // Method 3: MAC Address (Stalker)
        if (!authorized && mac) {
            const acc = await db.query('SELECT * FROM accounts WHERE mac_address = $1 AND type = $2', [mac, 'stalker']);
            if (acc.rows.length > 0 && acc.rows[0].is_active) {
                if (!acc.rows[0].expiration_date || new Date() < new Date(acc.rows[0].expiration_date)) {
                    authorized = true;
                }
            }
        }

        if (!authorized) {
            return res.status(401).send('#EXTM3U\n#EXTINF:-1,Unauthorized - Access Denied\nhttp://invalid');
        }

        // Fetch channels with their streams AND account type (for Stalker detection)
        const channels = await db.query('SELECT * FROM channels ORDER BY id ASC');
        const channelIds = channels.rows.map(ch => ch.id);

        // Fetch all streams for these channels WITH account type JOIN
        const streamsRes = await db.query(
            `SELECT cs.*, a.type as account_type 
             FROM channel_streams cs
             LEFT JOIN accounts a ON cs.provider_id = a.id
             WHERE cs.channel_id = ANY($1) 
             ORDER BY cs.channel_id, cs.priority ASC`,
            [channelIds]
        );

        let m3u = '#EXTM3U\n';
        channels.rows.forEach(ch => {
            // Get primary stream (lowest priority number)
            const channelStreams = streamsRes.rows.filter(s => s.channel_id === ch.id);
            if (channelStreams.length > 0) {
                const primaryStream = channelStreams[0]; // First stream (sorted by priority)
                const logo = ch.logo_url ? ` tvg-logo="${ch.logo_url}"` : '';
                const group = ch.category ? ` group-title="${ch.category}"` : '';

                // For Stalker, use our local FULL PROXY to bypass all server checks!
                let streamUrl = primaryStream.stream_url;
                if (primaryStream.account_type === 'stalker') {
                    console.log(`[M3U] Routing Stalker channel ${ch.name} through proxy`);
                    streamUrl = `${req.protocol}://${req.get('host')}/api/stream/live/${ch.id}`;
                }

                m3u += `#EXTINF:-1${logo}${group},${ch.name}\n${streamUrl}\n`;
            }
        });

        res.set('Content-Type', 'audio/x-mpegurl');
        res.send(m3u);

    } catch (err) {
        console.error(err);
        res.status(500).send('#EXTM3U\n#EXTINF:-1,Server Error\nhttp://invalid');
    }
});

// --- ADMIN ROUTES ---

// PAGINATED CHANNELS (Live Lineup) - Aggregated
app.get('/api/admin/channels', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    try {
        // Fetch Logical Channels
        const result = await db.query('SELECT * FROM channels ORDER BY id ASC LIMIT $1 OFFSET $2', [limit, offset]);
        const channels = result.rows;

        if (channels.length > 0) {
            // Fetch associated streams
            const ids = channels.map(c => c.id);
            const streamsRes = await db.query('SELECT * FROM channel_streams WHERE channel_id = ANY($1) ORDER BY priority ASC', [ids]);

            // Map streams to channels
            channels.forEach(ch => {
                ch.streams = streamsRes.rows.filter(s => s.channel_id === ch.id);
                // Backwards compatibility for UI list (show first stream)
                ch.stream_url = ch.streams.length > 0 ? ch.streams[0].stream_url : '';
                ch.provider_count = ch.streams.length;
            });
        }

        const countRes = await db.query('SELECT COUNT(*) FROM channels');

        res.json({
            data: channels,
            total: parseInt(countRes.rows[0].count),
            page,
            totalPages: Math.ceil(parseInt(countRes.rows[0].count) / limit)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CATALOG SEARCH (Backstage)
app.get('/api/admin/catalog', async (req, res) => {
    const { source, q, limit = 500 } = req.query;

    try {
        let query = 'SELECT * FROM provider_catalog WHERE 1=1';
        let params = [];
        let pIdx = 1;

        if (source) {
            query += ` AND account_id = $${pIdx++}`;
            params.push(source);
        }
        if (q) {
            query += ` AND (name ILIKE $${pIdx} OR category ILIKE $${pIdx})`;
            params.push(`%${q}%`);
            pIdx++;
        }

        query += ` LIMIT $${pIdx}`;
        params.push(limit);

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// CURATE: Move from Catalog to Live
app.post('/api/admin/channels/curate', async (req, res) => {
    const { itemIds, category } = req.body;

    try {
        let count = 0;
        for (const catId of itemIds) {
            const catItem = await db.query('SELECT * FROM provider_catalog WHERE id = $1', [catId]);
            if (catItem.rows.length > 0) {
                const item = catItem.rows[0];

                // 1. Create Logical Channel
                const newCh = await db.query(
                    'INSERT INTO channels (name, logo_url, category) VALUES ($1, $2, $3) RETURNING id',
                    [item.name, item.logo_url, category || item.category]
                );

                // 2. Add Physical Stream
                await db.query(
                    'INSERT INTO channel_streams (channel_id, stream_url, provider_id) VALUES ($1, $2, $3)',
                    [newCh.rows[0].id, item.stream_url, item.account_id]
                );

                count++;
            }
        }
        res.json({ success: true, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// MANUAL CREATE (Now supports multiple streams logic if we want, but keeping simple for now)
app.post('/api/admin/add-channel', async (req, res) => {
    const { name, streamUrl, logoUrl, password, streams } = req.body; // streams array optional
    // Checks...

    try {
        // Logical
        const newCh = await db.query(
            'INSERT INTO channels (name, logo_url, category) VALUES ($1, $2, $3) RETURNING id',
            [name, logoUrl, 'Manual']
        );
        const chId = newCh.rows[0].id;

        // Physical
        if (streams && Array.isArray(streams)) {
            for (const s of streams) {
                await db.query('INSERT INTO channel_streams (channel_id, stream_url) VALUES ($1, $2)', [chId, s]);
            }
        } else {
            await db.query('INSERT INTO channel_streams (channel_id, stream_url) VALUES ($1, $2)', [chId, streamUrl]);
        }

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

// ADD STREAM TO EXISTING CHANNEL
app.post('/api/admin/channels/:id/streams', async (req, res) => {
    const { id } = req.params;
    const { streamUrl, providerId } = req.body;
    try {
        await db.query(
            'INSERT INTO channel_streams (channel_id, stream_url, provider_id) VALUES ($1, $2, $3)',
            [id, streamUrl, providerId || null]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// UPDATE CHANNEL NAME
app.patch('/api/admin/channels/:id', async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    try {
        await db.query('UPDATE channels SET name = $1 WHERE id = $2', [name, id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- CATEGORY MANAGEMENT ---
app.get('/api/admin/categories', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM categories');
        // Convert to map for easy lookup
        const catMap = {};
        result.rows.forEach(c => catMap[c.name] = c.logo_url);
        res.json(catMap);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/categories', async (req, res) => {
    const { name, logoUrl } = req.body;
    try {
        // Upsert logic (Insert or Update)
        const check = await db.query('SELECT * FROM categories WHERE name = $1', [name]);
        if (check.rows.length > 0) {
            await db.query('UPDATE categories SET logo_url = $1 WHERE name = $2', [logoUrl, name]);
        } else {
            await db.query('INSERT INTO categories (name, logo_url) VALUES ($1, $2)', [name, logoUrl]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// SYNC PROVIDER (Populate Catalog)
app.post('/api/admin/accounts/:id/sync', async (req, res) => {
    const { id } = req.params;

    try {
        // Clear existing catalog items for this provider first?
        // User might want to refresh. Let's delete old ones for this provider.
        await db.query('DELETE FROM provider_catalog WHERE account_id = $1', [id]);

        const accRes = await db.query('SELECT * FROM accounts WHERE id = $1', [id]);
        if (accRes.rows.length === 0) return res.status(404).json({ error: 'Account not found' });

        const account = accRes.rows[0];
        let importedCount = 0;
        let totalCount = 0;

        // --- XTREAM SYNC ---
        if (account.type === 'm3u') {
            const { host_url, username, password } = account;
            if (!host_url || !username || !password) throw new Error('Missing Xtream credentials');

            const apiUrl = `${host_url}/player_api.php?username=${username}&password=${password}&action=get_live_streams`;
            const response = await fetch(apiUrl);
            if (response.status === 401 || response.status === 403) throw new Error('Authentication Failed');

            const streams = await response.json();
            if (!Array.isArray(streams)) throw new Error('Invalid response');

            totalCount = streams.length;
            // Batch insert is better but loop for now
            for (const s of streams) {
                const streamUrl = `${host_url}/live/${username}/${password}/${s.stream_id}.ts`;
                await db.query(
                    'INSERT INTO provider_catalog (name, stream_url, logo_url, category, account_id) VALUES ($1, $2, $3, $4, $5)',
                    [s.name, streamUrl, s.stream_icon, s.category_id || 'Xtream Import', id]
                );
                importedCount++;
            }
        }

        // --- STALKER SYNC ---
        else if (account.type === 'stalker') {
            // ... (Same logic as before but inserting into provider_catalog)
            let portalUrl = account.host_url;
            const mac = account.mac_address;
            if (!portalUrl.startsWith('http')) portalUrl = 'http://' + portalUrl;
            if (portalUrl.endsWith('/')) portalUrl = portalUrl.slice(0, -1);
            let portalApi = portalUrl + '/portal.php';
            if (portalUrl.endsWith('/c')) portalApi = portalUrl + '/portal.php';

            const headers = { 'Cookie': `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe%2FAmsterdam` };
            // Simplified Re-request logic for brevity (assuming same robust logic as before was good)
            // Simplified Re-request logic for brevity (assuming same robust logic as before was good)
            const doRequest = async (url, token = null) => {
                const h = { ...headers };
                if (token) h['Authorization'] = 'Bearer ' + token;

                const r = await fetch(url, { headers: h });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);

                const text = await r.text();
                // console.log(`[Sync] Response from ${url}:`, text.substring(0, 50));

                try {
                    const json = JSON.parse(text);
                    if (!json || (!json.js && !json.data && !json.token)) {
                        // Sometimes stalker returns weird stuff or empty
                        // throw new Error('Invalid Stalker Response Structure');
                    }
                    return json.js || json;
                } catch (e) {
                    console.error('[Sync] JSON Parse Error:', text);
                    throw new Error('Invalid JSON from Stalker');
                }
            };

            // Handshake
            let token;
            try { token = (await doRequest(`${portalApi}?type=stb&action=handshake&token=`)).token; }
            catch (e) {
                portalApi = portalUrl + '/c/portal.php';
                token = (await doRequest(`${portalApi}?type=stb&action=handshake&token=`)).token;
            }

            // Channels
            const data = await doRequest(`${portalApi}?type=itv&action=get_all_channels&JsHttpRequest=1-xml`, token);
            const channels = data.data;
            totalCount = channels.length;

            for (const ch of channels) {
                let streamUrl = ch.cmd;
                if (streamUrl && streamUrl.includes(' ')) streamUrl = streamUrl.split(' ').pop();
                if (streamUrl && (streamUrl.startsWith('http') || streamUrl.startsWith('rtmp'))) {
                    await db.query(
                        'INSERT INTO provider_catalog (name, stream_url, logo_url, category, account_id) VALUES ($1, $2, $3, $4, $5)',
                        [ch.name, streamUrl, ch.logo, 'Stalker Import', id]
                    );
                    importedCount++;
                }
            }
        }

        res.json({ success: true, imported: importedCount, total: totalCount });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// CHECK & PRUNE ACCOUNT
app.post('/api/admin/accounts/:id/check', async (req, res) => {
    // ... (Existing check logic, keeping it for manual button)
    // We will refactor the core logic to a function to reuse it.
    try {
        const result = await checkAndPruneAccount(req.params.id);
        res.json(result);
    } catch (e) {
        res.json({ status: 'UNKNOWN', message: 'Error: ' + e.message });
    }
});

// AUTO CHECK LOGIC (Reusable)
async function checkAndPruneAccount(id) {
    const accRes = await db.query('SELECT * FROM accounts WHERE id = $1', [id]);
    if (accRes.rows.length === 0) return { status: 'MISSING', message: 'Not found' };
    const account = accRes.rows[0];

    let isDead = false;
    let reason = '';

    try {
        if (account.type === 'm3u') {
            const apiUrl = `${account.host_url}/player_api.php?username=${account.username}&password=${account.password}`;
            const resp = await fetch(apiUrl);
            if (resp.status === 401 || resp.status === 403) {
                isDead = true; reason = 'HTTP ' + resp.status;
            } else {
                const data = await resp.json();
                if (!data.user_info || data.user_info.auth === 0) {
                    isDead = true; reason = 'Auth Rejected';
                }
            }
        } else if (account.type === 'stalker') {
            let portalUrl = account.host_url;
            if (!portalUrl.startsWith('http')) portalUrl = 'http://' + portalUrl;
            if (portalUrl.endsWith('/')) portalUrl = portalUrl.slice(0, -1);
            const mac = account.mac_address;
            const headers = { 'Cookie': `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe%2FAmsterdam` };

            let portalApi = portalUrl + '/portal.php';

            const url = `${portalApi}?type=stb&action=handshake&token=`;
            const r = await fetch(url, { headers });
            if (r.status === 401 || r.status === 403) { isDead = true; reason = 'Stalker HTTP ' + r.status; }
            else {
                const txt = await r.text();
                if (txt.includes('Authentication failed') || txt.includes('blocked')) {
                    isDead = true; reason = 'Stalker Auth Failed';
                }
            }
        }
    } catch (e) { /* Connection error - ignore */ }

    if (isDead) {
        console.log(`[Auto-Prune] Deleting Account ${id} (${reason})`);
        await db.query('DELETE FROM accounts WHERE id = $1', [id]);
        // Notify
        const msg = `Auto-Pruned: ${account.type.toUpperCase()} account (${account.host_url}) - Reason: ${reason}`;
        await db.query('INSERT INTO notifications (message, type) VALUES ($1, $2)', [msg, 'alert']);

        return { status: 'DEAD', message: msg };
    } else {
        return { status: 'ALIVE', message: 'OK' };
    }
}

// BACKGROUND JOB
async function runAutoCheck() {
    console.log('[Background] Starting Account Health Check...');
    try {
        const accounts = await db.query('SELECT id FROM accounts');
        for (const acc of accounts.rows) {
            await checkAndPruneAccount(acc.id);
        }
        console.log('[Background] Check Complete.');
    } catch (e) { console.error('[Background] Error:', e); }
}

// Run every 30 minutes (1800000 ms) - For demo we can trigger it too
// DISABLED ON VERCEL to prevent function timeout/crashes
if (!process.env.VERCEL) {
    setInterval(runAutoCheck, 30 * 60 * 1000);
    // Run once on start after 10 sec
    setTimeout(runAutoCheck, 10000);
} else {
    console.log('[Vercel] Background auto-check tasks disabled in serverless mode.');
}

// NOTIFICATIONS ROUTES
app.get('/api/admin/notifications', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/notifications/mark-read', async (req, res) => {
    try {
        await db.query('UPDATE notifications SET read = TRUE WHERE read = FALSE');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET DASHBOARD STATS
app.get('/api/admin/stats', async (req, res) => {
    try {
        const usersRes = await db.query('SELECT COUNT(DISTINCT device_id) FROM activation_keys WHERE device_id IS NOT NULL');
        const keysRes = await db.query('SELECT COUNT(*) FROM activation_keys');
        const channelsRes = await db.query('SELECT COUNT(*) FROM channels');
        const accountsRes = await db.query('SELECT COUNT(*) FROM accounts');

        res.json({
            users: usersRes.rows[0].count,
            keys: keysRes.rows[0].count,
            channels: channelsRes.rows[0].count,
            accounts: accountsRes.rows[0].count
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Stats error' });
    }
});

// GET ACCOUNTS
app.get('/api/admin/accounts', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM accounts ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CREATE ACCOUNT (Provider)
app.post('/api/admin/accounts', async (req, res) => {
    const { type, username, password, mac, durationDays, host } = req.body;

    try {
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + (parseInt(durationDays) || 30));

        await db.query(
            'INSERT INTO accounts (type, username, password, mac_address, expiration_date, host_url) VALUES ($1, $2, $3, $4, $5, $6)',
            [type, username, password, mac, expirationDate, host]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// DELETE ACCOUNT
app.delete('/api/admin/accounts/:id', async (req, res) => {
    const { id } = req.params;
    try {
        console.log(`[Delete] Attempting to delete account ID: ${id}`);

        // First check if account exists
        const checkRes = await db.query('SELECT type, mac_address, host_url FROM accounts WHERE id = $1', [id]);
        if (checkRes.rows.length === 0) {
            console.log(`[Delete] Account ${id} not found`);
            return res.json({ success: false, message: 'Account not found' });
        }

        const account = checkRes.rows[0];
        console.log(`[Delete] Found account: ${account.type} - ${account.mac_address || account.host_url}`);

        // Perform deletion
        const result = await db.query('DELETE FROM accounts WHERE id = $1', [id]);
        console.log(`[Delete] Deleted ${result.rowCount} row(s)`);

        // Verify deletion
        const verify = await db.query('SELECT id FROM accounts WHERE id = $1', [id]);
        if (verify.rows.length > 0) {
            console.error(`[Delete] ERROR: Account ${id} still exists after delete!`);
            return res.status(500).json({ error: 'Delete failed - account still exists' });
        }

        console.log(`[Delete] ✅ Account ${id} successfully deleted and verified`);
        res.json({ success: true, message: 'Account and all associated data deleted' });
    } catch (err) {
        console.error(`[Delete] Error deleting account ${id}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// Admin Keys
app.post('/api/admin/create-key', async (req, res) => {
    const { durationDays, password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(403).json({ error: 'Admin password required' });
    const key = Math.floor(10000000000 + Math.random() * 90000000000).toString();
    try {
        await db.query('INSERT INTO activation_keys (key_code, duration_days) VALUES ($1, $2)', [key, durationDays]);
        res.json({ success: true, key: key });
    } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.get('/api/admin/keys', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM activation_keys ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/keys/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM activation_keys WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/add-channel', async (req, res) => {
    const { name, streamUrl, logoUrl, password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) return res.status(403).json({ error: 'Admin password required' });
    try {
        await db.query('INSERT INTO channels (name, stream_url, logo_url) VALUES ($1, $2, $3)', [name, streamUrl, logoUrl]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.delete('/api/admin/channels/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM channels WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});






// Stalker Live Stream Proxy - FULL PROXY MODE (bypasses all server-side checks)
const stalkerDeviceCache = new Map(); // Global cache for device IDs

app.get('/api/stream/live/:channelId', async (req, res) => {
    try {
        const channelId = req.params.channelId;

        // FIXED: Join through channel_streams to get account and stream info
        // Removed explicit stalker_* columns to avoid DB errors if schema not updated
        const channelResult = await db.query(
            `SELECT c.name, c.logo_url, cs.stream_url, a.id as account_id, a.host_url, a.mac_address
             FROM channels c
             JOIN channel_streams cs ON c.id = cs.channel_id
             JOIN accounts a ON cs.provider_id = a.id
             WHERE c.id = $1 AND a.type = 'stalker'
             ORDER BY cs.priority ASC LIMIT 1`,
            [channelId]
        );

        if (channelResult.rows.length === 0) {
            console.log(`[Stalker Proxy] No Stalker stream for channel ${channelId}`);
            return res.status(404).send('Stalker stream not found');
        }

        const channel = channelResult.rows[0];

        // IN-MEMORY PERSISTENCE FALLBACK
        // Since DB columns might not exist, we use a global Map to store device IDs per MAC/Account
        const cacheKey = channel.mac_address; // Unique per Stalker account

        let deviceIds = stalkerDeviceCache.get(cacheKey);

        const randomDeviceId = () => Array.from({ length: 64 }, () => "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16))).join('');
        const randomSerialNumber = () => Array.from({ length: 13 }, () => "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16))).join('');

        if (!deviceIds) {
            deviceIds = {
                deviceId: randomDeviceId(),
                deviceId2: randomDeviceId(),
                serialNumber: randomSerialNumber()
            };
            stalkerDeviceCache.set(cacheKey, deviceIds);
            console.log(`[Stalker Proxy] Generated new in-memory device IDs for MAC ${cacheKey}`);
        } else {
            console.log(`[Stalker Proxy] Using cached device IDs for MAC ${cacheKey}`);
        }

        const { deviceId: deviceId1, deviceId2, serialNumber } = deviceIds;

        console.log(`[Stalker Proxy] Using persistent device: SN=${serialNumber}`);

        // Extract stream ID from stored URL
        let streamId = channel.stream_url;
        // Method 1: Check for 'stream=' query parameter (most common for Stalker)
        const streamMatch = streamId.match(/[?&]stream=(\d+)/);
        if (streamMatch) {
            streamId = streamMatch[1];
        }
        // Method 2: Check for /ch/<id> format
        else if (streamId.includes('/ch/')) {
            const chMatch = streamId.match(/\/ch\/(\d+)/);
            if (chMatch) {
                streamId = chMatch[1];
            }
        }
        // Method 3: If it's just a number, use it directly
        else if (/^\d+$/.test(streamId.trim())) {
            streamId = streamId.trim();
        }
        else {
            console.warn(`[Stalker Proxy] Could not extract stream ID, using raw value: ${streamId}`);
        }

        const StalkerClient = require('./modules/stalker-client');
        // Pass persistent device IDs to client
        const client = new StalkerClient(channel.host_url, channel.mac_address, {
            deviceId: deviceId1,
            deviceId2: deviceId2,
            serialNumber: serialNumber
        });

        // Perform handshake/auth
        await client.handshake();

        // Generate valid link
        const freshUrl = await client.createLink(streamId);

        if (!freshUrl) {
            console.error(`[Stalker Proxy] Failed to create link for channel ${channelId}`);
            return res.status(500).send('Stalker Link Creation Failed');
        }

        // console.log(`[Stalker Proxy] Generated fresh link for ${channel.name}`);

        // FULL PROXY: Fetch stream with all required headers and pipe to player
        // This completely hides the player from the stream server!
        let hostUrl = channel.host_url;
        if (!hostUrl.startsWith('http')) hostUrl = 'http://' + hostUrl;
        if (hostUrl.endsWith('/')) hostUrl = hostUrl.slice(0, -1);

        // USE AUTHENTICATED CREDENTIALS FROM CLIENT
        // This ensures mismatch (SN/Token) is avoided
        // serialNumber is already defined above, so we just use the token from client
        const token = client.token;

        const streamHeaders = {
            'User-Agent': client.headers['User-Agent'], // Use same UA as handshake
            'Cookie': client.headers['Cookie'],         // Use same Cookie as handshake
            'Referer': client.headers['Referer'],       // Use same Referer as handshake
            'X-User-Agent': client.headers['X-User-Agent'],
            'X-STB-Serial': serialNumber,
            'Accept': '*/*',
            'Accept-Encoding': 'identity;q=1.0, *;q=0', // Avoid compression for streams
            'Connection': 'keep-alive'
        };

        // Add Authorization if we have a token (some servers check this even for streams)
        if (token) {
            streamHeaders['Authorization'] = 'Bearer ' + token;
        }

        // console.log(`[Stalker Proxy] Fetching stream: ${freshUrl}`);

        // Explicitly use GET and manual redirect handling to debug
        const streamResponse = await fetch(freshUrl, {
            method: 'GET',
            headers: streamHeaders,
            redirect: 'manual'
        });

        // Handle Redirects Manually to preserve headers if needed
        if (streamResponse.status >= 300 && streamResponse.status < 400) {
            const location = streamResponse.headers.get('location');
            // console.log(`[Stalker Proxy] Redirect detected (Status ${streamResponse.status}) to: ${location}`);

            if (location) {
                // Determine absolute URL
                const nextUrl = location.startsWith('http') ? location : new URL(location, freshUrl).toString();
                // console.log(`[Stalker Proxy] Following redirect to: ${nextUrl}`);

                // Retry fetch with new URL
                const redirectedResponse = await fetch(nextUrl, {
                    method: 'GET',
                    headers: streamHeaders, // Preserve headers!
                    redirect: 'manual'
                });

                if (!redirectedResponse.ok) {
                    console.error(`[Stalker Proxy] Redirected stream fetch failed: ${redirectedResponse.status}`);
                    console.error(`[Stalker Proxy] Allow Header: ${redirectedResponse.headers.get('allow')}`);
                    const errText = await redirectedResponse.text().catch(() => '');
                    console.error(`[Stalker Proxy] Error Body: ${errText.substring(0, 200)}`);
                    return res.status(redirectedResponse.status).send(`Stream Error: ${redirectedResponse.status}`);
                }

                // Success on redirect
                res.setHeader('Content-Type', redirectedResponse.headers.get('content-type') || 'video/mp2t');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Connection', 'keep-alive');
                redirectedResponse.body.pipe(res);
                return;
            }
        }

        if (!streamResponse.ok) {
            console.error(`[Stalker Proxy] Stream fetch failed: ${streamResponse.status}`);
            console.error(`[Stalker Proxy] Allow Header: ${streamResponse.headers.get('allow')}`);
            console.error(`[Stalker Proxy] Location Header: ${streamResponse.headers.get('location')}`);

            // Log all headers for deep debugging
            const headersObj = {};
            streamResponse.headers.forEach((v, k) => headersObj[k] = v);
            console.error(`[Stalker Proxy] Response Headers:`, headersObj);

            const errText = await streamResponse.text().catch(() => '');
            console.error(`[Stalker Proxy] Error Body: ${errText.substring(0, 200)}`);
            return res.status(streamResponse.status).send(`Stream Error: ${streamResponse.status}`);
        }

        // Set response headers for video streaming
        res.setHeader('Content-Type', streamResponse.headers.get('content-type') || 'video/mp2t');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        res.setHeader('Connection', 'keep-alive');

        // Pipe the stream directly to the player - the magic trick!
        streamResponse.body.pipe(res);

        // Handle client disconnect
        req.on('close', () => {
            console.log(`[Stalker Proxy] Client disconnected from ${channel.name}`);
            streamResponse.body.destroy();
        });

    } catch (err) {
        console.error('[Stalker Proxy] Error:', err);
        res.status(500).send('Stalker Error: ' + err.message);
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;

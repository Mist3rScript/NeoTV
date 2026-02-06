// Generate device ID endpoint
app.post('/api/get-device-id', (req, res) => {
    const { fingerprint } = req.body;

    // Generate stable ID from browser fingerprint
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(fingerprint || Date.now().toString()).digest('hex');
    const deviceId = 'device_' + hash.substring(0, 16);

    res.json({ deviceId });
});

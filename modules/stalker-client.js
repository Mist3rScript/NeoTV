const fetch = require('node-fetch');
const crypto = require('crypto');

// Helpers for random IDs
const randomDeviceId = () => Array.from({ length: 64 }, () => "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16))).join('');
const randomSerialNumber = () => Array.from({ length: 13 }, () => "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16))).join('');

class StalkerClient {
    constructor(hostUrl, mac, options = {}) {
        this.hostUrl = hostUrl;
        this.mac = mac;

        // Use provided IDs or generate new ones
        this.deviceId = options.deviceId || randomDeviceId();
        this.deviceId2 = options.deviceId2 || randomDeviceId();
        this.serialNumber = options.serialNumber || randomSerialNumber();

        // Normalize URL
        if (!this.hostUrl.startsWith('http')) this.hostUrl = 'http://' + this.hostUrl;
        if (this.hostUrl.endsWith('/')) this.hostUrl = this.hostUrl.slice(0, -1);

        // Determine initial API endpoint logic (will be refined in handshake)
        this.portalApi = this.hostUrl + '/portal.php';

        // Common headers for Stalker
        this.headers = {
            'Cookie': `mac=${encodeURIComponent(this.mac)}; stb_lang=en; timezone=Europe%2FAmsterdam`,
            'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250 stbapp ver: 4 rev: 1812 Mobile Safari/533.3',
            'Referer': this.hostUrl + '/c/',
            'X-User-Agent': 'Model: MAG254; Link: Ethernet',
            'SN': this.serialNumber
        };

        this.token = null;
    }

    async doRequest(url, extraHeaders = {}) {
        // console.log(`[Stalker] Request: ${url}`);
        const headers = { ...this.headers, ...extraHeaders };
        const response = await fetch(url, { headers });

        if (!response.ok) {
            throw new Error(`Stalker HTTP Error: ${response.status}`);
        }

        const text = await response.text();
        try {
            const data = JSON.parse(text);
            return data.js || data;
        } catch (e) {
            console.error('[Stalker] Parse Error:', text);
            throw new Error('Invalid JSON response from Stalker');
        }
    }

    async handshake() {
        try {
            // 1. Try Handshake on common paths
            const pathsToTry = [
                '/portal.php',
                '/c/portal.php',
                '/server/load.php'
            ];

            let handshakeSuccess = false;

            for (const path of pathsToTry) {
                try {
                    const testUrl = this.hostUrl + path + '?type=stb&action=handshake&token=';
                    this.portalApi = this.hostUrl + path; // Set conditionally

                    const data = await this.doRequest(testUrl);
                    if (data && data.token) {
                        this.token = data.token;
                        console.log(`[Stalker] Handshake successful on ${path}, token: ${this.token}`);
                        handshakeSuccess = true;
                        break;
                    }
                } catch (e) {
                    // Continue to next path
                }
            }

            if (!handshakeSuccess) {
                console.error('[Stalker] Handshake failed on all paths');
                return false;
            }

            // 2. GET PROFILE (Critical Step for Authentication)
            // Use the token from handshake in Authorization header
            console.log('[Stalker] Requesting Profile to activate session...');

            const profileParams = new URLSearchParams({
                type: 'stb',
                action: 'get_profile',
                hd: '1',
                auth_second_step: '0',
                num_banks: '1',
                stb_type: '',
                image_version: '',
                hw_version: '',
                not_valid_token: '0',
                device_id: this.deviceId,
                device_id2: this.deviceId2,
                signature: '',
                sn: this.serialNumber,
                ver: '',
                JsHttpRequest: '1-xml'
            });

            const profileUrl = `${this.portalApi}?${profileParams.toString()}`;

            // Important: Send Bearer token here
            await this.doRequest(profileUrl, {
                'Authorization': `Bearer ${this.token}`
            });

            console.log('[Stalker] Session activated successfully.');
            return true;

        } catch (e) {
            console.error('[Stalker] Handshake/Profile error:', e);
            return false;
        }
    }

    async createLink(cmd) {
        if (!this.token) {
            await this.handshake();
        }

        try {
            // cmd is usually the channel ID (stream_id)
            // We use the same headers (including Authorization if needed, though cookie is primary now)

            // FFRT format is standard for MAG
            const actionUrl = `${this.portalApi}?type=itv&action=create_link&cmd=ffrt%20http://localhost/ch/${cmd}&series=&forced_storage=0&disable_ad=0&JsHttpRequest=1-xml`;

            // console.log(`[Stalker] createLink request: ${actionUrl}`);

            const headers = { ...this.headers };
            if (this.token) headers['Authorization'] = 'Bearer ' + this.token;

            const response = await fetch(actionUrl, { headers });
            
            if (!response.ok) {
                console.error(`[Stalker] createLink HTTP Error: ${response.status}`);
                return null;
            }

            const text = await response.text();
            let result;
            try {
                const data = JSON.parse(text);
                result = data.js || data;
            } catch (jsonErr) {
                console.error(`[Stalker] createLink JSON parse error for ${cmd}:`, text.substring(0, 100));
                return null;
            }

            // console.log(`[Stalker] createLink RAW response:`, JSON.stringify(result));

            if (result && result.cmd) {
                let streamUrl = result.cmd;

                // console.log(`[Stalker] createLink raw cmd: "${streamUrl}"`);

                // Extract URL from ffmpeg/ffrt command string
                if (streamUrl.includes('http')) {
                    streamUrl = streamUrl.substring(streamUrl.indexOf('http'));
                }

                // Trimming whitespace and anything after the URL
                streamUrl = streamUrl.split(' ')[0].trim();

                // console.log(`[Stalker] createLink parsed URL: "${streamUrl}"`);

                return streamUrl;
            } else {
                console.error('[Stalker] Create Link failed:', result);
                return null;
            }

        } catch (e) {
            console.error('[Stalker] Create Link Error:', e);
            return null;
        }
    }
}

module.exports = StalkerClient;

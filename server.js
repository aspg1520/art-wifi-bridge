const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

const OMADA_CONFIG = {
    baseUrl: 'https://62.72.47.203:8043',
    clientId: 'f667b9a2cf204791853815625ea55072',
    clientSecret: '0eb1d714a8b54de8b7b5c63a541d2a67',
    omadacId: 'dd4b631441b02b1d9787466c7bf876f7',
    siteId: '6a615c90e78f4e28047ab010'
};

const PORTAL_BASE_URL = 'http://62.72.47.203:8080';

const HOTSPOT_OPERATOR = {
    username: '85140442',
    password: 'MSFKServer-85140442'
};

let omadaToken = null;
let hotspotCsrfToken = null;
let hotspotCookie = null;

const agent = new https.Agent({  
    rejectUnauthorized: false
});

async function loginOmada() {
    try {
        const tokenUrl = `${OMADA_CONFIG.baseUrl}/openapi/authorize/token?grant_type=client_credentials`;
        const response = await axios.post(tokenUrl, {
            omadacId: OMADA_CONFIG.omadacId,
            client_id: OMADA_CONFIG.clientId,
            client_secret: OMADA_CONFIG.clientSecret
        }, {
            httpsAgent: agent,
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.errorCode === 0 && response.data.result) {
            omadaToken = response.data.result.accessToken;
            return true;
        }
        return false;
    } catch (err) {
        return false;
    }
}

async function loginHotspotOperator() {
    try {
        const loginUrl = `${OMADA_CONFIG.baseUrl}/${OMADA_CONFIG.omadacId}/api/v2/hotspot/login`;
        const response = await axios.post(loginUrl, {
            name: HOTSPOT_OPERATOR.username,
            password: HOTSPOT_OPERATOR.password
        }, {
            httpsAgent: agent,
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.errorCode === 0 && response.data.result) {
            hotspotCsrfToken = response.data.result.token;
            const setCookieHeader = response.headers['set-cookie'];
            if (setCookieHeader && setCookieHeader.length) {
                hotspotCookie = setCookieHeader.map(c => c.split(';')[0]).join('; ');
            }
            return true;
        }
        return false;
    } catch (err) {
        return false;
    }
}

async function fetchVoucherByCode(code) {
    if (!hotspotCsrfToken || !hotspotCookie) {
        const ok = await loginHotspotOperator();
        if (!ok) return null;
    }

    try {
        const vouchersUrl = `${OMADA_CONFIG.baseUrl}/${OMADA_CONFIG.omadacId}/api/v2/hotspot/sites/${OMADA_CONFIG.siteId}/vouchers?currentPage=1&currentPageSize=500&status=All`;
        const response = await axios.get(vouchersUrl, {
            httpsAgent: agent,
            headers: {
                'Csrf-Token': hotspotCsrfToken,
                'Cookie': hotspotCookie,
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.errorCode === 0) {
            const vouchers = response.data.result.data || response.data.result || [];
            const allMatches = vouchers.filter(v => (v.code || '').toString().trim() === code.trim());
            
            const matched = allMatches.reduce((best, v) => {
                if (!best) return v;
                return (v.startTime || 0) > (best.startTime || 0) ? v : best;
            }, null);

            if (matched && matched.id) {
                try {
                    const detailUrl = `${OMADA_CONFIG.baseUrl}/${OMADA_CONFIG.omadacId}/api/v2/hotspot/sites/${OMADA_CONFIG.siteId}/vouchers/${matched.id}`;
                    const detailRes = await axios.get(detailUrl, {
                        httpsAgent: agent,
                        headers: {
                            'Csrf-Token': hotspotCsrfToken,
                            'Cookie': hotspotCookie,
                            'Content-Type': 'application/json'
                        }
                    });
                    if (detailRes.data && detailRes.data.errorCode === 0 && detailRes.data.result) {
                        Object.assign(matched, detailRes.data.result);
                    }
                } catch (detailErr) {}
            }
            return matched || null;
        }
        return null;
    } catch (err) {
        hotspotCsrfToken = null;
        hotspotCookie = null;
        return null;
    }
}

async function fetchLivePortalSession(clientMac, apMac, ssidName, cliToken) {
    try {
        const url = `${PORTAL_BASE_URL}/portal/getLogoutPageSetting`;
        const response = await axios.post(url, {
            clientMac,
            apMac,
            ssidName,
            cliToken
        }, {
            headers: { 'Content-Type': 'application/json;charset=utf-8' },
            timeout: 8000
        });

        if (response.data && response.data.errorCode === 0 && response.data.result) {
            return response.data.result;
        }
        return null;
    } catch (err) {
        return null;
    }
}

app.get('/api/check-time', async (req, res) => {
    let clientMac = req.query.mac || req.query.clientMac;
    let voucherCode = req.query.voucher || req.query.username;
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const apMac = req.query.apMac;
    const ssidName = req.query.ssidName || req.query.ssid;
    const cliToken = req.query.cliToken;

    // 1. Gamitin ang Omada portal endpoint kung kompleto ang parameters mula sa URL
    if (clientMac && clientMac !== 'NOT_AVAILABLE' && apMac && ssidName && cliToken) {
        const liveSession = await fetchLivePortalSession(clientMac, apMac, ssidName, cliToken);
        if (liveSession && typeof liveSession.timeLeft !== 'undefined') {
            return res.json({
                success: true,
                mac: clientMac,
                ip: liveSession.ip || clientIp,
                remainingSeconds: Math.max(0, Math.round(liveSession.timeLeft)),
                voucherCode: liveSession.username || voucherCode || "ACTIVE",
                uptime: typeof liveSession.uptime !== 'undefined' ? liveSession.uptime : undefined,
                usedTime: typeof liveSession.timeUsed !== 'undefined' ? liveSession.timeUsed : undefined
            });
        }
    }

    try {
        if (!omadaToken) {
            let loggedIn = await loginOmada();
            if (!loggedIn) {
                return res.status(500).json({ success: false, error: 'Hindi makakonekta sa Omada API.' });
            }
        }

        const headers = {
            'Authorization': `AccessToken=${omadaToken}`,
            'Content-Type': 'application/json'
        };

        let realMac = clientMac !== 'NOT_AVAILABLE' ? clientMac : null;
        let realIp = null;
        let effectiveVoucherCode = (voucherCode && voucherCode !== 'ACTIVE' && voucherCode !== 'INPUT CODE BELOW')
            ? voucherCode.trim()
            : null;

        try {
            const clientApiUrl = `${OMADA_CONFIG.baseUrl}/openapi/v1/${OMADA_CONFIG.omadacId}/sites/${OMADA_CONFIG.siteId}/clients?page=1&pageSize=500`;
            const clientsRes = await axios.get(clientApiUrl, { headers, httpsAgent: agent });

            if (clientsRes.data && clientsRes.data.errorCode === 0) {
                const clients = clientsRes.data.result.data || clientsRes.data.result || [];
                let matchedClient = null;

                if (realMac && realMac !== 'NOT_AVAILABLE') {
                    matchedClient = clients.find(c => c.mac && c.mac.toLowerCase() === realMac.toLowerCase());
                }

                if (!matchedClient && effectiveVoucherCode) {
                    matchedClient = clients.find(c =>
                        (c.authInfo || []).some(a => (a.info || '').toString().trim() === effectiveVoucherCode)
                    );
                }

                if (matchedClient) {
                    realMac = matchedClient.mac || realMac;
                    realIp = matchedClient.ip || null;

                    if (!effectiveVoucherCode) {
                        const voucherAuth = (matchedClient.authInfo || []).find(a => a.authType === 3);
                        if (voucherAuth && voucherAuth.info) {
                            effectiveVoucherCode = voucherAuth.info.toString().trim();
                        }
                    }
                }
            } else {
                if (clientsRes.data && clientsRes.data.errorCode === -44112) omadaToken = null;
            }
        } catch (clientErr) {}

        if (effectiveVoucherCode) {
            const matchedVoucher = await fetchVoucherByCode(effectiveVoucherCode);
            if (matchedVoucher) {
                const durationSec = (matchedVoucher.duration || 0) * 60;
                let computedLeft;

                if (matchedVoucher.used && matchedVoucher.used > 0 && matchedVoucher.startTime) {
                    const elapsedSec = (Date.now() - matchedVoucher.startTime) / 1000;
                    computedLeft = durationSec - elapsedSec;
                } else {
                    computedLeft = durationSec;
                }

                return res.json({
                    success: true,
                    mac: realMac || "NOT_AVAILABLE",
                    ip: realIp || clientIp,
                    remainingSeconds: Math.max(0, Math.round(computedLeft)),
                    voucherCode: effectiveVoucherCode
                });
            }
        }

        if (realMac && realMac !== 'NOT_AVAILABLE') {
            return res.json({
                success: true,
                mac: realMac,
                ip: realIp || clientIp,
                remainingSeconds: 0,
                voucherCode: effectiveVoucherCode || "N/A"
            });
        }

        res.json({ success: false, message: 'Hindi mahanap ang active session.' });

    } catch (err) {
        omadaToken = null;
        res.status(500).json({ success: false, error: 'Server communication error' });
    }
});

app.get('/api/logout', async (req, res) => {
    const clientMac = req.query.mac || req.query.clientMac;
    const apMac = req.query.apMac;
    const ssidName = req.query.ssidName || req.query.ssid;
    const cliToken = req.query.cliToken;

    if (clientMac && apMac && ssidName && cliToken) {
        try {
            const url = `${PORTAL_BASE_URL}/portal/logout`;
            await axios.post(url, { clientMac, apMac, ssidName, cliToken }, {
                headers: { 'Content-Type': 'application/json;charset=utf-8' },
                timeout: 8000
            });
        } catch (err) {}
    }
    res.json({ success: true });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

app.listen(3000, () => {
    console.log('ART WIFI Server running on port 3000');
    loginOmada();
});
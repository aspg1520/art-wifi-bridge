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
    omadacId: 'dd4b631441b02b1d9787466c7bf876f7', // kumpirmado galing sa /api/info
    siteId: '6a615c90e78f4e28047ab010'
};

let omadaToken = null;
let omadaCookies = null;

const agent = new https.Agent({  
    rejectUnauthorized: false
});

async function loginOmada() {
    try {
        console.log('Nag-uusap sa Omada Open API login (client_credentials)...');

        // Walang /v1/ sa token endpoint; grant_type ay nasa query string
        const tokenUrl = `${OMADA_CONFIG.baseUrl}/openapi/authorize/token?grant_type=client_credentials`;

        const response = await axios.post(tokenUrl, {
            omadacId: OMADA_CONFIG.omadacId,       // 'omadacId' (may 'c') ang inaasahang key ng Omada API
            client_id: OMADA_CONFIG.clientId,
            client_secret: OMADA_CONFIG.clientSecret
        }, {
            httpsAgent: agent,
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.errorCode === 0 && response.data.result) {
            omadaToken = response.data.result.accessToken;
            console.log('SUCCESS: Nakakuha ng Omada Open API Token!');
            return true;
        } else {
            console.error('Omada API Login Error Response:', response.data);
            return false;
        }
    } catch (err) {
        console.error('Login Exception:', err.message);
        if (err.response) {
            console.error('Response Status:', err.response.status, err.response.data);
        }
        return false;
    }
}

app.get('/api/check-time', async (req, res) => {
    let clientMac = req.query.mac;
    let voucherCode = req.query.voucher || req.query.username;
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

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

        // 1. Kung may voucher code, tignan muna natin diretso sa Vouchers list
        // — dito galing ang tunay na "Used Time" / "Left Time" na nakikita mo sa admin dashboard.
        if (voucherCode && voucherCode !== 'ACTIVE' && voucherCode !== 'INPUT CODE BELOW') {
            try {
                const voucherApiUrl = `${OMADA_CONFIG.baseUrl}/openapi/v1/${OMADA_CONFIG.omadacId}/sites/${OMADA_CONFIG.siteId}/hotspot/vouchers?page=1&pageSize=500`;
                const voucherRes = await axios.get(voucherApiUrl, { headers, httpsAgent: agent });

                if (voucherRes.data && voucherRes.data.errorCode === 0) {
                    const vouchers = voucherRes.data.result.data || voucherRes.data.result || [];
                    const cleanCode = voucherCode.trim();
                    const matchedVoucher = vouchers.find(v => (v.code || '').toString().trim() === cleanCode);

                    if (matchedVoucher) {
                        // DEBUG: makikita natin dito sa Render logs ang TUNAY na field names
                        console.log('MATCHED VOUCHER RAW DATA:', JSON.stringify(matchedVoucher));

                        // Karaniwang field names sa Omada vouchers (huhulaan muna, i-confirm sa raw log sa itaas)
                        const durationSec = (matchedVoucher.duration || 0) * 60; // 'duration' kadalasan nasa MINUTES
                        const usedSec = (matchedVoucher.usedTime || matchedVoucher.used || 0) * 60;
                        const computedLeft = matchedVoucher.remainingTime
                            ?? matchedVoucher.leftTime
                            ?? (durationSec ? (durationSec - usedSec) : null);

                        if (computedLeft !== null && computedLeft !== undefined) {
                            return res.json({
                                success: true,
                                mac: clientMac || "NOT_AVAILABLE",
                                ip: clientIp,
                                remainingSeconds: Math.max(0, Math.round(computedLeft)),
                                voucherCode: voucherCode,
                                debug: matchedVoucher // TANGGALIN NATIN 'TO PAG TAMA NA
                            });
                        }
                    } else {
                        console.log(`Walang nahanap na voucher na may code: ${cleanCode}`);
                    }
                } else {
                    console.log('Vouchers API Error Code:', voucherRes.data ? voucherRes.data.errorCode : 'Unknown');
                }
            } catch (voucherErr) {
                console.error('Voucher fetch error:', voucherErr.message);
            }
        }

        // 2. Fallback: tignan sa connected clients list (para sa MAC-based lookup)
        const clientApiUrl = `${OMADA_CONFIG.baseUrl}/openapi/v1/${OMADA_CONFIG.omadacId}/sites/${OMADA_CONFIG.siteId}/clients?page=1&pageSize=500`;
        console.log(`Tinatarget ang Open API Clients URL: ${clientApiUrl}`);

        const response = await axios.get(clientApiUrl, {
            headers: headers,
            httpsAgent: agent
        });

        if (response.data && response.data.errorCode === 0) {
            const clients = response.data.result.data || response.data.result || [];
            console.log(`Active clients nakuha: ${clients.length}`);

            let matchedClient = null;

            if (voucherCode && voucherCode !== 'ACTIVE' && voucherCode !== 'INPUT CODE BELOW') {
                const cleanCode = voucherCode.trim().toLowerCase();
                matchedClient = clients.find(c => {
                    const textBlob = JSON.stringify(c).toLowerCase();
                    return textBlob.includes(cleanCode);
                });
            }

            if (!matchedClient && clientMac && clientMac !== 'NOT_AVAILABLE') {
                matchedClient = clients.find(c => c.mac && c.mac.toLowerCase() === clientMac.toLowerCase());
            }

            if (!matchedClient && clients.length === 1) {
                matchedClient = clients[0];
            }

            if (matchedClient) {
                console.log('MATCHED CLIENT RAW DATA:', JSON.stringify(matchedClient));
                const remainingSeconds = matchedClient.remainingTime || matchedClient.duration || matchedClient.leftTime || matchedClient.remainTime || matchedClient.validTime || 3600;
                
                return res.json({
                    success: true,
                    mac: matchedClient.mac || clientMac || "NOT_AVAILABLE",
                    ip: matchedClient.ip || clientIp,
                    remainingSeconds: remainingSeconds,
                    voucherCode: voucherCode || matchedClient.authName || matchedClient.name || "ACTIVE"
                });
            }
        } else {
            console.log("Open API Error Code:", response.data ? response.data.errorCode : 'Unknown');
            omadaToken = null; 
        }

        res.json({ success: false, message: 'Hindi mahanap ang active session.' });

    } catch (err) {
        console.error('Error sa pagkuha ng clients:', err.message);
        omadaToken = null;
        res.status(500).json({ success: false, error: 'Server communication error' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

app.listen(3000, () => {
    console.log('ART WIFI Server running on port 3000');
    loginOmada();
});
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

// Omada Open API Configuration
const OMADA_CONFIG = {
    baseUrl: 'https://62.72.47.203:8043',
    clientId: '2d97f4d977fd41cf9c14412269036368',
    clientSecret: '25b6e7c890ea48228f5ef0a52156d9f8',
    omadaId: '627247203', // Omada Controller ID o omadaId kung kinakailangan
    siteId: '6a615c90e78f4e28047ab010'
};

let accessToken = null;

const agent = new https.Agent({  
    rejectUnauthorized: false
});

// Function para sa Omada OpenAPI Authentication (OAuth2 / Client Credentials style o Omada Open API signature)
async function loginOmadaOpenAPI() {
    try {
        console.log('Kumokonekta sa Omada Open API...');
        
        const timestamp = Date.now();
        // Karaniwang format ng Omada OpenAPI signature o token request
        const stringToSign = `${OMADA_CONFIG.clientId}${timestamp}`;
        const signature = crypto.createHmac('sha256', OMADA_CONFIG.clientSecret)
                                .update(stringToSign)
                                .digest('hex');

        const response = await axios.post(`${OMADA_CONFIG.baseUrl}/openapi/v1/authorize/token`, {
            client_id: OMADA_CONFIG.clientId,
            timestamp: timestamp,
            signature: signature
        }, {
            httpsAgent: agent,
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.errorCode === 0) {
            accessToken = response.data.result.accessToken;
            console.log('SUCCESS: Matagumpay na nakakuha ng Omada OpenAPI Token!');
            return true;
        } else {
            console.error('OpenAPI Login Error:', response.data);
            return false;
        }
    } catch (err) {
        console.error('OpenAPI Login Failed:', err.message);
        return false;
    }
}

app.get('/api/check-time', async (req, res) => {
    console.log("May pumasok na request sa /api/check-time! Query params:", req.query);

    let clientMac = req.query.mac;
    let voucherCode = req.query.voucher || req.query.username;
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    try {
        if (!accessToken) {
            let loggedIn = await loginOmadaOpenAPI();
            if (!loggedIn) {
                return res.status(500).json({ success: false, error: 'Hindi makakonekta sa Omada OpenAPI.' });
            }
        }

        // Gamitin ang OpenAPI endpoint para sa clients ng specific site
        const response = await axios.get(`${OMADA_CONFIG.baseUrl}/openapi/v1/sites/${OMADA_CONFIG.siteId}/clients`, {
            headers: {
                'Access-Token': accessToken,
                'Content-Type': 'application/json'
            },
            httpsAgent: agent
        });

        console.log("Omada OpenAPI Clients Response Status:", response.data.errorCode);

        if (response.data && response.data.errorCode === 0) {
            const clients = response.data.result.data || response.data.result || [];
            console.log(`Kabuuang active clients: ${clients.length}`);

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
                console.log("MATCHED CLIENT FOUND:", JSON.stringify(matchedClient, null, 2));

                const remainingSeconds = matchedClient.remainingTime || matchedClient.duration || matchedClient.leftTime || matchedClient.validTime || 3600;
                
                return res.json({
                    success: true,
                    mac: matchedClient.mac || clientMac || "NOT_AVAILABLE",
                    ip: matchedClient.ip || clientIp,
                    remainingSeconds: remainingSeconds,
                    voucherCode: voucherCode || matchedClient.authName || matchedClient.name || "ACTIVE"
                });
            } else {
                console.log("Walang nag-match na client para sa voucher/mac na ito.");
            }
        } else if (response.data && response.data.errorCode === -1100 || response.data.errorCode === -1) {
            accessToken = null; // I-reset kung expired ang token
        }

        res.json({ success: false, message: 'Hindi mahanap ang active session o invalid ang voucher code.' });

    } catch (err) {
        console.error('Error fetching Omada OpenAPI data:', err.message);
        if (err.response && (err.response.status === 401 || err.response.status === 403)) {
            accessToken = null;
        }
        res.status(500).json({ success: false, error: 'Server communication error with Omada OpenAPI' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

app.listen(3000, () => {
    console.log('ART WIFI Omada OpenAPI Bridge running on port 3000');
    loginOmadaOpenAPI();
});
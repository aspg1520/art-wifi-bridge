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
    clientId: '2d97f4d977fd41cf9c14412269036368',
    clientSecret: '25b6e7c890ea48228f5ef0a52156d9f8',
    omadaId: 'dd4b631441b02b1d9787466c7bf876f',
    siteId: '6a615c90e78f4e28047ab010'
};

let omadaToken = null;
let omadaCookies = null;

const agent = new https.Agent({  
    rejectUnauthorized: false
});

async function loginOmada() {
    try {
        console.log('Nag-uusap sa Omada Open API login...');
        // Ang tamang pag-authenticate gamit ang Open API Client Credentials
        const response = await axios.post(`${OMADA_CONFIG.baseUrl}/api/v2/oauth/token`, {
            client_id: OMADA_CONFIG.clientId,
            client_secret: OMADA_CONFIG.clientSecret,
            grant_type: 'client_credentials'
        }, { 
            httpsAgent: agent,
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && (response.data.errorCode === 0 || response.data.access_token)) {
            omadaToken = response.data.result?.token || response.data.access_token;
            console.log('SUCCESS: Nakakuha ng Omada Open API Token!');
            return true;
        } else {
            console.error('Omada API Login Error:', response.data);
            return false;
        }
    } catch (err) {
        console.error('Login Exception:', err.message);
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
            'Authorization': `Bearer ${omadaToken}`,
            'Csrf-Token': omadaToken,
            'Content-Type': 'application/json'
        };

        const clientApiUrl = `${OMADA_CONFIG.baseUrl}/api/v2/${OMADA_CONFIG.omadaId}/sites/${OMADA_CONFIG.siteId}/clients?currentPage=1&pageSize=500`;
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
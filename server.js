const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

// I-serve ang mga static files mula sa 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

const OMADA_CONFIG = {
    baseUrl: 'https://62.72.47.203:8043',
    username: 'aspg1520@gmail.com',
    password: 'Lja231827@@',
    siteId: 'c079d99361c04d149718906a869580ec'
};

let omadaToken = null;

async function loginOmada() {
    try {
        const response = await axios.post(`${OMADA_CONFIG.baseUrl}/api/v2/login`, {
            username: OMADA_CONFIG.username,
            password: OMADA_CONFIG.password
        }, { httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }) });

        if (response.data && response.data.errorCode === 0) {
            omadaToken = response.data.result.token;
            console.log('Connected successfully to Omada Controller API');
        }
    } catch (err) {
        console.error('Omada Login Failed:', err.message);
    }
}

app.get('/api/check-time', async (req, res) => {
    let clientMac = req.query.mac;
    let voucherCode = req.query.voucher || req.query.username;
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    try {
        if (!omadaToken) {
            await loginOmada();
        }

        const response = await axios.get(`${OMADA_CONFIG.baseUrl}/api/v2/sites/${OMADA_CONFIG.siteId}/clients`, {
            headers: { 'Csrf-Token': omadaToken },
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });

        if (response.data && response.data.errorCode === 0) {
            const clients = response.data.result.data || [];
            
            let matchedClient = null;

            // 1. Hanapin muna gamit ang Voucher Code / Username kung ibinigay
            if (voucherCode && voucherCode !== 'ACTIVE') {
                matchedClient = clients.find(c => 
                    (c.name && c.name.toLowerCase() === voucherCode.toLowerCase()) || 
                    (c.username && c.username.toLowerCase() === voucherCode.toLowerCase()) ||
                    (c.voucher && c.voucher.toLowerCase() === voucherCode.toLowerCase())
                );
            }

            // 2. Kung wala sa pamamagitan ng voucher, subukan sa MAC Address
            if (!matchedClient && clientMac && clientMac !== 'NOT_AVAILABLE') {
                matchedClient = clients.find(c => c.mac && c.mac.toLowerCase() === clientMac.toLowerCase());
            } 
            
            // 3. Kung wala pa rin, subukan sa IP address
            if (!matchedClient && clientIp) {
                matchedClient = clients.find(c => c.ip === clientIp || clientIp.includes(c.ip));
            }

            if (matchedClient) {
                console.log("MATCHED CLIENT DATA:", JSON.stringify(matchedClient, null, 2));

                const remainingSeconds = matchedClient.remainingTime || matchedClient.duration || matchedClient.leftTime || matchedClient.time || 0;
                return res.json({
                    success: true,
                    mac: matchedClient.mac || clientMac,
                    ip: matchedClient.ip || clientIp,
                    remainingSeconds: remainingSeconds
                });
            }
        }

        // Fallback: Kung may-input na voucher code pero hindi pa lumabas sa active clients list ng Omada, 
        // pwede nating ibalik ang default na oras (halimbawa: 1 oras o base sa klase ng voucher) para tumakbo ang timer.
        if (voucherCode && voucherCode !== 'ACTIVE') {
            return res.json({
                success: true,
                mac: clientMac || "MANUAL-VOUCHER",
                ip: clientIp || "0.0.0.0",
                remainingSeconds: 3600 // Default 1 hour fallback kung sakaling wala pa sa active client list
            });
        }

        res.json({ success: false, message: 'Client not found in active session' });

    } catch (err) {
        console.error('Error fetching Omada data:', err.message);
        res.status(500).json({ success: false, error: 'Server communication error with Omada' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

app.listen(3000, () => {
    console.log('ART WIFI Omada Bridge API running on port 3000');
    loginOmada();
});
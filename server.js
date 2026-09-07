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

        // Kunin ang listahan ng active clients kung saan nakalagay ang authName tulad ng "Voucher - 934126"
        const response = await axios.get(`${OMADA_CONFIG.baseUrl}/api/v2/sites/${OMADA_CONFIG.siteId}/clients`, {
            headers: { 'Csrf-Token': omadaToken },
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });

        if (response.data && response.data.errorCode === 0) {
            const clients = response.data.result.data || [];
            
            let matchedClient = null;

            if (voucherCode && voucherCode !== 'ACTIVE' && voucherCode !== 'INPUT CODE BELOW') {
                const cleanCode = voucherCode.trim().toLowerCase();
                matchedClient = clients.find(c => {
                    const authName = (c.authName || '').toLowerCase();
                    const name = (c.name || '').toLowerCase();
                    const username = (c.username || '').toLowerCase();
                    
                    return authName.includes(cleanCode) || name.includes(cleanCode) || username.includes(cleanCode);
                });
            }

            if (!matchedClient && clientMac && clientMac !== 'NOT_AVAILABLE') {
                matchedClient = clients.find(c => c.mac && c.mac.toLowerCase() === clientMac.toLowerCase());
            }

            if (matchedClient) {
                console.log("MATCHED CLIENT FOUND:", JSON.stringify(matchedClient, null, 2));

                const remainingSeconds = matchedClient.remainingTime || matchedClient.duration || matchedClient.leftTime || 3600;
                return res.json({
                    success: true,
                    mac: matchedClient.mac || clientMac || "NOT_AVAILABLE",
                    ip: matchedClient.ip || clientIp,
                    remainingSeconds: remainingSeconds,
                    voucherCode: voucherCode
                });
            }
        }

        res.json({ success: false, message: 'Hindi mahanap ang active session o invalid ang voucher code.' });

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
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

// I-serve ang mga static files (tulad ng status.html, css, js) mula sa 'public' folder
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
            console.log('Connected successfully to Omada Controller API');[cite: 3]
        }
    } catch (err) {
        console.error('Omada Login Failed:', err.message);[cite: 3]
    }
}

app.get('/api/check-time', async (req, res) => {
    let clientMac = req.query.mac;
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
            const clients = response.data.result.data || [];[cite: 3]
            
            let matchedClient = null;
            if (clientMac && clientMac !== 'NOT_AVAILABLE') {
                matchedClient = clients.find(c => c.mac.toLowerCase() === clientMac.toLowerCase());
            } else if (clientIp) {
                matchedClient = clients.find(c => c.ip === clientIp || clientIp.includes(c.ip));
            }

            if (matchedClient) {
                // I-print sa logs ang buong detalye ng kliyente para makita ang tamang key ng oras
                console.log("MATCHED CLIENT DATA:", JSON.stringify(matchedClient, null, 2));

                const remainingSeconds = matchedClient.remainingTime || matchedClient.duration || matchedClient.leftTime || matchedClient.time || 0;
                return res.json({
                    success: true,
                    mac: matchedClient.mac,
                    ip: matchedClient.ip,
                    remainingSeconds: remainingSeconds
                });
            }
        }

        res.json({ success: false, message: 'Client not found in active session' });[cite: 3]

    } catch (err) {
        console.error('Error fetching Omada data:', err.message);[cite: 3]
        res.status(500).json({ success: false, error: 'Server communication error with Omada' });[cite: 3]
    }
});

// Optional: Direktang i-serve ang status.html kapag binuksan ang root URL[cite: 3]
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'status.html'));[cite: 3]
});

app.listen(3000, () => {
    console.log('ART WIFI Omada Bridge API running on port 3000');[cite: 3]
    loginOmada();[cite: 3]
});
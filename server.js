const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

// I-serve ang mga static files mula sa 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Omada Controller Credentials & Configuration
const OMADA_CONFIG = {
    baseUrl: 'https://62.72.47.203:8043',
    username: 'aspg1520@gmail.com',
    password: 'Lja231827@@',
    siteId: 'c079d99361c04d149718906a869580ec'
};

let omadaToken = null;
let omadaCookies = null;

// Bypass SSL self-signed certificate error
const agent = new https.Agent({  
    rejectUnauthorized: false
});

// 1. Matibay na Function para sa pagkuha ng Token kay Omada
async function loginOmada() {
    try {
        console.log('Sinusubukang kumonekta at kumuha ng token kay Omada Controller...');
        const response = await axios.post(`${OMADA_CONFIG.baseUrl}/api/v2/login`, {
            username: OMADA_CONFIG.username,
            password: OMADA_CONFIG.password
        }, { 
            httpsAgent: agent,
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.errorCode === 0) {
            omadaToken = response.data.result.token;
            const setCookie = response.headers['set-cookie'];
            if (setCookie) {
                omadaCookies = setCookie.join('; ');
            }
            console.log('SUCCESS: Matagumpay na nakakuha ng Omada Token!');
            return true;
        } else {
            console.error('Omada Login Error Response:', response.data);
            return false;
        }
    } catch (err) {
        console.error('Omada Login Failed Connection Error:', err.message);
        return false;
    }
}

// 2. API Endpoint para i-check ang status at oras ng client/voucher
app.get('/api/check-time', async (req, res) => {
    console.log("May pumasok na request sa /api/check-time! Query params:", req.query);

    let clientMac = req.query.mac;
    let voucherCode = req.query.voucher || req.query.username;
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    try {
        if (!omadaToken) {
            let loggedIn = await loginOmada();
            if (!loggedIn) {
                return res.status(500).json({ success: false, error: 'Hindi makakonekta sa Omada Controller.' });
            }
        }

        const headers = {
            'Csrf-Token': omadaToken,
            'Content-Type': 'application/json'
        };
        if (omadaCookies) {
            headers['Cookie'] = omadaCookies;
        }

        // Kunin ang active clients list mula sa tamang Omada Site ID
        const response = await axios.get(`${OMADA_CONFIG.baseUrl}/api/v2/sites/${OMADA_CONFIG.siteId}/clients`, {
            headers: headers,
            httpsAgent: agent
        });

        if (response.data && response.data.errorCode === 0) {
            const clients = response.data.result.data || [];
            console.log(`Kabuuang active clients sa Omada: ${clients.length}`);
            
            let matchedClient = null;

            // Kung may kasamang voucher code, subukang hanapin sa lahat ng properties ng client
            if (voucherCode && voucherCode !== 'ACTIVE' && voucherCode !== 'INPUT CODE BELOW') {
                const cleanCode = voucherCode.trim().toLowerCase();
                matchedClient = clients.find(c => {
                    // I-check ang lahat ng posibleng naglalaman ng voucher/username info
                    const textBlob = JSON.stringify(c).toLowerCase();
                    return textBlob.includes(cleanCode);
                });
            }

            // Kung wala o hindi nahanap sa voucher, hanapin sa MAC address
            if (!matchedClient && clientMac && clientMac !== 'NOT_AVAILABLE') {
                matchedClient = clients.find(c => c.mac && c.mac.toLowerCase() === clientMac.toLowerCase());
            }

            // Fallback: Kung iisa lang ang client na naka-connect at nag-request siya, pwede nating i-default muna para makita kung gumagana ang timer
            if (!matchedClient && clients.length === 1) {
                matchedClient = clients[0];
            }

            if (matchedClient) {
                console.log("MATCHED CLIENT FOUND:", JSON.stringify(matchedClient, null, 2));

                // Hanapin ang pinakaangkop na property para sa natitirang oras
                const remainingSeconds = matchedClient.remainingTime || matchedClient.duration || matchedClient.leftTime || matchedClient.validTime || 3600;
                
                return res.json({
                    success: true,
                    mac: matchedClient.mac || clientMac || "NOT_AVAILABLE",
                    ip: matchedClient.ip || clientIp,
                    remainingSeconds: remainingSeconds,
                    voucherCode: voucherCode || matchedClient.authName || matchedClient.name || "ACTIVE"
                });
            }
        } else if (response.data && response.data.errorCode === -1) {
            omadaToken = null;
        }

        res.json({ success: false, message: 'Hindi mahanap ang active session o invalid ang voucher code.' });

    } catch (err) {
        console.error('Error fetching Omada data:', err.message);
        if (err.response && (err.response.status === 401 || err.response.status === 403)) {
            omadaToken = null;
        }
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
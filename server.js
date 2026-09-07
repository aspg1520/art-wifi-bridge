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
    username: 'aspg1520@gmail.com',
    password: 'Lja231827@@',
    // Kung hindi makuha, hahanapin ito ng automatic sa ibaba
    siteId: '6a615c90e78f4e28047ab010' 
};

let omadaToken = null;
let omadaCookies = null;

const agent = new https.Agent({  
    rejectUnauthorized: false
});

// Awtomatikong hahanapin ang tamang site ID para maiwasan ang error -1600
async function getValidSiteId(headers) {
    try {
        const response = await axios.get(`${OMADA_CONFIG.baseUrl}/api/v2/sites/${OMADA_CONFIG.siteId}/clients?currentPage=1&pageSize=100`, {
            headers: headers,
            httpsAgent: agent
        });
        if (response.data && response.data.errorCode === 0) {
            const sites = response.data.result.data || response.data.result || [];
            console.log("Mga nahanap na Sites sa Omada Controller:", JSON.stringify(sites, null, 2));
            if (sites.length > 0) {
                // Gamitin ang unang site o hanapin kung alin ang may tamang pangalan
                return sites[0].id || sites[0].siteId;
            }
        }
    } catch (err) {
        console.error("Error sa pagkuha ng sites:", err.message);
    }
    return OMADA_CONFIG.siteId;
}

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

            // Kunin ang tamang site ID habang naka-login
            const headers = {
                'Csrf-Token': omadaToken,
                'Content-Type': 'application/json',
                'Cookie': omadaCookies || ''
            };
            const validSite = await getValidSiteId(headers);
            if (validSite) {
                OMADA_CONFIG.siteId = validSite;
                console.log('Ginagamit na Omada Site ID:', OMADA_CONFIG.siteId);
            }

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

        const response = await axios.get(`${OMADA_CONFIG.baseUrl}/api/v2/sites/${OMADA_CONFIG.siteId}/clients`, {
            headers: headers,
            httpsAgent: agent
        });

        console.log("Omada Clients API Response Status:", response.data.errorCode);

        if (response.data && response.data.errorCode === 0) {
            const clients = response.data.result.data || [];
            console.log(`Kabuuang active clients na nakuha kay Omada: ${clients.length}`);
            
            if (clients.length > 0) {
                console.log("Sample client data structure:", JSON.stringify(clients[0], null, 2));
            }

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
        } else if (response.data && response.data.errorCode === -1 || response.data.errorCode === -1600) {
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
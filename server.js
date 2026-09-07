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
    siteId: '6a615c90e78f4e28047ab010'
};

let omadaToken = null;
let omadaCookies = null;

const agent = new https.Agent({  
    rejectUnauthorized: false
});

async function loginOmada() {
    try {
        console.log('Nag-uusap sa Omada Controller login...');
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
            console.log('SUCCESS: Nakakuha ng Omada Token!');
            return true;
        } else {
            console.error('Omada Login Error:', response.data);
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
                return res.status(500).json({ success: false, error: 'Hindi makakonekta sa Omada.' });
            }
        }

        const headers = {
            'Csrf-Token': omadaToken,
            'Content-Type': 'application/json'
        };
        if (omadaCookies) {
            headers['Cookie'] = omadaCookies;
        }

        // Hakbang 1: Kunin muna ang listahan ng sites para ma-validate ang active context ng user token na ito
        const sitesUrl = `${OMADA_CONFIG.baseUrl}/api/v2/sites`;
        const sitesRes = await axios.get(sitesUrl, { headers: headers, httpsAgent: agent });

        let targetSiteId = OMADA_CONFIG.siteId;

        if (sitesRes.data && sitesRes.data.errorCode === 0) {
            const sitesList = sitesRes.data.result.data || sitesRes.data.result || [];
            console.log(`Kabuuang sites na nahanap para sa account na ito: ${sitesList.length}`);
            
            // Hanapin kung pasok ang siteId natin o kunin ang unang site kung meron man
            const matchedSite = sitesList.find(s => (s.id === OMADA_CONFIG.siteId || s.siteId === OMADA_CONFIG.siteId));
            if (matchedSite) {
                targetSiteId = matchedSite.id || matchedSite.siteId;
            } else if (sitesList.length > 0) {
                targetSiteId = sitesList[0].id || sitesList[0].siteId;
                console.log(`Gamit ang unang available site ID mula sa controller: ${targetSiteId}`);
            }
        }

        // Hakbang 2: Kunin ang clients gamit ang na-verify na site ID
        const clientApiUrl = `${OMADA_CONFIG.baseUrl}/api/v2/sites/${targetSiteId}/clients?currentPage=1&pageSize=500`;
        console.log(`Tinatarget ang Clients API URL: ${clientApiUrl}`);

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
                const remainingSeconds = matchedClient.remainingTime || matchedClient.duration || matchedClient.leftTime || matchedClient.validTime || 3600;
                
                return res.json({
                    success: true,
                    mac: matchedClient.mac || clientMac || "NOT_AVAILABLE",
                    ip: matchedClient.ip || clientIp,
                    remainingSeconds: remainingSeconds,
                    voucherCode: voucherCode || matchedClient.authName || matchedClient.name || "ACTIVE"
                });
            }
        } else {
            console.log("Client API Error Code:", response.data.errorCode);
            if (response.data.errorCode === -1 || response.data.errorCode === -1600) {
                omadaToken = null; 
            }
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
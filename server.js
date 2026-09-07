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

        // Kunin ang listahan ng mga vouchers mula sa Omada
        const voucherRes = await axios.get(`${OMADA_CONFIG.baseUrl}/api/v2/sites/${OMADA_CONFIG.siteId}/vouchers`, {
            headers: { 'Csrf-Token': omadaToken },
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });

        if (voucherRes.data && voucherRes.data.errorCode === 0) {
            const vouchers = voucherRes.data.result.data || [];
            
            let matchedVoucher = null;
            if (voucherCode && voucherCode !== 'ACTIVE' && voucherCode !== 'INPUT CODE BELOW') {
                matchedVoucher = vouchers.find(v => v.code && v.code.toLowerCase() === voucherCode.toLowerCase());
            }

            if (matchedVoucher) {
                console.log("MATCHED VOUCHER FOUND:", JSON.stringify(matchedVoucher, null, 2));

                // Kunin ang duration o remaining time mula sa voucher object ng Omada
                // Kadalasan ang duration ay nasa minutes o seconds, pwedeng i-convert sa seconds
                const durationMinutes = matchedVoucher.duration || 60; // Default 60 mins kung sakaling walang value
                const remainingSeconds = matchedVoucher.remainingTime || (durationMinutes * 60);

                return res.json({
                    success: true,
                    mac: clientMac && clientMac !== 'NOT_AVAILABLE' ? clientMac : (matchedVoucher.mac || "VOUCHER-USER"),
                    ip: clientIp,
                    remainingSeconds: remainingSeconds,
                    voucherCode: matchedVoucher.code
                });
            }
        }

        res.json({ success: false, message: 'Voucher code not found in Omada system.' });

    } catch (err) {
        console.error('Error fetching Omada voucher data:', err.message);
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
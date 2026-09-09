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

// Guest-facing na portal API (IBANG port — 8080, walang login/token na kailangan,
// sinasagot lang gamit ang clientMac+apMac+ssidName+cliToken mula sa URL ng captive portal)
const PORTAL_BASE_URL = 'http://62.72.47.203:8080';

// Operator account para sa LEGACY hotspot API (ibang login flow, cookie-based)
// — dito lang makukuha ang eksaktong Used Time / Left Time ng bawat voucher.
const HOTSPOT_OPERATOR = {
    username: '85140442',
    password: 'MSFKServer-85140442'
};

let omadaToken = null;
let omadaCookies = null;

let hotspotCsrfToken = null;
let hotspotCookie = null;

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

// LEGACY Hotspot login (cookie + CSRF-Token based, IBA sa OAuth Open API sa itaas)
async function loginHotspotOperator() {
    try {
        console.log('Nag-uusap sa Hotspot Operator login (legacy)...');
        const loginUrl = `${OMADA_CONFIG.baseUrl}/${OMADA_CONFIG.omadacId}/api/v2/hotspot/login`;

        const response = await axios.post(loginUrl, {
            name: HOTSPOT_OPERATOR.username,
            password: HOTSPOT_OPERATOR.password
        }, {
            httpsAgent: agent,
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.errorCode === 0 && response.data.result) {
            hotspotCsrfToken = response.data.result.token;

            const setCookieHeader = response.headers['set-cookie'];
            if (setCookieHeader && setCookieHeader.length) {
                hotspotCookie = setCookieHeader.map(c => c.split(';')[0]).join('; ');
            }

            console.log('SUCCESS: Naka-login ang Hotspot Operator! Cookie:', hotspotCookie ? 'meron' : 'WALA (problema ito)');
            return true;
        } else {
            console.error('Hotspot Operator Login Error:', response.data);
            return false;
        }
    } catch (err) {
        console.error('Hotspot Login Exception:', err.message);
        if (err.response) {
            console.error('Response Status:', err.response.status, err.response.data);
        }
        return false;
    }
}

// Kunin ang voucher list gamit ang legacy cookie session, hanapin ang tugmang code
async function fetchVoucherByCode(code) {
    if (!hotspotCsrfToken || !hotspotCookie) {
        const ok = await loginHotspotOperator();
        if (!ok) return null;
    }

    try {
        const vouchersUrl = `${OMADA_CONFIG.baseUrl}/${OMADA_CONFIG.omadacId}/api/v2/hotspot/sites/${OMADA_CONFIG.siteId}/vouchers?currentPage=1&currentPageSize=500&status=All`;

        const response = await axios.get(vouchersUrl, {
            httpsAgent: agent,
            headers: {
                'Csrf-Token': hotspotCsrfToken,
                'Cookie': hotspotCookie,
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.errorCode === 0) {
            const vouchers = response.data.result.data || response.data.result || [];
            console.log(`Vouchers (legacy) nakuha: ${vouchers.length}`);

            // Posibleng may DUPLICATE na code sa magkaibang voucher group —
            // kunin lahat ng tugma, tapos piliin yung PINAKA-BAGONG na-activate (pinakamalaking startTime).
            const allMatches = vouchers.filter(v => (v.code || '').toString().trim() === code.trim());

            if (allMatches.length > 1) {
                console.log(`BABALA: ${allMatches.length} vouchers may parehong code na "${code}" — pipiliin yung pinaka-bagong na-activate.`);
            }

            const matched = allMatches.reduce((best, v) => {
                if (!best) return v;
                return (v.startTime || 0) > (best.startTime || 0) ? v : best;
            }, null);

            if (matched) {
                // DEBUG: makikita natin dito ang TUNAY na field names ng legacy voucher object
                console.log('MATCHED VOUCHER (LEGACY API) RAW DATA:', JSON.stringify(matched));

                // Subukan din nating kunin ang DETALYE ng ISANG voucher gamit ang ID niya —
                // baka may pre-computed na Used/Left Time doon na wala sa list view.
                if (matched.id) {
                    try {
                        const detailUrl = `${OMADA_CONFIG.baseUrl}/${OMADA_CONFIG.omadacId}/api/v2/hotspot/sites/${OMADA_CONFIG.siteId}/vouchers/${matched.id}`;
                        const detailRes = await axios.get(detailUrl, {
                            httpsAgent: agent,
                            headers: {
                                'Csrf-Token': hotspotCsrfToken,
                                'Cookie': hotspotCookie,
                                'Content-Type': 'application/json'
                            }
                        });
                        console.log('VOUCHER DETAIL (by ID) RAW DATA:', JSON.stringify(detailRes.data));
                        if (detailRes.data && detailRes.data.errorCode === 0 && detailRes.data.result) {
                            // I-merge natin ang detail sa matched voucher (baka may dagdag na fields dito)
                            Object.assign(matched, detailRes.data.result);
                        }
                    } catch (detailErr) {
                        console.log('Voucher detail fetch error (baka hindi supported ang endpoint na ito):', detailErr.message);
                    }
                }
            } else {
                console.log(`Walang nahanap na voucher (legacy) na may code: ${code}`);
            }
            return matched || null;
        } else {
            console.log('Vouchers (legacy) API Error:', response.data);
            hotspotCsrfToken = null;
            hotspotCookie = null;
            return null;
        }
    } catch (err) {
        console.error('Voucher fetch (legacy) error:', err.message);
        if (err.response) {
            console.error('Response Status:', err.response.status, err.response.data);
        }
        hotspotCsrfToken = null;
        hotspotCookie = null;
        return null;
    }
}

// BAGONG paraan — direkta at eksakto: tumatawag sa parehong endpoint na ginagamit
// ng OPISYAL na Omada success page mismo (nahanap gamit ang browser DevTools).
// Walang kailangang login — sinasagot base sa clientMac+apMac+ssidName+cliToken
// na ibinibigay ni Omada sa URL pagkatapos mag-authenticate ang device.
async function fetchLivePortalSession(clientMac, apMac, ssidName, cliToken) {
    try {
        const url = `${PORTAL_BASE_URL}/portal/getLogoutPageSetting`;
        const response = await axios.post(url, {
            clientMac,
            apMac,
            ssidName,
            cliToken
        }, {
            headers: { 'Content-Type': 'application/json;charset=utf-8' },
            timeout: 8000
        });

        console.log('LIVE PORTAL SESSION RAW DATA:', JSON.stringify(response.data));

        if (response.data && response.data.errorCode === 0 && response.data.result) {
            return response.data.result;
        }
        console.log('Live portal session error:', response.data);
        return null;
    } catch (err) {
        console.error('Live portal session fetch error:', err.message);
        return null;
    }
}

app.get('/api/check-time', async (req, res) => {
    let clientMac = req.query.mac || req.query.clientMac;
    let voucherCode = req.query.voucher || req.query.username;
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Mga bagong parameter na galing sa URL ng Omada pagkatapos mag-authenticate —
    // kung kumpleto ito, ito ang PINAKA-EKSAKTONG paraan (parehong endpoint ng
    // opisyal na Omada success page mismo).
    const apMac = req.query.apMac;
    const ssidName = req.query.ssidName || req.query.ssid;
    const cliToken = req.query.cliToken;

    if (clientMac && apMac && ssidName && cliToken) {
        const liveSession = await fetchLivePortalSession(clientMac, apMac, ssidName, cliToken);
        if (liveSession && typeof liveSession.timeLeft !== 'undefined') {
            return res.json({
                success: true,
                mac: clientMac,
                ip: liveSession.ip || clientIp,
                remainingSeconds: Math.max(0, Math.round(liveSession.timeLeft)),
                voucherCode: liveSession.username || voucherCode || "ACTIVE",
                uptime: typeof liveSession.uptime !== 'undefined' ? liveSession.uptime : undefined,
                usedTime: typeof liveSession.timeUsed !== 'undefined' ? liveSession.timeUsed : undefined
            });
        }
        // Kung na-fail ito (hal. expired na ang cliToken), magpatuloy sa lumang paraan sa ibaba.
    }

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

        // 1. Kunin muna ang connected clients list (Open API) — dito galing ang TUNAY na MAC/IP
        // ng device, tinutugma gamit ang 'authInfo' (naglalaman ng voucher code na ginamit nila).
        let realMac = null;
        let realIp = null;
        let effectiveVoucherCode = (voucherCode && voucherCode !== 'ACTIVE' && voucherCode !== 'INPUT CODE BELOW')
            ? voucherCode.trim()
            : null;

        try {
            const clientApiUrl = `${OMADA_CONFIG.baseUrl}/openapi/v1/${OMADA_CONFIG.omadacId}/sites/${OMADA_CONFIG.siteId}/clients?page=1&pageSize=500`;
            const clientsRes = await axios.get(clientApiUrl, { headers, httpsAgent: agent });

            if (clientsRes.data && clientsRes.data.errorCode === 0) {
                const clients = clientsRes.data.result.data || clientsRes.data.result || [];
                console.log(`Active clients nakuha: ${clients.length}`);

                let matchedClient = null;

                if (effectiveVoucherCode) {
                    matchedClient = clients.find(c =>
                        (c.authInfo || []).some(a => (a.info || '').toString().trim() === effectiveVoucherCode)
                    );
                }

                if (!matchedClient && clientMac && clientMac !== 'NOT_AVAILABLE') {
                    matchedClient = clients.find(c => c.mac && c.mac.toLowerCase() === clientMac.toLowerCase());
                }

                if (matchedClient) {
                    console.log('MATCHED CLIENT (para sa MAC/IP) RAW DATA:', JSON.stringify(matchedClient));
                    realMac = matchedClient.mac || null;
                    realIp = matchedClient.ip || null;

                    // Kung walang na-type na code (hal. una pa lang na-open ang page, MAC lang ang meron),
                    // hanapin natin ang voucher code niya mismo gamit ang authInfo, para makakuha pa rin
                    // ng TUNAY na remaining time sa halip na hardcoded default.
                    if (!effectiveVoucherCode) {
                        const voucherAuth = (matchedClient.authInfo || []).find(a => a.authType === 3);
                        if (voucherAuth && voucherAuth.info) {
                            effectiveVoucherCode = voucherAuth.info.toString().trim();
                            console.log(`Nahanap ang voucher code base sa MAC: ${effectiveVoucherCode}`);
                        }
                    }
                }
            } else {
                console.log("Open API Error Code:", clientsRes.data ? clientsRes.data.errorCode : 'Unknown');
                if (clientsRes.data && clientsRes.data.errorCode === -44112) omadaToken = null; // expired token, i-refresh sa susunod
            }
        } catch (clientErr) {
            console.error('Client fetch error:', clientErr.message);
        }

        // 2. Kunin ang TUNAY na remaining time mula sa LEGACY Vouchers list
        // — dito galing ang tunay na "Used Time" / "Left Time" na nakikita mo sa admin dashboard.
        if (effectiveVoucherCode) {
            const matchedVoucher = await fetchVoucherByCode(effectiveVoucherCode);

            if (matchedVoucher) {
                // KUMPIRMADO na ang tamang formula base sa aktwal na data:
                // duration = minuto ng buong bisa ng voucher
                // startTime = eksaktong oras (epoch ms) nung na-activate/na-connect
                // used = 1 kapag na-activate na (hindi ito "used time", bilang lang)
                const durationSec = (matchedVoucher.duration || 0) * 60;
                let computedLeft;

                if (matchedVoucher.used && matchedVoucher.used > 0 && matchedVoucher.startTime) {
                    const elapsedSec = (Date.now() - matchedVoucher.startTime) / 1000;
                    computedLeft = durationSec - elapsedSec;
                } else {
                    // Hindi pa na-activate — buo pa ang oras
                    computedLeft = durationSec;
                }

                return res.json({
                    success: true,
                    mac: realMac || clientMac || "NOT_AVAILABLE",
                    ip: realIp || clientIp,
                    remainingSeconds: Math.max(0, Math.round(computedLeft)),
                    voucherCode: effectiveVoucherCode
                });
            }
        }

        // 3. Fallback: kung walang nahanap na voucher pero may nahanap na client (walang code, MAC-based lang)
        if (realMac) {
            return res.json({
                success: true,
                mac: realMac,
                ip: realIp || clientIp,
                remainingSeconds: 3600,
                voucherCode: effectiveVoucherCode || "ACTIVE"
            });
        }

        res.json({ success: false, message: 'Hindi mahanap ang active session.' });

    } catch (err) {
        console.error('Error sa pagkuha ng clients:', err.message);
        omadaToken = null;
        res.status(500).json({ success: false, error: 'Server communication error' });
    }
});

// I-a-attempt tawagin ang aktwal na Omada portal logout (parehong pattern ng
// getLogoutPageSetting) — kung sakaling may cliToken pa tayo. Hindi 100% kumpirmado
// ang eksaktong payload nito dahil hindi pa natin nahuli sa DevTools ang totoong
// logout network call, kaya defensive tayo dito: kahit mag-fail ang aktwal na
// deauth call sa Omada, ibabalik pa rin natin success sa browser para ma-clear
// ang lokal na session state ng user.
app.get('/api/logout', async (req, res) => {
    const clientMac = req.query.mac || req.query.clientMac;
    const apMac = req.query.apMac;
    const ssidName = req.query.ssidName || req.query.ssid;
    const cliToken = req.query.cliToken;

    if (clientMac && apMac && ssidName && cliToken) {
        try {
            const url = `${PORTAL_BASE_URL}/portal/logout`;
            const response = await axios.post(url, {
                clientMac,
                apMac,
                ssidName,
                cliToken
            }, {
                headers: { 'Content-Type': 'application/json;charset=utf-8' },
                timeout: 8000
            });
            console.log('PORTAL LOGOUT RAW DATA:', JSON.stringify(response.data));
        } catch (err) {
            console.error('Portal logout error (hindi kumpirmado ang endpoint na ito):', err.message);
            // Hindi natin i-fa-fail ang request sa user kahit mag-error dito —
            // basta na-clear ang lokal na session state niya sa browser.
        }
    } else {
        console.log('Logout request: kulang ang parameters para sa aktwal na Omada logout (mac/apMac/ssidName/cliToken).');
    }

    res.json({ success: true });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

app.listen(3000, () => {
    console.log('ART WIFI Server running on port 3000');
    loginOmada();
});
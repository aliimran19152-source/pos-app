const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));
app.use(express.static('public'));

// Firebase Realtime Database Endpoint (Permanent Cloud Engine)
const FIREBASE_DB_URL = "https://pos-ledger-system-default-rtdb.firebaseio.com";

// Helper: Fetch Data from Firebase Cloud
function fetchCloudData(key) {
    return new Promise((resolve) => {
        https.get(`${FIREBASE_DB_URL}/users/${key}.json`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode === 200 && data !== 'null') {
                        resolve(JSON.parse(data));
                    } else {
                        resolve(null);
                    }
                } catch(e) { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

// Helper: Save/Update Data on Firebase Cloud
function saveCloudData(key, payload) {
    return new Promise((resolve) => {
        const data = JSON.stringify(payload);
        const url = new URL(`${FIREBASE_DB_URL}/users/${key}.json`);
        const req = https.request(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.write(data);
        req.end();
    });
}

// Safe Schema Migration Guard: Purane users ka data break na ho
function sanitizeUserData(userData) {
    if (!userData) return null;
    if (!userData.profile) userData.profile = { phone: '', pass: '', bizName: 'My Shop' };
    if (!userData.transactions) userData.transactions = [];
    if (!userData.parties) userData.parties = [];

    userData.transactions = userData.transactions.map(t => ({
        id: t.id || Date.now() + Math.random(),
        role: t.role || 'Customer',
        name: t.name || 'Unknown',
        billNo: t.billNo || '-',
        type: t.type || 'SALE_CREDIT',
        amount: Number(t.amount) || 0,
        method: t.method || 'Cash',
        date: t.date || new Date().toISOString().split('T')[0],
        notes: t.notes || '',
        img: t.img || ''
    }));

    return userData;
}

// User Registration Route
app.post('/api/register', async (req, res) => {
    try {
        const { phone, pass, bizName } = req.body;
        if (!phone || !pass) return res.status(400).json({ error: "Phone number aur password zaroori hain!" });

        const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
        const existing = await fetchCloudData(cleanPhone);
        
        if (existing && existing.profile) {
            return res.status(400).json({ error: "Yeh phone number pehle se registered hai! Login karein." });
        }

        const newUser = {
            profile: { phone: cleanPhone, pass, bizName: bizName || 'My Shop' },
            transactions: [],
            parties: []
        };

        const success = await saveCloudData(cleanPhone, newUser);
        if (success) {
            res.json({ success: true, user: newUser.profile });
        } else {
            res.status(500).json({ error: "Cloud storage response failed!" });
        }
    } catch(err) {
        res.status(500).json({ error: "Server Registration Error" });
    }
});

// User Login Route
app.post('/api/login', async (req, res) => {
    try {
        const { phone, pass } = req.body;
        if (!phone || !pass) return res.status(400).json({ error: "Credentials missing!" });

        const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
        let userData = await fetchCloudData(cleanPhone);

        if (!userData || !userData.profile) {
            return res.status(404).json({ error: "Invalid Phone Number or Password! Pehle account register karein." });
        }

        if (userData.profile.pass !== pass) {
            return res.status(401).json({ error: "Invalid Phone Number or Password!" });
        }

        userData = sanitizeUserData(userData);
        res.json({ success: true, data: userData });
    } catch(err) {
        res.status(500).json({ error: "Server Login Error" });
    }
});

// Save Data Cloud Route
app.post('/api/save-data', async (req, res) => {
    try {
        const { phone, transactions, parties } = req.body;
        if (!phone) return res.status(400).json({ error: "Phone ID missing!" });

        const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
        let userData = await fetchCloudData(cleanPhone);

        if (!userData || !userData.profile) {
            return res.status(404).json({ error: "User profile not found!" });
        }

        userData.transactions = transactions || [];
        userData.parties = parties || [];

        const success = await saveCloudData(cleanPhone, userData);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: "Failed to persist cloud data" });
        }
    } catch(err) {
        res.status(500).json({ error: "Server Save Error" });
    }
});

app.listen(PORT, () => console.log(`Production Safe Server running on port ${PORT}`));

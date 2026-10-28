const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));
app.use(express.static('public'));

const FIREBASE_DB_URL = "https://pos-ledger-system-default-rtdb.firebaseio.com";

function fetchCloudData(path) {
    return new Promise((resolve) => {
        https.get(`${FIREBASE_DB_URL}/${path}.json`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode === 200 && data !== 'null') resolve(JSON.parse(data));
                    else resolve(null);
                } catch(e) { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

function saveCloudData(path, payload) {
    return new Promise((resolve) => {
        const data = JSON.stringify(payload);
        const url = new URL(`${FIREBASE_DB_URL}/${path}.json`);
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

function sanitizeUserData(userData) {
    if (!userData) return null;
    if (!userData.profile) userData.profile = { phone: '', pass: '', bizName: 'My Shop' };
    if (!userData.transactions) userData.transactions = [];
    if (!userData.parties) userData.parties = [];
    
    // Default subscription fields
    if (userData.profile.isApproved === undefined) userData.profile.isApproved = false;
    if (!userData.profile.expiryDate) userData.profile.expiryDate = null;
    if (!userData.profile.plan) userData.profile.plan = "Pending Payment";

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

// Ensure Admin Config Exists
async function initAdminConfig() {
    let admin = await fetchCloudData('admin');
    if (!admin) {
        await saveCloudData('admin', { phone: '03000000000', pass: 'admin123' });
    }
}
initAdminConfig();

// Registration API
app.post('/api/register', async (req, res) => {
    try {
        const { phone, pass, bizName } = req.body;
        if (!phone || !pass) return res.status(400).json({ error: "Phone aur Password zaroori hain!" });

        const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
        const existing = await fetchCloudData(`users/${cleanPhone}`);
        
        if (existing && existing.profile) {
            return res.status(400).json({ error: "Yeh phone number pehle se registered hai! Login karein." });
        }

        const newUser = {
            profile: { 
                phone: cleanPhone, 
                pass, 
                bizName: bizName || 'My Shop',
                isApproved: false,
                expiryDate: null,
                plan: "Free Trial / Pending"
            },
            transactions: [],
            parties: []
        };

        const success = await saveCloudData(`users/${cleanPhone}`, newUser);
        if (success) {
            res.json({ success: true, user: newUser.profile });
        } else {
            res.status(500).json({ error: "Registration Server Error!" });
        }
    } catch(err) {
        res.status(500).json({ error: "Server Registration Error" });
    }
});

// Universal Login API (Normal User + Super Admin)
app.post('/api/login', async (req, res) => {
    try {
        const { phone, pass } = req.body;
        if (!phone || !pass) return res.status(400).json({ error: "Credentials missing!" });

        const cleanPhone = phone.trim().replace(/[^0-9]/g, '');

        // Check if Super Admin Login
        let adminData = await fetchCloudData('admin');
        if (adminData && adminData.phone === cleanPhone && adminData.pass === pass) {
            return res.json({ success: true, isAdmin: true, admin: adminData });
        }

        // Normal User Login
        let userData = await fetchCloudData(`users/${cleanPhone}`);
        if (!userData || !userData.profile) {
            return res.status(404).json({ error: "Invalid Phone Number ya Password! Pehle account register karein." });
        }

        if (userData.profile.pass !== pass) {
            return res.status(401).json({ error: "Invalid Phone Number ya Password!" });
        }

        userData = sanitizeUserData(userData);

        // Check Admin Approval & Plan Expiry
        if (!userData.profile.isApproved) {
            return res.status(403).json({ error: "Aapka account abhi active nahi hai. Access ke liye Super Admin se contact karke payment karein." });
        }

        if (userData.profile.expiryDate) {
            const today = new Date().toISOString().split('T')[0];
            if (today > userData.profile.expiryDate) {
                return res.status(403).json({ error: `Aapka subscription plan (${userData.profile.plan}) expire ho gaya hai! Renew karwane ke liye Admin se contact karein.` });
            }
        }

        res.json({ success: true, isAdmin: false, data: userData });
    } catch(err) {
        res.status(500).json({ error: "Server Login Error" });
    }
});

// Super Admin APIs
app.get('/api/admin/get-users', async (req, res) => {
    try {
        let usersData = await fetchCloudData('users');
        let userList = [];
        if (usersData) {
            for (let phone in usersData) {
                if (usersData[phone] && usersData[phone].profile) {
                    userList.push(usersData[phone].profile);
                }
            }
        }
        res.json({ success: true, users: userList });
    } catch(err) {
        res.status(500).json({ error: "Failed to fetch users list" });
    }
});

app.post('/api/admin/update-access', async (req, res) => {
    try {
        const { targetPhone, isApproved, days, planName } = req.body;
        let userData = await fetchCloudData(`users/${targetPhone}`);
        if (!userData) return res.status(404).json({ error: "User nahi mila!" });

        userData.profile.isApproved = isApproved;
        userData.profile.plan = planName;

        if (days > 0) {
            let expDate = new Date();
            expDate.setDate(expDate.getDate() + Number(days));
            userData.profile.expiryDate = expDate.toISOString().split('T')[0];
        } else if (days === 0) {
            userData.profile.expiryDate = null; // Lifetime access
        }

        await saveCloudData(`users/${targetPhone}`, userData);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: "Failed to update user access" });
    }
});

app.post('/api/admin/update-password', async (req, res) => {
    try {
        const { newPass } = req.body;
        let adminData = await fetchCloudData('admin');
        adminData.pass = newPass;
        await saveCloudData('admin', adminData);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: "Password update failed" });
    }
});

// Save User Data API
app.post('/api/save-data', async (req, res) => {
    try {
        const { phone, transactions, parties } = req.body;
        if (!phone) return res.status(400).json({ error: "Phone ID missing!" });

        const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
        let userData = await fetchCloudData(`users/${cleanPhone}`);

        if (!userData || !userData.profile) {
            return res.status(404).json({ error: "User profile not found!" });
        }

        userData.transactions = transactions || [];
        userData.parties = parties || [];

        await saveCloudData(`users/${cleanPhone}`, userData);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: "Server Save Error" });
    }
});

app.listen(PORT, () => console.log(`Super Admin POS Backend Running on port ${PORT}`));

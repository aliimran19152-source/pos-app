const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));
app.use(express.static('public'));

// Local Data Store Directory
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Initialize Admin File if not exists
if (!fs.existsSync(ADMIN_FILE)) {
    fs.writeFileSync(ADMIN_FILE, JSON.stringify({ phone: '03000000000', pass: 'admin123' }, null, 2));
}

// Initialize Users File if not exists
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({}, null, 2));
}

function readUsersData() {
    try {
        const raw = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(raw) || {};
    } catch (e) {
        return {};
    }
}

function writeUsersData(data) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function readAdminData() {
    try {
        const raw = fs.readFileSync(ADMIN_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return { phone: '03000000000', pass: 'admin123' };
    }
}

function writeAdminData(data) {
    fs.writeFileSync(ADMIN_FILE, JSON.stringify(data, null, 2));
}

function sanitizeUserData(userData) {
    if (!userData) return null;
    if (!userData.profile) userData.profile = { phone: '', pass: '', bizName: 'My Shop' };
    if (!userData.transactions) userData.transactions = [];
    if (!userData.parties) userData.parties = [];
    
    if (userData.profile.isApproved === undefined) userData.profile.isApproved = false;
    if (!userData.profile.expiryDate) userData.profile.expiryDate = null;
    if (!userData.profile.plan) userData.profile.plan = "Pending Approval";

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

// Register API
app.post('/api/register', (req, res) => {
    try {
        const { phone, pass, bizName } = req.body;
        if (!phone || !pass) return res.status(400).json({ error: "Phone aur Password zaroori hain!" });

        const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
        const allUsers = readUsersData();

        if (allUsers[cleanPhone]) {
            return res.status(400).json({ error: "Yeh phone number pehle se registered hai! Login karein." });
        }

        allUsers[cleanPhone] = {
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

        writeUsersData(allUsers);
        res.json({ success: true, user: allUsers[cleanPhone].profile });
    } catch(err) {
        res.status(500).json({ error: "Server Registration Error" });
    }
});

// Universal Login API
app.post('/api/login', (req, res) => {
    try {
        const { phone, pass } = req.body;
        if (!phone || !pass) return res.status(400).json({ error: "Credentials missing!" });

        const cleanPhone = phone.trim().replace(/[^0-9]/g, '');

        // Super Admin Check
        const admin = readAdminData();
        if (cleanPhone === admin.phone && pass === admin.pass) {
            return res.json({ success: true, isAdmin: true, admin });
        }

        // Normal User Check
        const allUsers = readUsersData();
        let userData = allUsers[cleanPhone];

        if (!userData || !userData.profile) {
            return res.status(404).json({ error: "Invalid Phone Number ya Password! Pehle account register karein." });
        }

        if (userData.profile.pass !== pass) {
            return res.status(401).json({ error: "Invalid Phone Number ya Password!" });
        }

        userData = sanitizeUserData(userData);
        allUsers[cleanPhone] = userData;
        writeUsersData(allUsers);

        if (!userData.profile.isApproved) {
            return res.status(403).json({ error: "Aapka account abhi active nahi hai. Access ke liye Super Admin se contact karke payment karein." });
        }

        if (userData.profile.expiryDate) {
            const today = new Date().toISOString().split('T')[0];
            if (today > userData.profile.expiryDate) {
                return res.status(403).json({ error: `Aapka plan (${userData.profile.plan}) expire ho gaya hai! Renew karwane ke liye Admin se contact karein.` });
            }
        }

        res.json({ success: true, isAdmin: false, data: userData });
    } catch(err) {
        res.status(500).json({ error: "Server Login Error" });
    }
});

// Admin Get Users API
app.get('/api/admin/get-users', (req, res) => {
    try {
        const allUsers = readUsersData();
        const userList = [];
        for (let key in allUsers) {
            if (allUsers[key] && allUsers[key].profile) {
                userList.push(allUsers[key].profile);
            }
        }
        res.json({ success: true, users: userList });
    } catch(err) {
        res.status(500).json({ error: "Users list fetch error" });
    }
});

// Admin Update Access API
app.post('/api/admin/update-access', (req, res) => {
    try {
        const { targetPhone, isApproved, days, planName } = req.body;
        const allUsers = readUsersData();
        
        if (!allUsers[targetPhone]) return res.status(404).json({ error: "User nahi mila!" });

        allUsers[targetPhone].profile.isApproved = isApproved;
        allUsers[targetPhone].profile.plan = planName;

        if (days > 0) {
            let expDate = new Date();
            expDate.setDate(expDate.getDate() + Number(days));
            allUsers[targetPhone].profile.expiryDate = expDate.toISOString().split('T')[0];
        } else if (days === 0) {
            allUsers[targetPhone].profile.expiryDate = null;
        }

        writeUsersData(allUsers);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: "Access update failed" });
    }
});

// Admin Update Password API
app.post('/api/admin/update-password', (req, res) => {
    try {
        const { newPass } = req.body;
        const admin = readAdminData();
        admin.pass = newPass;
        writeAdminData(admin);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: "Password update failed" });
    }
});

// Save Data API
app.post('/api/save-data', (req, res) => {
    try {
        const { phone, transactions, parties } = req.body;
        if (!phone) return res.status(400).json({ error: "Phone ID missing!" });

        const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
        const allUsers = readUsersData();

        if (!allUsers[cleanPhone]) {
            return res.status(404).json({ error: "User profile not found!" });
        }

        allUsers[cleanPhone].transactions = transactions || [];
        allUsers[cleanPhone].parties = parties || [];

        writeUsersData(allUsers);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: "Server Save Error" });
    }
});

app.listen(PORT, () => console.log(`Stable Local Engine POS Backend Running on port ${PORT}`));

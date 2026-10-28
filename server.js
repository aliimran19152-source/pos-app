const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Persistent storage directory path
const DATA_DIR = process.env.RENDER_DISK_PATH || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper: Ensure user data schema is up-to-date without breaking old accounts
function sanitizeUserData(userData) {
    if (!userData.transactions) userData.transactions = [];
    if (!userData.parties) userData.parties = [];
    
    // Auto-fix missing fields in old transactions
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

// User Register
app.post('/api/register', (req, res) => {
    try {
        const { phone, pass, bizName } = req.body;
        if (!phone || !pass) return res.status(400).json({ error: "Phone and password required" });

        const filePath = path.join(DATA_DIR, `${phone}.json`);
        if (fs.existsSync(filePath)) {
            return res.status(400).json({ error: "Yeh phone number pehle se registered hai! Login karein." });
        }

        const userData = {
            profile: { phone, pass, bizName: bizName || 'My Shop' },
            transactions: [],
            parties: []
        };

        fs.writeFileSync(filePath, JSON.stringify(userData, null, 2));
        res.json({ success: true, user: userData.profile });
    } catch(err) {
        res.status(500).json({ error: "Server error during registration" });
    }
});

// User Login & Safe Data Migration
app.post('/api/login', (req, res) => {
    try {
        const { phone, pass } = req.body;
        const filePath = path.join(DATA_DIR, `${phone}.json`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Invalid Phone Number or Password! Pehle account register karein." });
        }

        let rawData = fs.readFileSync(filePath, 'utf8');
        let userData = JSON.parse(rawData);

        if (userData.profile.pass !== pass) {
            return res.status(401).json({ error: "Invalid Phone Number or Password!" });
        }

        // Apply automatic schema cleanup for seamless updates
        userData = sanitizeUserData(userData);
        fs.writeFileSync(filePath, JSON.stringify(userData, null, 2));

        res.json({ success: true, data: userData });
    } catch(err) {
        res.status(500).json({ error: "Server error during login" });
    }
});

// Sync / Update Data safely
app.post('/api/save-data', (req, res) => {
    try {
        const { phone, transactions, parties } = req.body;
        const filePath = path.join(DATA_DIR, `${phone}.json`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "User file not found!" });
        }

        let userData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        userData.transactions = transactions || [];
        userData.parties = parties || [];

        fs.writeFileSync(filePath, JSON.stringify(userData, null, 2));
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: "Failed to save data on server" });
    }
});

app.listen(PORT, () => console.log(`Server running safely on port ${PORT}`));

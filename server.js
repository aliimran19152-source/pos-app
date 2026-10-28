const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// Increased limit to 10mb for image uploads
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// User Register
app.post('/api/register', (req, res) => {
    const { phone, pass, bizName } = req.body;
    if (!phone || !pass) return res.status(400).json({ error: "Phone and password required" });

    const filePath = path.join(DATA_DIR, `${phone}.json`);
    if (fs.existsSync(filePath)) {
        return res.status(400).json({ error: "Yeh phone number pehle se registered hai! Login karein." });
    }

    const userData = {
        profile: { phone, pass, bizName },
        transactions: [],
        parties: []
    };

    fs.writeFileSync(filePath, JSON.stringify(userData, null, 2));
    res.json({ success: true, user: userData.profile });
});

// User Login
app.post('/api/login', (req, res) => {
    const { phone, pass } = req.body;
    const filePath = path.join(DATA_DIR, `${phone}.json`);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Invalid Phone Number or Password! Pehle account register karein." });
    }

    const userData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (userData.profile.pass !== pass) {
        return res.status(401).json({ error: "Invalid Phone Number or Password!" });
    }

    res.json({ success: true, data: userData });
});

// Sync / Update Data with Pictures & Opening Balances
app.post('/api/save-data', (req, res) => {
    const { phone, transactions, parties } = req.body;
    const filePath = path.join(DATA_DIR, `${phone}.json`);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "User file not found!" });
    }

    const userData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    userData.transactions = transactions;
    userData.parties = parties;

    fs.writeFileSync(filePath, JSON.stringify(userData, null, 2));
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

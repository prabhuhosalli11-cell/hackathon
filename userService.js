const express = require('express');
const app = express();
const PORT = 3000;

// Mock Database of users (fitting the football/midfield theme)
const users = {
    "user_001": { name: "Alex Striker", tier: "Gold", status: "Active" },
    "user_002": { name: "Jordan Defender", tier: "Silver", status: "Active" },
    "user_003": { name: "Casey Midfielder", tier: "Bronze", status: "Inactive" },
    "user_004": { name: "Riley Goalie", tier: "Platinum", status: "Active" }
};

app.get('/api/users/:id', (req, res) => {
    const userId = req.params.id;
    const user = users[userId];

    // Simulate real-world network latency (100ms - 500ms)
    // This will mathematically prove the value of our Redis cache later.
    const networkDelay = Math.random() * 400 + 100;

    setTimeout(() => {
        if (user) {
            console.log(`[API] Fetched data for ${userId} (Took ${Math.round(networkDelay)}ms)`);
            res.json(user);
        } else {
            console.log(`[API] User ${userId} not found.`);
            res.status(404).json({ error: "User not found" });
        }
    }, networkDelay);
});

app.listen(PORT, () => {
    console.log(`🚀 [User Service] Mock API running on http://localhost:${PORT}`);
});
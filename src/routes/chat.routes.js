const express = require('express');
const pool = require('../database/pool');
const { requireDeviceAuth } = require('../middleware/requireDeviceAuth');
const { requireOwnDriverName } = require('../utils/mobile-scope');
const router = express.Router();

router.post('/api/send-chat', requireDeviceAuth, async (req, res) => {
    const { uuid, driverName, sender, message, timestamp } = req.body;
    const denied = requireOwnDriverName(req, res, driverName);
    if (denied) return denied;
    if (!message) return res.sendStatus(400);
    await pool.query('INSERT INTO chat_messages (uuid, driver_name, sender, message, timestamp) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5)', [uuid || null, req.deviceAuth.driverName, sender, message, timestamp || Date.now()]);
    res.sendStatus(200);
});

router.get('/api/get-chat/:driverName', requireDeviceAuth, async (req, res) => {
    const denied = requireOwnDriverName(req, res, req.params.driverName);
    if (denied) return denied;
    const result = await pool.query('SELECT uuid, sender, message, timestamp FROM chat_messages WHERE driver_name = $1 ORDER BY timestamp ASC', [req.deviceAuth.driverName]);
    res.json(result.rows.map(r => ({ uuid: r.uuid, driverName: req.deviceAuth.driverName, sender: r.sender || 'RENDSZER', message: r.message || '', timestamp: Number(r.timestamp) || Date.now() })));
});

module.exports = router;

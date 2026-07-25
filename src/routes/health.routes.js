const express = require('express');
const pool = require('../database/pool');
const router = express.Router();

router.get('/health', async (req, res) => {
    const body = {
        status: 'ok',
        service: 'logihero-backend',
        database: { status: 'unknown' }
    };

    try {
        await pool.query('SELECT 1');
        body.database.status = 'ok';
        return res.json(body);
    } catch (_err) {
        body.status = 'error';
        body.database.status = 'error';
        return res.status(503).json(body);
    }
});

module.exports = router;

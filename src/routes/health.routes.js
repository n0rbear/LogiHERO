const express = require('express');
const pool = require('../database/pool');
const packageJson = require('../../package.json');
const { APP_COMMIT_SHA, APP_BUILD_TIME } = require('../config/env');
const router = express.Router();

const versionBody = () => ({
    service: 'logihero-backend',
    version: packageJson.version,
    commit: APP_COMMIT_SHA,
    buildTime: APP_BUILD_TIME
});

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

router.get(['/version', '/health/version'], (req, res) => {
    res.json(versionBody());
});

module.exports = router;

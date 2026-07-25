const { Pool } = require('pg');
const { DATABASE_URL, IS_DEPLOYED } = require('../config/env');

if (IS_DEPLOYED && !DATABASE_URL) {
    throw new Error('DATABASE_URL is required in deployed environments.');
}

const isLocalDatabase =
    !DATABASE_URL ||
    DATABASE_URL.includes('localhost') ||
    DATABASE_URL.includes('127.0.0.1') ||
    DATABASE_URL.includes('host.docker.internal');

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: isLocalDatabase ? false : { rejectUnauthorized: false }
});

module.exports = pool;

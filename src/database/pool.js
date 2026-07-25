const { Pool } = require('pg');
const { DATABASE_URL } = require('../config/env');

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

const fs = require('node:fs');
const path = require('node:path');

function loadDotEnv(filePath = path.resolve(process.cwd(), '.env')) {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const index = trimmed.indexOf('=');
        if (index <= 0) continue;
        const key = trimmed.slice(0, index).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
        let value = trimmed.slice(index + 1).trim();
        if (value.endsWith(',')) value = value.slice(0, -1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[key] = value;
    }
}

loadDotEnv();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const READ_ONLY_ADMIN_TOKEN = process.env.READ_ONLY_ADMIN_TOKEN || '';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024);
const NODE_ENV = process.env.NODE_ENV;
const IS_DEPLOYED = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.NODE_ENV === 'production');
const DEFAULT_LOCAL_DATABASE_URL = 'postgresql://logihero_dev:logihero_dev_password@127.0.0.1:5433/logihero_dev';
const DATABASE_URL = process.env.DATABASE_URL || (IS_DEPLOYED ? '' : DEFAULT_LOCAL_DATABASE_URL);
const NDP_PROJECT_ID = process.env.NDP_PROJECT_ID || process.env.projectId || 'cms0g920d0001v1mom53he7pk';
const NDP_APP_NAME = process.env.NDP_APP_NAME || 'LogiHERO';
const NDP_ENVIRONMENT = process.env.NDP_ENVIRONMENT || process.env.environment || (process.env.NODE_ENV === 'production' ? 'production' : 'development');
const NDP_INGEST_ENDPOINT = process.env.NDP_INGEST_ENDPOINT || process.env.NDP_INGEST_URL || process.env.endpoint || '';
const NDP_SERVICE_NAME = process.env.NDP_SERVICE_NAME || 'logihero-backend';
const NDP_SERVICE_ID = process.env.NDP_SERVICE_ID || process.env.RENDER_SERVICE_ID || '';
const NDP_DEPLOY_ID = process.env.NDP_DEPLOY_ID || process.env.RENDER_DEPLOY_ID || '';
const NDP_BUILD_ORIGIN = process.env.NDP_BUILD_ORIGIN || (process.env.RENDER ? 'render' : 'local');
const PORT = process.env.PORT || 3000;
const APP_COMMIT_SHA = process.env.APP_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || 'unknown';
const APP_BUILD_TIME = process.env.APP_BUILD_TIME || 'unknown';
const APP_VERSION = process.env.APP_VERSION || '';
// LogiHERO is a private pre-release, so every response asks search engines not to index it.
// This defaults to on: a new environment or hostname is excluded unless someone deliberately
// opts in, and going public later is a configuration change rather than a code change.
const SEARCH_INDEXING_ALLOWED = String(process.env.SEARCH_INDEXING || '').trim().toLowerCase() === 'allow';
const ROBOTS_TAG = 'noindex, nofollow, noarchive, nosnippet, noimageindex';
const ROBOTS_META = 'noindex,nofollow,noarchive,nosnippet,noimageindex';

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || '';
const MISTRAL_API_URL = process.env.MISTRAL_API_URL || 'https://api.mistral.ai/v1/chat/completions';

function positiveIntEnv(name, fallback, min = 1) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) return fallback;
    return value;
}

const AI_RATE_LIMIT_BURST_WINDOW_MS = positiveIntEnv('AI_RATE_LIMIT_BURST_WINDOW_MS', 60_000);
const AI_RATE_LIMIT_BURST_MAX = positiveIntEnv('AI_RATE_LIMIT_BURST_MAX', 6);
const AI_RATE_LIMIT_DRIVER_WINDOW_MS = positiveIntEnv('AI_RATE_LIMIT_DRIVER_WINDOW_MS', 60 * 60_000);
const AI_RATE_LIMIT_DRIVER_MAX = positiveIntEnv('AI_RATE_LIMIT_DRIVER_MAX', 30);
const AI_RATE_LIMIT_COMPANY_WINDOW_MS = positiveIntEnv('AI_RATE_LIMIT_COMPANY_WINDOW_MS', 60 * 60_000);
const AI_RATE_LIMIT_COMPANY_MAX = positiveIntEnv('AI_RATE_LIMIT_COMPANY_MAX', 120);

module.exports = {
    ADMIN_TOKEN,
    READ_ONLY_ADMIN_TOKEN,
    MAX_UPLOAD_BYTES,
    NODE_ENV,
    DATABASE_URL,
    NDP_PROJECT_ID,
    NDP_APP_NAME,
    NDP_ENVIRONMENT,
    NDP_INGEST_ENDPOINT,
    NDP_SERVICE_NAME,
    NDP_SERVICE_ID,
    NDP_DEPLOY_ID,
    NDP_BUILD_ORIGIN,
    IS_DEPLOYED,
    PORT,
    APP_COMMIT_SHA,
    APP_BUILD_TIME,
    APP_VERSION,
    SEARCH_INDEXING_ALLOWED,
    ROBOTS_TAG,
    ROBOTS_META,
    MISTRAL_API_KEY,
    MISTRAL_API_URL,
    AI_RATE_LIMIT_BURST_WINDOW_MS,
    AI_RATE_LIMIT_BURST_MAX,
    AI_RATE_LIMIT_DRIVER_WINDOW_MS,
    AI_RATE_LIMIT_DRIVER_MAX,
    AI_RATE_LIMIT_COMPANY_WINDOW_MS,
    AI_RATE_LIMIT_COMPANY_MAX
};

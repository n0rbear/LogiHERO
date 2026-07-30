const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

function request(app, { path = '/', headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const req = http.request({
                hostname: '127.0.0.1',
                port: server.address().port,
                path,
                headers
            }, (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { text += chunk; });
                res.on('end', () => server.close(() => resolve({ status: res.statusCode, headers: res.headers, text })));
            });
            req.on('error', (error) => server.close(() => reject(error)));
            req.end();
        });
    });
}

function clearProjectModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('\\src\\') || key.includes('/src/')) delete require.cache[key];
    }
}

function restoreEnv(snapshot) {
    for (const key of Object.keys(process.env)) {
        if (!(key in snapshot)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(snapshot)) {
        process.env[key] = value;
    }
}

test('version endpoint exposes safe build metadata only', async () => {
    process.env.APP_COMMIT_SHA = 'abc123';
    process.env.APP_BUILD_TIME = '2026-07-26T10:00:00.000Z';
    process.env.ADMIN_TOKEN = 'super-secret-token';
    clearProjectModules();

    const pool = require('../src/database/pool');
    pool.query = async () => ({ rows: [] });

    const app = express();
    app.use(require('../src/routes/health.routes'));
    const res = await request(app, { path: '/version' });

    assert.equal(res.status, 200);
    const body = JSON.parse(res.text);
    assert.equal(body.service, 'logihero-backend');
    assert.equal(body.commit, 'abc123');
    assert.equal(body.buildTime, '2026-07-26T10:00:00.000Z');
    assert.equal(JSON.stringify(body).includes('super-secret-token'), false);
});

test('health is liveness and ready reports sanitized readiness checks', async () => {
    process.env.APP_COMMIT_SHA = 'ready123';
    process.env.ADMIN_TOKEN = 'admin-token-value';
    process.env.DATABASE_URL = 'postgresql://user:secret@example/db';
    clearProjectModules();

    const pool = require('../src/database/pool');
    pool.query = async (sql) => {
        if (sql.includes('information_schema.tables')) return { rows: [{ exists: true }] };
        if (sql.includes('schema_migrations')) return { rows: [{ count: 1 }] };
        return { rows: [] };
    };

    const app = express();
    app.use(require('../src/routes/health.routes'));

    const health = await request(app, { path: '/health' });
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.text).database, undefined);

    const ready = await request(app, { path: '/ready' });
    assert.equal(ready.status, 200);
    const body = JSON.parse(ready.text);
    assert.equal(body.status, 'READY');
    assert.equal(body.checks.config.databaseUrl, 'present');
    assert.equal(JSON.stringify(body).includes('secret'), false);
    assert.equal(JSON.stringify(body).includes('admin-token-value'), false);
});

test('request tracing, admin no-store, x-powered-by removal, and safe 500 body', async () => {
    const {
        requestIdMiddleware,
        securityHeadersMiddleware,
        adminNoStoreMiddleware,
        errorHandler
    } = require('../src/middleware/http-hardening');

    const app = express();
    app.disable('x-powered-by');
    app.use(requestIdMiddleware);
    app.use(securityHeadersMiddleware);
    app.use(adminNoStoreMiddleware);
    app.get('/admin/broken', () => {
        throw new Error('database password token should not leak');
    });
    app.use(errorHandler);

    const res = await request(app, {
        path: '/admin/broken',
        headers: { accept: 'text/html', 'x-request-id': 'trace-test-1' }
    });

    assert.equal(res.status, 500);
    assert.equal(res.headers['x-request-id'], 'trace-test-1');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.match(res.text, /Trace ID: trace-test-1/);
    assert.doesNotMatch(res.text, /database password token/);
});

test('local .env is loaded without overriding existing process env', () => {
    const originalEnv = { ...process.env };
    const originalCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logihero-env-'));
    try {
        delete process.env.NDP_INGEST_ENDPOINT;
        delete process.env.NDP_PROJECT_ID;
        process.env.NDP_ENVIRONMENT = 'shell-value';
        fs.writeFileSync(
            path.join(tempDir, '.env'),
            [
                'NDP_INGEST_URL=http://localhost:4000/api/ingest/events',
                'NDP_PROJECT_ID=project_from_dotenv',
                'NDP_ENVIRONMENT=dotenv-value'
            ].join('\n')
        );
        process.chdir(tempDir);
        clearProjectModules();

        const env = require('../src/config/env');

        assert.equal(env.NDP_INGEST_ENDPOINT, 'http://localhost:4000/api/ingest/events');
        assert.equal(env.NDP_PROJECT_ID, 'project_from_dotenv');
        assert.equal(env.NDP_ENVIRONMENT, 'shell-value');
    } finally {
        process.chdir(originalCwd);
        restoreEnv(originalEnv);
        clearProjectModules();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('NDP client accepts lowercase local key names from generated NDP config', () => {
    const originalEnv = { ...process.env };
    const originalFetch = global.fetch;
    const originalCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logihero-ndp-env-'));
    try {
        for (const key of [
            'NDP_INGEST_ENDPOINT',
            'NDP_INGEST_URL',
            'NDP_INGEST_KEY',
            'NDP_PROJECT_ID',
            'NDP_ENVIRONMENT',
            'configuration',
            'endpoint',
            'projectId',
            'ingestKey',
            'environment'
        ]) {
            delete process.env[key];
        }
        fs.writeFileSync(
            path.join(tempDir, '.env'),
            [
                'configuration=LogiHERO',
                'endpoint=http://localhost:4000/api/ingest/events',
                'projectId=project_lowercase',
                'ingestKey=test-lowercase-ingest-key',
                'environment=production'
            ].join('\n')
        );
        process.chdir(tempDir);
        clearProjectModules();
        global.fetch = async () => ({ ok: true });

        const env = require('../src/config/env');
        const ndp = require('../src/integrations/ndp-client');

        assert.equal(env.NDP_INGEST_ENDPOINT, 'http://localhost:4000/api/ingest/events');
        assert.equal(env.NDP_PROJECT_ID, 'project_lowercase');
        assert.equal(env.NDP_ENVIRONMENT, 'production');
        assert.equal(ndp.isEnabled(), true);
    } finally {
        process.chdir(originalCwd);
        global.fetch = originalFetch;
        restoreEnv(originalEnv);
        clearProjectModules();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('NDP client sends runtime version metadata from environment', async () => {
    const originalEnv = { ...process.env };
    const originalFetch = global.fetch;
    try {
        process.env.NDP_INGEST_ENDPOINT = 'http://ndp.local/api/ingest/events';
        process.env.NDP_INGEST_KEY = 'test-ingest-key';
        process.env.NDP_PROJECT_ID = 'project_logihero';
        process.env.NDP_APP_NAME = 'LogiHERO';
        process.env.NDP_ENVIRONMENT = 'production';
        process.env.NDP_SERVICE_NAME = 'logihero-backend';
        process.env.NDP_SERVICE_ID = 'srv-test';
        process.env.NDP_DEPLOY_ID = 'dep-test';
        process.env.NDP_BUILD_ORIGIN = 'render';
        process.env.APP_COMMIT_SHA = 'abc1234';
        process.env.APP_VERSION = '1.0.0';
        clearProjectModules();

        const calls = [];
        global.fetch = async (url, options) => {
            calls.push({ url, options });
            return { ok: true };
        };

        const ndp = require('../src/integrations/ndp-client');
        assert.equal(ndp.isEnabled(), true);
        await ndp.trackEvent({
            traceId: 'trace-1',
            eventType: 'test_event',
            title: 'Test event',
            payload: { ok: true }
        });

        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'http://ndp.local/api/ingest/events');
        const body = JSON.parse(calls[0].options.body);
        assert.equal(body.projectId, 'project_logihero');
        assert.equal(body.runtimeVersion.commitSha, 'abc1234');
        assert.equal(body.runtimeVersion.deployId, 'dep-test');
        assert.equal(body.runtimeVersion.serviceId, 'srv-test');
        assert.equal(body.runtimeVersion.serviceName, 'logihero-backend');
        assert.equal(body.runtimeVersion.environment, 'production');
        assert.equal(body.runtimeVersion.provider, 'render');
        assert.equal(JSON.stringify(body).includes('test-ingest-key'), false);
    } finally {
        global.fetch = originalFetch;
        restoreEnv(originalEnv);
        clearProjectModules();
    }
});

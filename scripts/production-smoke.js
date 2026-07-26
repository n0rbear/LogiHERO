const http = require('node:http');
const https = require('node:https');

const baseUrl = process.env.SMOKE_BASE_URL || process.env.PRODUCTION_BASE_URL || 'https://logihero-backend.onrender.com';
const expectedCommit = process.env.SMOKE_EXPECTED_COMMIT || process.env.APP_COMMIT_SHA || '';
const readOnlyToken = process.env.PRODUCTION_SMOKE_ADMIN_TOKEN || process.env.READ_ONLY_ADMIN_TOKEN || '';

function request(path, options = {}) {
    const url = new URL(path, baseUrl);
    const lib = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const req = lib.request(url, {
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: 20000
        }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

(async () => {
    let authenticated = false;
    const health = await request('/health');
    assert(health.status === 200, '/health must be 200');
    assert(!health.headers['x-powered-by'], 'x-powered-by must be absent');

    const version = await request('/version');
    assert(version.status === 200, '/version must be 200');
    if (expectedCommit) assert(version.body.includes(expectedCommit), '/version must contain expected commit');

    const protectedPaths = ['/admin/work-time', '/admin/work-time/weekly'];
    for (const path of protectedPaths) {
        const response = await request(path);
        assert([200, 302].includes(response.status), `${path} must be reachable or redirect to login`);
        assert(!response.headers['x-powered-by'], `${path} x-powered-by must be absent`);
        assert(String(response.headers['cache-control'] || '').includes('no-store'), `${path} must be no-store`);
    }

    if (readOnlyToken) {
        authenticated = true;
        for (const path of ['/admin', '/admin/drivers', '/admin/hotels', '/admin/tours', '/admin/work-time', '/admin/work-time/weekly']) {
            const response = await request(path, { headers: { authorization: `Bearer ${readOnlyToken}`, accept: 'text/html' } });
            assert(response.status === 200, `${path} read-only bearer access must be 200`);
            assert(!response.body.includes('Internal Server Error'), `${path} must not return 500 body`);
            assert(!response.body.includes('Error:'), `${path} must not expose stack traces`);
            assert(!String(response.body).match(/<button[^>]*(Ment|Torol|Jovahagy|Elutasit)/i), `${path} read-only UI must not expose active write buttons`);
        }
        const denied = await request('/admin/work-time/bulk/approve', {
            method: 'POST',
            headers: { authorization: `Bearer ${readOnlyToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({ days: [] })
        });
        assert(denied.status === 403, 'read-only write attempt must be 403');
    } else {
        console.log('[SMOKE] PARTIAL: PRODUCTION_SMOKE_ADMIN_TOKEN not set; authenticated read-only checks skipped.');
    }

    const syncVersion = await request('/api/sync/version');
    assert(syncVersion.status === 200, '/api/sync/version must be 200');
    if (!authenticated && process.env.SMOKE_ALLOW_PARTIAL !== 'true') {
        console.log('[SMOKE] PARTIAL production smoke completed; set PRODUCTION_SMOKE_ADMIN_TOKEN for authenticated validation.');
        process.exit(2);
    }
    console.log(authenticated ? '[SMOKE] production authenticated read-only smoke passed' : '[SMOKE] production partial smoke passed');
})().catch((error) => {
    console.error('[SMOKE] failed:', error.message);
    process.exit(1);
});

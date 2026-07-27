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

function statusLine(status, message) {
    console.log(`[SMOKE] status=${status} ${message}`);
}

function readOnlyWriteButtons(body) {
    const matches = String(body).match(/<button\b[\s\S]*?<\/button>/gi) || [];
    return matches.filter((button) => {
        const text = button.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const normalized = `${button} ${text}`
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
        if (/logout|kijelentkezes|close|bezar|megnyitas|szures|google maps|osszes sofor|adatlap|menu-toggle|sidebar-open/.test(normalized)) {
            return false;
        }
        return /mentes|mentese|modositas|torol|deaktivalas|uj kod|regenerate|rotate-token|jovahagy|elutasit|korrekcio/.test(normalized);
    });
}

(async () => {
    let authenticated = false;
    const health = await request('/health');
    assert(health.status === 200, '/health must be 200');
    assert(!health.headers['x-powered-by'], 'x-powered-by must be absent');

    const ready = await request('/ready');
    assert(ready.status === 200, '/ready must be 200');
    assert(JSON.parse(ready.body).status === 'READY', '/ready must report READY');

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
        const authHeaders = { authorization: `Bearer ${readOnlyToken}`, accept: 'text/html' };
        const before = await request('/admin/api/smoke-snapshot', {
            headers: { authorization: `Bearer ${readOnlyToken}`, accept: 'application/json' }
        });
        assert(before.status === 200, 'pre-smoke snapshot must be 200');
        const beforeSnapshot = JSON.parse(before.body);
        assert(beforeSnapshot.role === 'READ_ONLY', 'smoke credential must be READ_ONLY');

        for (const path of ['/admin', '/admin/drivers', '/admin/hotels', '/admin/tours', '/admin/work-time', '/admin/work-time/weekly']) {
            const response = await request(path, { headers: authHeaders });
            assert(response.status === 200, `${path} read-only bearer access must be 200`);
            assert(!response.body.includes('Internal Server Error'), `${path} must not return 500 body`);
            assert(!response.body.includes('Error:'), `${path} must not expose stack traces`);
            assert(readOnlyWriteButtons(response.body).length === 0, `${path} read-only UI must not expose active write buttons`);
            assert(!String(response.body).includes('rotate-device-token'), `${path} must not expose token rotation button`);
            assert(String(response.headers['cache-control'] || '').includes('no-store'), `${path} must be no-store`);
            assert(!response.headers['x-powered-by'], `${path} x-powered-by must be absent`);
        }
        const denied = await request('/admin/work-time/bulk/approve', {
            method: 'POST',
            headers: { authorization: `Bearer ${readOnlyToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({ days: [] })
        });
        assert(denied.status === 403, 'read-only write attempt must be 403');

        const deniedRotation = await request('/admin/drivers/11111111-1111-4111-8111-111111111111/devices/dev-device-active-1/rotate-token', {
            method: 'POST',
            headers: { authorization: `Bearer ${readOnlyToken}` }
        });
        assert(deniedRotation.status === 403, 'read-only token rotation attempt must be 403');

        const login = await request('/admin/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: readOnlyToken })
        });
        assert(login.status === 200, 'read-only cookie login must be 200');
        const csrfToken = JSON.parse(login.body).csrfToken;
        const cookie = Array.isArray(login.headers['set-cookie'])
            ? login.headers['set-cookie'].map(v => v.split(';')[0]).join('; ')
            : String(login.headers['set-cookie'] || '').split(';')[0];
        const logout = await request('/admin/logout', {
            method: 'POST',
            headers: { cookie, 'x-csrf-token': csrfToken }
        });
        assert([200, 302].includes(logout.status), 'logout must complete without error');

        const after = await request('/admin/api/smoke-snapshot', {
            headers: { authorization: `Bearer ${readOnlyToken}`, accept: 'application/json' }
        });
        assert(after.status === 200, 'post-smoke snapshot must be 200');
        const afterSnapshot = JSON.parse(after.body);
        assert(JSON.stringify(afterSnapshot.snapshot) === JSON.stringify(beforeSnapshot.snapshot), 'read-only smoke must not change business counters');
        assert(afterSnapshot.syncVersion === beforeSnapshot.syncVersion, 'read-only smoke must not change sync version');
    } else {
        statusLine('BLOCKED_MISSING_CREDENTIAL', 'PRODUCTION_SMOKE_ADMIN_TOKEN not set; authenticated read-only checks skipped.');
    }

    const syncVersion = await request('/api/sync/version');
    assert(syncVersion.status === 200, '/api/sync/version must be 200');
    if (!authenticated && process.env.SMOKE_ALLOW_PARTIAL !== 'true') {
        statusLine('BLOCKED_MISSING_CREDENTIAL', 'public checks completed; set PRODUCTION_SMOKE_ADMIN_TOKEN for authenticated validation.');
        process.exit(2);
    }
    statusLine(authenticated ? 'FULL_PASS' : 'PARTIAL_PUBLIC_ONLY', authenticated ? 'production authenticated read-only smoke passed' : 'production partial public-only smoke passed');
})().catch((error) => {
    console.error('[SMOKE] status=FAILED', error.message);
    process.exit(1);
});

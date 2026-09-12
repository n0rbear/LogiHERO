// LogiHERO is a private pre-release and must not show up in search results. The guarantee is
// the X-Robots-Tag response header (the HTML meta tag alone would not cover API JSON or files),
// so these tests pin the header onto every response type and prove it stays a passive header:
// no change to status, body, authentication, CORS or redirects.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const EXPECTED_TAG = 'noindex, nofollow, noarchive, nosnippet, noimageindex';
const EXPECTED_META = 'noindex,nofollow,noarchive,nosnippet,noimageindex';

function freshModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('\\src\\') || key.includes('/src/')) delete require.cache[key];
    }
}

function request(app, { method = 'GET', path = '/', headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const req = http.request({ hostname: '127.0.0.1', port: server.address().port, method, path, headers }, (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { text += chunk; });
                res.on('end', () => server.close(() => resolve({ status: res.statusCode, headers: res.headers, text })));
            });
            req.on('error', error => server.close(() => reject(error)));
            req.end();
        });
    });
}

// Mirrors the real middleware order from server.js.
function buildApp() {
    freshModules();
    const { searchExclusionMiddleware, robotsTxtMiddleware } = require('../src/middleware/http-hardening');
    const renderAdminLayout = require('../src/utils/admin-layout');
    const app = express();
    app.use((req, _res, next) => { req.requestId = 'noindex-test'; next(); });
    app.use(searchExclusionMiddleware);
    app.use(robotsTxtMiddleware);
    app.get('/admin/page', (_req, res) => res.send(renderAdminLayout({ title: 'Test', content: '<p>body</p>', activeMenu: 'dashboard', csrfToken: 'token' })));
    app.get('/api/thing', (_req, res) => res.json({ ok: true, value: 42 }));
    app.get('/downloads/file.csv', (_req, res) => { res.setHeader('Content-Type', 'text/csv'); res.send('a,b\n1,2\n'); });
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
    app.post('/api/echo', express.json(), (req, res) => res.status(201).json(req.body || {}));
    app.get('/api/protected', (req, res) => {
        if (req.headers['x-device-token'] !== 'secret') return res.status(401).json({ error: 'DEVICE_CREDENTIAL_INVALID' });
        return res.json({ ok: true });
    });
    return app;
}

test('HTML responses carry the X-Robots-Tag header', async () => {
    const res = await request(buildApp(), { path: '/admin/page' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-robots-tag'], EXPECTED_TAG);
});

test('API JSON responses carry the X-Robots-Tag header', async () => {
    const res = await request(buildApp(), { path: '/api/thing' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-robots-tag'], EXPECTED_TAG);
});

test('downloadable content carries the X-Robots-Tag header', async () => {
    // The meta tag cannot reach a CSV, which is the reason the header is the primary mechanism.
    const res = await request(buildApp(), { path: '/downloads/file.csv' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-robots-tag'], EXPECTED_TAG);
});

test('generated admin HTML includes the robots meta directive', async () => {
    const res = await request(buildApp(), { path: '/admin/page' });
    assert.match(res.text, new RegExp(`<meta name="robots" content="${EXPECTED_META}">`));
});

test('every server-rendered HTML head carries the robots meta directive', async () => {
    // Found during review: the admin login page and the driver dashboard build their own
    // <head> rather than going through renderAdminLayout, so adding the tag in one place
    // silently missed them. This fails if a new page introduces another bare <head>.
    const fs = require('node:fs');
    const path = require('node:path');
    const roots = [path.join(__dirname, '..', 'src')];
    const htmlFiles = [];
    while (roots.length) {
        for (const entry of fs.readdirSync(roots.pop(), { withFileTypes: true, recursive: false }).map(e => e)) {
            const full = path.join(entry.parentPath || entry.path, entry.name);
            if (entry.isDirectory()) roots.push(full);
            else if (entry.name.endsWith('.js') && fs.readFileSync(full, 'utf8').includes('<head>')) htmlFiles.push(full);
        }
    }
    assert.ok(htmlFiles.length >= 3, `expected to find the known HTML generators, found ${htmlFiles.length}`);
    for (const file of htmlFiles) {
        const source = fs.readFileSync(file, 'utf8');
        assert.match(source, /name="robots"/, `${path.basename(file)} renders a <head> without the robots meta directive`);
    }
});

test('response status and body are otherwise unchanged', async () => {
    const app = buildApp();
    const json = await request(app, { path: '/api/thing' });
    assert.deepEqual(JSON.parse(json.text), { ok: true, value: 42 });
    const csv = await request(app, { path: '/downloads/file.csv' });
    assert.equal(csv.text, 'a,b\n1,2\n');
    assert.match(csv.headers['content-type'], /^text\/csv/);
    const html = await request(app, { path: '/admin/page' });
    assert.match(html.text, /<p>body<\/p>/);
});

test('health stays a plain 200 and still carries the header', async () => {
    const res = await request(buildApp(), { path: '/health' });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text), { status: 'ok' });
    assert.equal(res.headers['x-robots-tag'], EXPECTED_TAG);
});

test('authentication behaviour is unchanged, and rejections are also not indexable', async () => {
    const app = buildApp();
    const denied = await request(app, { path: '/api/protected' });
    assert.equal(denied.status, 401, 'the header must not accidentally authorise anything');
    assert.equal(JSON.parse(denied.text).error, 'DEVICE_CREDENTIAL_INVALID');
    assert.equal(denied.headers['x-robots-tag'], EXPECTED_TAG);

    const allowed = await request(app, { path: '/api/protected', headers: { 'x-device-token': 'secret' } });
    assert.equal(allowed.status, 200);
    assert.deepEqual(JSON.parse(allowed.text), { ok: true });
});

test('non-GET API requests are unaffected apart from the header', async () => {
    const res = await request(buildApp(), { method: 'POST', path: '/api/echo' });
    assert.equal(res.status, 201, 'status is untouched');
    assert.equal(res.headers['x-robots-tag'], EXPECTED_TAG);
    assert.equal(res.headers.location, undefined, 'nothing is redirected');
});

test('robots.txt allows crawling so the noindex directive can actually be observed', async () => {
    const res = await request(buildApp(), { path: '/robots.txt' });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/plain/);
    assert.match(res.text, /User-agent: \*/);
    assert.match(res.text, /^Disallow:\s*$/m, 'an empty Disallow keeps the site crawlable');
    assert.doesNotMatch(res.text, /^Disallow:\s*\/\s*$/m, 'blocking the crawl would hide the noindex directive');
    assert.equal(res.headers['x-robots-tag'], EXPECTED_TAG);
});

test('setting SEARCH_INDEXING=allow lifts the exclusion without any code change', async () => {
    const previous = process.env.SEARCH_INDEXING;
    process.env.SEARCH_INDEXING = 'allow';
    try {
        const app = buildApp();
        const api = await request(app, { path: '/api/thing' });
        assert.equal(api.headers['x-robots-tag'], undefined);
        const html = await request(app, { path: '/admin/page' });
        assert.doesNotMatch(html.text, /name="robots"/);
        const robots = await request(app, { path: '/robots.txt' });
        assert.equal(robots.status, 200);
    } finally {
        if (previous === undefined) delete process.env.SEARCH_INDEXING;
        else process.env.SEARCH_INDEXING = previous;
        freshModules();
    }
});

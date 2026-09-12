const crypto = require('node:crypto');
const ndp = require('../integrations/ndp-client');
const { SEARCH_INDEXING_ALLOWED, ROBOTS_TAG } = require('../config/env');

function requestIdMiddleware(req, res, next) {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && incoming.trim() ? incoming.trim().slice(0, 128) : crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
}

function securityHeadersMiddleware(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://unpkg.com",
        "style-src 'self' 'unsafe-inline' https://unpkg.com",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' https://router.project-osrm.org https://tile.openstreetmap.org",
        "frame-ancestors 'none'",
        "base-uri 'self'"
    ].join('; '));
    next();
}

// Keeps the private pre-release out of search results. X-Robots-Tag is honoured for every
// response type, not just HTML, so admin pages, API JSON and anything served from /downloads or
// /uploads are all covered by one header rather than by per-route markup.
//
// Deliberately not host-conditional. This process only ever answers for LogiHERO, so applying it
// to every request covers logihero.norbapp.com, the Render *.onrender.com hostname and any
// preview host, with no way for an unlisted hostname to leak into an index. It cannot affect
// other NorbApp services because they do not run through this middleware.
//
// Passive header only: it does not touch status, body, authentication, CORS or redirects.
function searchExclusionMiddleware(req, res, next) {
    if (!SEARCH_INDEXING_ALLOWED) res.setHeader('X-Robots-Tag', ROBOTS_TAG);
    next();
}

// Crawlers have to be able to fetch a URL to see its noindex directive, so this deliberately
// does not disallow anything. "Disallow: /" would block the fetch, leaving a URL that was
// discovered elsewhere (a link, a certificate log) eligible to appear as a bare result with no
// noindex ever observed. Serving a permissive robots.txt also makes the intent explicit, so the
// reflex "just disallow everything" change does not get made later by mistake.
function robotsTxtMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path !== '/robots.txt') return next();
    const body = SEARCH_INDEXING_ALLOWED
        ? 'User-agent: *\nDisallow:\n'
        : [
            '# LogiHERO is a private pre-release.',
            '# Crawling is intentionally allowed so the X-Robots-Tag: noindex response header',
            '# and the HTML robots meta tag can actually be observed. Do not add "Disallow: /":',
            '# blocking the fetch would hide the noindex directive rather than enforce it.',
            'User-agent: *',
            'Disallow:',
            ''
        ].join('\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(body);
}

function adminNoStoreMiddleware(req, res, next) {
    if (req.path === '/admin' || req.path.startsWith('/admin/')) {
        res.setHeader('Cache-Control', 'no-store');
    }
    next();
}

function logSafeError(req, err) {
    const status = Number(err.status || err.statusCode || 500);
    const message = err && err.message ? err.message : 'Unhandled error';
    console.error(`[ERROR] requestId=${req.requestId || 'unknown'} route=${req.originalUrl || req.url} method=${req.method} status=${status} environment=${process.env.NODE_ENV || 'development'} commit=${process.env.APP_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || 'unknown'} message=${message}`);
}

function trackServerError(req, status) {
    ndp.trackEvent({
        traceId: req.requestId || ndp.getTraceId(req),
        eventType: 'backend_request_failed',
        severity: status >= 500 ? 'ERROR' : 'WARNING',
        title: 'Backend request failed',
        component: 'backend',
        payload: {
            route: req.originalUrl || req.url,
            method: req.method,
            status,
            requestId: req.requestId || 'unknown'
        }
    });
}

function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);
    const status = Number(err.status || err.statusCode || 500);
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    const requestId = req.requestId || 'unknown';
    logSafeError(req, err);
    trackServerError(req, safeStatus);

    if ((req.headers.accept || '').includes('text/html') && !req.originalUrl.startsWith('/api/')) {
        return res.status(safeStatus).send(`
            <div style="font-family:sans-serif; padding:40px;">
                <h1>Hiba tortent</h1>
                <p>Kerlek probald ujra kesobb.</p>
                <p style="color:#707275;">Trace ID: ${requestId}</p>
            </div>
        `);
    }

    return res.status(safeStatus).json({
        error: safeStatus === 500 ? 'Internal server error' : 'Request failed',
        requestId
    });
}

module.exports = {
    requestIdMiddleware,
    securityHeadersMiddleware,
    searchExclusionMiddleware,
    robotsTxtMiddleware,
    adminNoStoreMiddleware,
    errorHandler
};

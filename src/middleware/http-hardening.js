const crypto = require('node:crypto');
const ndp = require('../integrations/ndp-client');

function requestIdMiddleware(req, res, next) {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && incoming.trim() ? incoming.trim().slice(0, 128) : crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
}

function securityHeadersMiddleware(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
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
    adminNoStoreMiddleware,
    errorHandler
};

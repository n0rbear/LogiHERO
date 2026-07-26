const crypto = require('node:crypto');

function requestIdMiddleware(req, res, next) {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && incoming.trim() ? incoming.trim().slice(0, 128) : crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
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
    console.error(`[ERROR] requestId=${req.requestId || 'unknown'} status=${status} message=${message}`);
}

function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);
    const status = Number(err.status || err.statusCode || 500);
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    const requestId = req.requestId || 'unknown';
    logSafeError(req, err);

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
    adminNoStoreMiddleware,
    errorHandler
};

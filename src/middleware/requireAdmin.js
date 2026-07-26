const { ADMIN_TOKEN, IS_DEPLOYED } = require('../config/env');

const requireAdmin = (req, res, next) => {
    // 1. Check if ADMIN_TOKEN is configured
    if (!ADMIN_TOKEN) {
        console.warn('[SECURITY] ADMIN_TOKEN is not configured; admin UI disabled');
        if (IS_DEPLOYED) {
            // Check if it's a browser request for an admin page
            if (req.originalUrl.startsWith('/admin') && !req.originalUrl.startsWith('/admin/api')) {
                return res.status(503).send(`
                    <div style="font-family:sans-serif; text-align:center; padding:50px;">
                        <h1>⚠️ Configuration Error</h1>
                        <p>ADMIN_TOKEN is not configured in the production environment.</p>
                        <p>Please add the <b>ADMIN_TOKEN</b> environment variable on Render dashboard.</p>
                        <hr>
                        <a href="/health">System Health</a>
                    </div>
                `);
            }
            return res.status(503).json({ error: 'ADMIN_TOKEN is not configured.' });
        }
        return next(); // Allow in local dev without token
    }

    // 2. Extract token from various sources
    let token = null;

    // a. Authorization Header (API usage)
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
        token = header.slice(7);
    }

    // b. Custom Headers or Query Params
    if (!token) {
        token = req.headers['x-admin-token'] || req.query.adminToken;
    }

    // c. Cookie (Browser usage)
    if (!token && req.headers.cookie) {
        const cookies = Object.fromEntries(req.headers.cookie.split(';').map(c => c.trim().split('=')));
        token = cookies['admin_session'];
    }

    // 3. Verify token
    if (token === ADMIN_TOKEN) {
        return next();
    }

    // 4. Handle unauthorized
    // If it's a browser request (not an API call), redirect to login
    const isApiRequest = req.originalUrl.includes('/api/') || req.headers['accept'] === 'application/json';

    if (!isApiRequest && req.originalUrl.startsWith('/admin')) {
        // Avoid loop if already on login page
        if (req.originalUrl.startsWith('/admin/login')) {
            return next();
        }
        return res.redirect('/admin/login?redirect=' + encodeURIComponent(req.originalUrl));
    }

    return res.sendStatus(401);
};

module.exports = requireAdmin;

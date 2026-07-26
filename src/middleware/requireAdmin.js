const { ADMIN_TOKEN, IS_DEPLOYED } = require('../config/env');
const {
    getAdminSession,
    verifyAdminToken,
    verifyCsrfToken
} = require('../utils/admin-session');

const parseCookies = (header) => {
    if (!header) return {};
    return Object.fromEntries(header.split(';').map((cookie) => {
        const [name, ...rest] = cookie.trim().split('=');
        return [name, decodeURIComponent(rest.join('='))];
    }));
};

const wantsJson = (req) => {
    const accept = req.headers.accept || '';
    return req.originalUrl.includes('/api/') ||
        req.xhr ||
        req.headers['x-requested-with'] === 'XMLHttpRequest' ||
        accept.includes('application/json');
};

const isUnsafeMethod = (method) => !['GET', 'HEAD', 'OPTIONS'].includes(method);

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

    // 2. Extract supported token/session sources.
    let bearerToken = null;
    let headerToken = null;
    let session = null;

    // a. Authorization Header (API usage)
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
        bearerToken = header.slice(7);
    }

    // b. Optional custom header for internal automation.
    if (!bearerToken) {
        headerToken = req.headers['x-admin-token'];
    }

    // c. Cookie (Browser usage)
    if (!bearerToken && !headerToken) {
        const cookies = parseCookies(req.headers.cookie);
        session = getAdminSession(cookies['admin_session']);
    }

    // 3. Verify token
    if (verifyAdminToken(bearerToken || headerToken, ADMIN_TOKEN)) {
        req.adminAuthType = bearerToken ? 'bearer' : 'header';
        return next();
    }

    if (session) {
        req.adminAuthType = 'cookie';
        req.adminSession = session;
        req.adminCsrfToken = session.csrfToken;
        if (isUnsafeMethod(req.method) && !verifyCsrfToken(session, req.headers['x-csrf-token'] || req.body?._csrf)) {
            return res.status(403).json({ error: 'CSRF token invalid or missing.' });
        }
        return next();
    }

    // 4. Handle unauthorized
    // If it's a browser request (not an API call), redirect to login
    const isApiRequest = wantsJson(req);

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

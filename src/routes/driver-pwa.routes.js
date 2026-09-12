const express = require('express');
const pool = require('../database/pool');
const { ROBOTS_META } = require('../config/env');
const { rateLimit } = require('../middleware/rate-limit');
const { escapeHtml } = require('../utils/escape');
const {
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    hashPassword,
    normalizeUsername,
    validatePassword,
    verifyPassword
} = require('../utils/driver-password');
const {
    clearDriverSessionCookie,
    createDriverSession,
    loadDriverSession,
    setDriverSessionCookie,
    verifySessionCsrf
} = require('../utils/driver-session');

const router = express.Router();
const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=19456,p=1,t=2$QQ5hynr7EPCe0yS7t7MOIg$gwH7tE2t/yCe6CaqZbzEzatwTdLGhhYruXWwOGdqdJM';

function layout(title, content) {
    return `<!doctype html>
<html lang="hu">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="${escapeHtml(ROBOTS_META)}">
    <meta name="theme-color" content="#173f35">
    <link rel="manifest" href="/app/manifest.webmanifest">
    <title>${escapeHtml(title)} · LogiHERO</title>
    <style>
        :root { color-scheme: light; font-family: Inter, system-ui, sans-serif; color:#142520; background:#eff5f1; }
        * { box-sizing:border-box; }
        body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px; }
        main { width:min(100%, 440px); }
        .brand { color:#173f35; font-size:14px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
        .card { margin-top:14px; background:#fff; border:1px solid #d7e3dc; border-radius:18px; padding:28px; box-shadow:0 14px 38px rgba(23,63,53,.08); }
        h1 { margin:0 0 8px; font-size:28px; }
        p { color:#51645d; line-height:1.5; }
        label { display:block; margin:18px 0 7px; font-weight:700; }
        input { width:100%; padding:13px 14px; border:1px solid #aebfb6; border-radius:10px; font:inherit; }
        input:focus { outline:3px solid #b9dfd1; border-color:#276d59; }
        button { width:100%; margin-top:22px; padding:13px 18px; border:0; border-radius:10px; background:#173f35; color:#fff; font:inherit; font-weight:800; cursor:pointer; }
        .secondary { background:#fff; color:#173f35; border:1px solid #8ca299; }
        .error { border-left:4px solid #b42318; background:#fff2f0; color:#8d1b13; padding:11px 13px; border-radius:8px; }
        .notice { border-left:4px solid #2f7663; background:#edf8f3; color:#245748; padding:11px 13px; border-radius:8px; }
        small { color:#65776f; }
    </style>
</head>
<body><main><div class="brand">LogiHERO Driver</div><section class="card">${content}</section></main></body>
</html>`;
}

function sameOriginRequest(req) {
    const source = req.headers.origin || req.headers.referer;
    if (!source) return false;
    try {
        return new URL(source).host === req.get('host');
    } catch {
        return false;
    }
}

async function attachSession(req, res, next) {
    try {
        req.driverSession = await loadDriverSession(pool, req);
        next();
    } catch (error) {
        next(error);
    }
}

function requireSession(req, res, next) {
    if (!req.driverSession) {
        clearDriverSessionCookie(res);
        return res.redirect(303, '/app/login');
    }
    next();
}

function requireSessionCsrf(req, res, next) {
    const supplied = req.headers['x-csrf-token'] || req.body?._csrf;
    if (!verifySessionCsrf(req.driverSession, supplied)) {
        return res.status(403).send(layout('Érvénytelen kérés', '<h1>Érvénytelen kérés</h1><p>Kérjük, frissítsd az oldalt és próbáld újra.</p>'));
    }
    next();
}

router.get('/app/manifest.webmanifest', (_req, res) => {
    res.type('application/manifest+json').send({
        name: 'LogiHERO Driver',
        short_name: 'LogiHERO',
        start_url: '/app',
        scope: '/app',
        display: 'standalone',
        background_color: '#eff5f1',
        theme_color: '#173f35'
    });
});

router.get('/app/login', attachSession, (req, res) => {
    if (req.driverSession) {
        return res.redirect(req.driverSession.must_change_password ? '/app/change-password' : '/app');
    }
    const error = req.query.error ? '<div class="error" role="alert">Hibás felhasználónév vagy jelszó.</div>' : '';
    res.send(layout('Bejelentkezés', `
        <h1>Bejelentkezés</h1>
        <p>A diszpécsertől kapott sofőrfiókkal jelentkezz be.</p>
        ${error}
        <form method="post" action="/app/login">
            <label for="username">Felhasználónév</label>
            <input id="username" name="username" autocomplete="username" autocapitalize="none" required maxlength="64">
            <label for="password">Jelszó</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="${PASSWORD_MAX_LENGTH}">
            <button type="submit">Bejelentkezés</button>
        </form>
    `));
});

router.post('/app/login', rateLimit({ name: 'driver-web-login', windowMs: 60_000, max: 8 }), async (req, res, next) => {
    if (!sameOriginRequest(req)) return res.status(403).send(layout('Érvénytelen kérés', '<h1>Érvénytelen kérés</h1><p>A bejelentkezési kérés nem erről az oldalról érkezett.</p>'));
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '').slice(0, PASSWORD_MAX_LENGTH + 1);
    try {
        const result = await pool.query(
            `SELECT a.uuid AS account_uuid, a.password_hash, a.password_version, a.must_change_password,
                    a.is_active AS account_active, d.is_active AS driver_active
             FROM driver_accounts a JOIN drivers d ON d.uuid = a.driver_uuid
             WHERE a.username_normalized = $1`,
            [username]
        );
        const account = result.rows[0];
        const passwordValid = await verifyPassword(account?.password_hash || DUMMY_PASSWORD_HASH, password);
        if (!account || !passwordValid || !account.account_active || !account.driver_active) {
            console.warn(`[DRIVER_WEB_AUTH] requestId=${req.requestId || 'unknown'} action=login result=denied`);
            return res.redirect(303, '/app/login?error=1');
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const session = await createDriverSession(client, account, req);
            await client.query('UPDATE driver_accounts SET last_login_at = $1, updated_at = $1 WHERE uuid = $2', [Date.now(), account.account_uuid]);
            await client.query('COMMIT');
            setDriverSessionCookie(res, session.token, session.csrfToken);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        console.log(`[DRIVER_WEB_AUTH] requestId=${req.requestId || 'unknown'} action=login result=ok`);
        return res.redirect(303, account.must_change_password ? '/app/change-password' : '/app');
    } catch (error) {
        next(error);
    }
});

router.get('/app/change-password', attachSession, requireSession, (req, res) => {
    const session = req.driverSession;
    res.send(layout('Jelszócsere', `
        <h1>Állíts be új jelszót</h1>
        <p>Az ideiglenes jelszót az első belépéskor le kell cserélni.</p>
        ${req.query.error ? '<div class="error" role="alert">A jelszó nem felel meg a követelményeknek, nem egyezik, vagy azonos az ideiglenes jelszóval.</div>' : ''}
        <form method="post" action="/app/change-password">
            <input type="hidden" name="_csrf" value="${escapeHtml(session.csrfToken || '')}">
            <label for="password">Új jelszó</label>
            <input id="password" name="password" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN_LENGTH}" maxlength="${PASSWORD_MAX_LENGTH}" required>
            <small>Legalább ${PASSWORD_MIN_LENGTH} karakter.</small>
            <label for="confirmation">Új jelszó még egyszer</label>
            <input id="confirmation" name="confirmation" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN_LENGTH}" maxlength="${PASSWORD_MAX_LENGTH}" required>
            <button type="submit">Jelszó mentése</button>
        </form>
    `));
});

router.post('/app/change-password', attachSession, requireSession, requireSessionCsrf, async (req, res, next) => {
    const password = String(req.body?.password || '');
    if (!validatePassword(password) || password !== String(req.body?.confirmation || '')) {
        return res.redirect(303, '/app/change-password?error=1');
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const locked = (await client.query('SELECT password_hash FROM driver_accounts WHERE uuid = $1 FOR UPDATE', [req.driverSession.account_uuid])).rows[0];
        if (!locked || await verifyPassword(locked.password_hash, password)) {
            await client.query('ROLLBACK');
            return res.redirect(303, '/app/change-password?error=1');
        }
        const passwordHash = await hashPassword(password);
        const now = Date.now();
        const account = (await client.query(
            `UPDATE driver_accounts
             SET password_hash = $1, must_change_password = FALSE, password_version = password_version + 1,
                 password_changed_at = $2, updated_at = $2
             WHERE uuid = $3
             RETURNING uuid AS account_uuid, password_version`,
            [passwordHash, now, req.driverSession.account_uuid]
        )).rows[0];
        await client.query("UPDATE driver_web_sessions SET revoked_at = $1, revoke_reason = 'password_changed' WHERE account_uuid = $2 AND revoked_at IS NULL", [now, account.account_uuid]);
        const session = await createDriverSession(client, account, req, now);
        await client.query('COMMIT');
        setDriverSessionCookie(res, session.token, session.csrfToken);
        console.log(`[DRIVER_WEB_AUTH] requestId=${req.requestId || 'unknown'} action=password_change result=ok`);
        return res.redirect(303, '/app');
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

router.get('/app', attachSession, requireSession, (req, res) => {
    if (req.driverSession.must_change_password) return res.redirect('/app/change-password');
    res.send(layout('Kezdőlap', `
        <h1>Szia, ${escapeHtml(req.driverSession.driver_name)}!</h1>
        <div class="notice">A sofőrfiókod aktív és biztonságosan be vagy jelentkezve.</div>
        <p>A túrák, rakományok és kézbesítési igazolások következő fejlesztési lépésekben érkeznek. Az AI funkciók későbbi, külön munkacsomagban maradnak.</p>
        <form method="post" action="/app/logout">
            <input type="hidden" name="_csrf" value="${escapeHtml(req.driverSession.csrfToken || '')}">
            <button class="secondary" type="submit">Kijelentkezés</button>
        </form>
    `));
});

router.post('/app/logout', attachSession, requireSession, requireSessionCsrf, async (req, res, next) => {
    try {
        await pool.query("UPDATE driver_web_sessions SET revoked_at = $1, revoke_reason = 'logout' WHERE uuid = $2 AND revoked_at IS NULL", [Date.now(), req.driverSession.session_uuid]);
        clearDriverSessionCookie(res);
        res.redirect(303, '/app/login');
    } catch (error) {
        next(error);
    }
});

module.exports = router;
module.exports.sameOriginRequest = sameOriginRequest;

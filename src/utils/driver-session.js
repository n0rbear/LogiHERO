const crypto = require('node:crypto');
const { IS_DEPLOYED } = require('../config/env');

const DRIVER_SESSION_COOKIE = 'driver_session';
const DRIVER_CSRF_COOKIE = 'driver_csrf';
const DRIVER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function randomToken() {
    return crypto.randomBytes(32).toString('base64url');
}

function hashToken(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function parseCookies(header) {
    if (!header) return {};
    return Object.fromEntries(header.split(';').map((part) => {
        const [name, ...rest] = part.trim().split('=');
        try {
            return [name, decodeURIComponent(rest.join('='))];
        } catch {
            return [name, ''];
        }
    }));
}

function cookieOptions() {
    return {
        httpOnly: true,
        secure: IS_DEPLOYED,
        sameSite: 'lax',
        path: '/',
        maxAge: DRIVER_SESSION_TTL_MS
    };
}

async function createDriverSession(client, account, req, now = Date.now()) {
    const token = randomToken();
    const csrfToken = randomToken();
    const expiresAt = now + DRIVER_SESSION_TTL_MS;
    const userAgent = String(req?.headers?.['user-agent'] || '').slice(0, 300) || null;
    await client.query(
        `INSERT INTO driver_web_sessions
            (account_uuid, token_hash, csrf_token_hash, password_version, created_at, last_seen_at, expires_at, user_agent)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7)`,
        [account.account_uuid || account.uuid, hashToken(token), hashToken(csrfToken), account.password_version, now, expiresAt, userAgent]
    );
    return { token, csrfToken, expiresAt };
}

async function loadDriverSession(db, req, now = Date.now()) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[DRIVER_SESSION_COOKIE];
    if (!token) return null;
    const result = await db.query(
        `SELECT s.uuid AS session_uuid, s.csrf_token_hash, s.expires_at,
                a.uuid AS account_uuid, a.driver_uuid, a.username, a.must_change_password,
                a.password_version, d.name AS driver_name, d.company_uuid
         FROM driver_web_sessions s
         JOIN driver_accounts a ON a.uuid = s.account_uuid
         JOIN drivers d ON d.uuid = a.driver_uuid
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2
           AND s.password_version = a.password_version
           AND a.is_active = TRUE AND d.is_active = TRUE`,
        [hashToken(token), now]
    );
    const session = result.rows[0] || null;
    if (!session) return null;
    await db.query('UPDATE driver_web_sessions SET last_seen_at = $1 WHERE uuid = $2', [now, session.session_uuid]);
    return { ...session, token, csrfToken: cookies[DRIVER_CSRF_COOKIE] || '' };
}

function setDriverSessionCookie(res, token, csrfToken) {
    res.cookie(DRIVER_SESSION_COOKIE, token, cookieOptions());
    res.cookie(DRIVER_CSRF_COOKIE, csrfToken, {
        secure: IS_DEPLOYED,
        sameSite: 'lax',
        path: '/app',
        maxAge: DRIVER_SESSION_TTL_MS
    });
}

function clearDriverSessionCookie(res) {
    res.clearCookie(DRIVER_SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
    res.clearCookie(DRIVER_CSRF_COOKIE, { secure: IS_DEPLOYED, sameSite: 'lax', path: '/app' });
}

function verifySessionCsrf(session, provided) {
    const expected = Buffer.from(String(session?.csrf_token_hash || ''), 'utf8');
    const actual = Buffer.from(hashToken(provided), 'utf8');
    return expected.length > 0 && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = {
    DRIVER_SESSION_COOKIE,
    DRIVER_CSRF_COOKIE,
    DRIVER_SESSION_TTL_MS,
    clearDriverSessionCookie,
    createDriverSession,
    hashToken,
    loadDriverSession,
    parseCookies,
    setDriverSessionCookie,
    verifySessionCsrf
};

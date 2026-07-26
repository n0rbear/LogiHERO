const crypto = require('node:crypto');

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();

function randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('base64url');
}

function pruneExpired(now = Date.now()) {
    for (const [id, session] of sessions.entries()) {
        if (session.expiresAt <= now) sessions.delete(id);
    }
}

function createAdminSession(now = Date.now()) {
    pruneExpired(now);
    const id = randomToken();
    const csrfToken = randomToken();
    const session = {
        id,
        csrfToken,
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS
    };
    sessions.set(id, session);
    return session;
}

function getAdminSession(id, now = Date.now()) {
    if (!id) return null;
    const session = sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= now) {
        sessions.delete(id);
        return null;
    }
    return session;
}

function destroyAdminSession(id) {
    if (id) sessions.delete(id);
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    if (left.length !== right.length || left.length === 0) return false;
    return crypto.timingSafeEqual(left, right);
}

function verifyAdminToken(provided, expected) {
    return safeEqual(provided, expected);
}

function verifyCsrfToken(session, provided) {
    return Boolean(session && safeEqual(provided, session.csrfToken));
}

function clearAllAdminSessions() {
    sessions.clear();
}

module.exports = {
    SESSION_TTL_MS,
    createAdminSession,
    getAdminSession,
    destroyAdminSession,
    verifyAdminToken,
    verifyCsrfToken,
    clearAllAdminSessions
};

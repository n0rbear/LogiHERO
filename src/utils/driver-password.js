const crypto = require('node:crypto');
const argon2 = require('argon2');

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 256;
const ARGON2_OPTIONS = Object.freeze({
    type: argon2.argon2id,
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1
});

function normalizeUsername(value) {
    return String(value || '').trim().toLowerCase();
}

function validateUsername(value) {
    const normalized = normalizeUsername(value);
    return USERNAME_RE.test(normalized) ? normalized : null;
}

function validatePassword(value) {
    const password = String(value || '');
    return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

function hashPassword(password) {
    if (!validatePassword(password)) throw new Error('PASSWORD_POLICY');
    return argon2.hash(password, ARGON2_OPTIONS);
}

async function verifyPassword(hash, password) {
    if (!hash || typeof hash !== 'string') return false;
    try {
        return await argon2.verify(hash, String(password || ''));
    } catch {
        return false;
    }
}

function generateTemporaryPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    const bytes = crypto.randomBytes(20);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

module.exports = {
    ARGON2_OPTIONS,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    generateTemporaryPassword,
    hashPassword,
    normalizeUsername,
    validatePassword,
    validateUsername,
    verifyPassword
};

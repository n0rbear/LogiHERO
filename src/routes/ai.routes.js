const express = require('express');
const { requireDeviceAuth } = require('../middleware/requireDeviceAuth');
const {
    MISTRAL_API_KEY,
    MISTRAL_API_URL,
    AI_RATE_LIMIT_BURST_WINDOW_MS,
    AI_RATE_LIMIT_BURST_MAX,
    AI_RATE_LIMIT_DRIVER_WINDOW_MS,
    AI_RATE_LIMIT_DRIVER_MAX,
    AI_RATE_LIMIT_COMPANY_WINDOW_MS,
    AI_RATE_LIMIT_COMPANY_MAX
} = require('../config/env');

const aiRoutes = express.Router();
const ALLOWED_MODELS = new Set(['mistral-tiny', 'mistral-small-latest']);
const MAX_MESSAGES = 8;
const MAX_CONTENT_CHARS = 30_000;
const UPSTREAM_TIMEOUT_MS = 20_000;
const rateBuckets = new Map();
const RATE_LIMITS = [
    { name: 'burst', windowMs: AI_RATE_LIMIT_BURST_WINDOW_MS, max: AI_RATE_LIMIT_BURST_MAX, key: (auth) => `device:${auth.deviceId}:driver:${auth.driverUuid}` },
    { name: 'driver', windowMs: AI_RATE_LIMIT_DRIVER_WINDOW_MS, max: AI_RATE_LIMIT_DRIVER_MAX, key: (auth) => `driver:${auth.driverUuid}` },
    { name: 'company', windowMs: AI_RATE_LIMIT_COMPANY_WINDOW_MS, max: AI_RATE_LIMIT_COMPANY_MAX, key: (auth) => `company:${auth.companyUuid || 'none'}` }
];

function normalizeMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return null;
    const normalized = [];
    for (const message of messages) {
        const role = String(message?.role || '').trim();
        const content = String(message?.content || '').trim();
        if (!['system', 'user', 'assistant'].includes(role) || !content || content.length > MAX_CONTENT_CHARS) return null;
        normalized.push({ role, content });
    }
    return normalized;
}

function normalizeModel(value) {
    const model = String(value || 'mistral-tiny').trim();
    return ALLOWED_MODELS.has(model) ? model : 'mistral-tiny';
}

function normalizeTemperature(value) {
    const temperature = Number(value ?? 0.7);
    if (!Number.isFinite(temperature)) return 0.7;
    return Math.min(Math.max(temperature, 0), 1);
}

function pruneExpiredBuckets(now) {
    if (rateBuckets.size < 500) return;
    for (const [key, bucket] of rateBuckets.entries()) {
        if (bucket.resetAt <= now) rateBuckets.delete(key);
    }
}

function checkAiRateLimit(auth, now = Date.now()) {
    pruneExpiredBuckets(now);
    const updates = [];
    for (const limit of RATE_LIMITS) {
        const key = `ai:${limit.name}:${limit.key(auth)}`;
        const current = rateBuckets.get(key);
        const bucket = current && current.resetAt > now
            ? current
            : { count: 0, resetAt: now + limit.windowMs };
        if (bucket.count + 1 > limit.max) {
            return {
                limited: true,
                limiter: limit.name,
                retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
            };
        }
        updates.push({ key, bucket: { count: bucket.count + 1, resetAt: bucket.resetAt } });
    }
    for (const update of updates) rateBuckets.set(update.key, update.bucket);
    return { limited: false };
}

function clearAiRateLimits() {
    rateBuckets.clear();
}

aiRoutes.post('/api/ai/chat', requireDeviceAuth, async (req, res, next) => {
    try {
        const rateLimit = checkAiRateLimit(req.deviceAuth);
        if (rateLimit.limited) {
            res.setHeader('Retry-After', String(rateLimit.retryAfter));
            console.warn(`[AI_RATE_LIMIT] requestId=${req.requestId || 'unknown'} driver=${req.deviceAuth.driverUuid} company=${req.deviceAuth.companyUuid || 'none'} limiter=${rateLimit.limiter} result=429`);
            return res.status(429).json({ error: 'AI_RATE_LIMITED', retryAfter: rateLimit.retryAfter });
        }

        if (!MISTRAL_API_KEY) return res.status(503).json({ error: 'AI_PROVIDER_UNAVAILABLE' });

        const messages = normalizeMessages(req.body?.messages);
        if (!messages) return res.status(400).json({ error: 'INVALID_AI_REQUEST' });

        const upstreamResponse = await fetch(MISTRAL_API_URL, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${MISTRAL_API_KEY}`,
                'content-type': 'application/json',
                accept: 'application/json'
            },
            body: JSON.stringify({
                model: normalizeModel(req.body?.model),
                messages,
                temperature: normalizeTemperature(req.body?.temperature)
            }),
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
        });

        if (!upstreamResponse.ok) {
            console.warn(`[AI] requestId=${req.requestId || 'unknown'} driver=${req.deviceAuth.driverUuid} upstream_status=${upstreamResponse.status}`);
            return res.status(502).json({ error: 'AI_PROVIDER_ERROR' });
        }

        const payload = await upstreamResponse.json();
        const content = String(payload?.choices?.[0]?.message?.content || '');
        return res.json({ content });
    } catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            return res.status(504).json({ error: 'AI_PROVIDER_TIMEOUT' });
        }
        return next(error);
    }
});

module.exports = aiRoutes;
module.exports.clearAiRateLimits = clearAiRateLimits;
module.exports.checkAiRateLimit = checkAiRateLimit;

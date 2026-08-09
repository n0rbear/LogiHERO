const express = require('express');
const { requireDeviceAuth } = require('../middleware/requireDeviceAuth');
const { MISTRAL_API_KEY, MISTRAL_API_URL } = require('../config/env');

const aiRoutes = express.Router();
const ALLOWED_MODELS = new Set(['mistral-tiny', 'mistral-small-latest']);
const MAX_MESSAGES = 8;
const MAX_CONTENT_CHARS = 30_000;
const UPSTREAM_TIMEOUT_MS = 20_000;

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

aiRoutes.post('/api/ai/chat', requireDeviceAuth, async (req, res, next) => {
    try {
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

const crypto = require('crypto');
const { NDP_PROJECT_ID, NDP_APP_NAME, NDP_ENVIRONMENT } = require('../config/env');

const endpoint = process.env.NDP_INGEST_ENDPOINT || '';
const ingestKey = process.env.NDP_INGEST_KEY || '';

function isEnabled() {
    return Boolean(endpoint && ingestKey && NDP_PROJECT_ID && typeof fetch === 'function');
}

function getTraceId(req) {
    const header = req.get('X-NDP-Trace-Id');
    return header && header.trim() ? header.trim() : crypto.randomUUID();
}

function basePayload(component, payload) {
    return {
        project: NDP_APP_NAME,
        projectId: NDP_PROJECT_ID,
        environment: NDP_ENVIRONMENT,
        component,
        ...payload
    };
}

async function trackEvent({ traceId, eventType, source = 'BACKEND', severity = 'INFO', title, component = 'backend', payload = {} }) {
    if (!isEnabled()) return;

    try {
        await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-NDP-Project-Id': NDP_PROJECT_ID,
                'X-NDP-Ingest-Key': ingestKey
            },
            body: JSON.stringify({
                projectId: NDP_PROJECT_ID,
                traceId,
                eventType,
                source,
                severity,
                title,
                payload: basePayload(component, payload),
                timestamp: new Date().toISOString()
            })
        });
    } catch (_error) {
        // Diagnostics must never block LogiHERO business behavior.
    }
}

module.exports = {
    getTraceId,
    trackEvent
};

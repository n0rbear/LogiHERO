const crypto = require('crypto');
const {
    APP_COMMIT_SHA,
    APP_VERSION,
    NDP_APP_NAME,
    NDP_BUILD_ORIGIN,
    NDP_DEPLOY_ID,
    NDP_ENVIRONMENT,
    NDP_INGEST_ENDPOINT,
    NDP_PROJECT_ID,
    NDP_SERVICE_ID,
    NDP_SERVICE_NAME
} = require('../config/env');

const ingestKey = process.env.NDP_INGEST_KEY || process.env.ingestKey || '';

function isEnabled() {
    return Boolean(NDP_INGEST_ENDPOINT && ingestKey && NDP_PROJECT_ID && typeof fetch === 'function');
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

function runtimeVersion() {
    const metadata = {
        appVersion: APP_VERSION || undefined,
        commitSha: APP_COMMIT_SHA !== 'unknown' ? APP_COMMIT_SHA : undefined,
        deployId: NDP_DEPLOY_ID || undefined,
        serviceName: NDP_SERVICE_NAME || undefined,
        serviceId: NDP_SERVICE_ID || undefined,
        environment: NDP_ENVIRONMENT || undefined,
        provider: NDP_DEPLOY_ID || NDP_SERVICE_ID ? 'render' : undefined,
        buildOrigin: NDP_BUILD_ORIGIN || undefined
    };
    return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value));
}

async function trackEvent({ traceId, eventType, source = 'BACKEND', severity = 'INFO', title, component = 'backend', payload = {} }) {
    if (!isEnabled()) return;

    try {
        await fetch(NDP_INGEST_ENDPOINT, {
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
                runtimeVersion: runtimeVersion(),
                timestamp: new Date().toISOString()
            })
        });
    } catch (_error) {
        // Diagnostics must never block LogiHERO business behavior.
    }
}

module.exports = {
    getTraceId,
    isEnabled,
    trackEvent
};

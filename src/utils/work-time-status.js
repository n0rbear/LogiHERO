const WORK_TIME_STATUSES = Object.freeze({
    WORK: {
        value: 'WORK',
        label: 'Munka',
        badgeClass: 'badge-working',
        active: true,
        countsAsWork: true,
        countsAsDriving: false,
        transitions: ['DRIVING', 'BREAK', 'REST', 'AVAILABILITY', 'OFFLINE']
    },
    DRIVING: {
        value: 'DRIVING',
        label: 'Vezetes',
        badgeClass: 'badge-driving',
        active: true,
        countsAsWork: true,
        countsAsDriving: true,
        transitions: ['WORK', 'BREAK', 'REST', 'AVAILABILITY', 'OFFLINE']
    },
    BREAK: {
        value: 'BREAK',
        label: 'Szunet',
        badgeClass: 'badge-resting',
        active: true,
        countsAsWork: false,
        countsAsDriving: false,
        transitions: ['WORK', 'DRIVING', 'REST', 'AVAILABILITY', 'OFFLINE']
    },
    REST: {
        value: 'REST',
        label: 'Piheno',
        badgeClass: 'badge-resting',
        active: true,
        countsAsWork: false,
        countsAsDriving: false,
        transitions: ['WORK', 'DRIVING', 'BREAK', 'AVAILABILITY', 'OFFLINE']
    },
    AVAILABILITY: {
        value: 'AVAILABILITY',
        label: 'Rendelkezesre allas',
        badgeClass: 'badge-availability',
        active: true,
        countsAsWork: false,
        countsAsDriving: false,
        transitions: ['WORK', 'DRIVING', 'BREAK', 'REST', 'OFFLINE']
    },
    OFFLINE: {
        value: 'OFFLINE',
        label: 'Offline',
        badgeClass: 'badge-offline',
        active: false,
        countsAsWork: false,
        countsAsDriving: false,
        transitions: ['WORK', 'DRIVING', 'BREAK', 'REST', 'AVAILABILITY']
    }
});

const APPROVAL_STATUSES = Object.freeze(['PENDING', 'APPROVED', 'REJECTED', 'CORRECTION_REQUIRED']);

const LEGACY_STATUS_MAP = Object.freeze({
    'Munka': 'WORK',
    'Rakodas': 'WORK',
    'Rakodás': 'WORK',
    'Vezetes': 'DRIVING',
    'Vezetés': 'DRIVING',
    'Piheno': 'REST',
    'Pihenő': 'REST',
    'Szunet': 'BREAK',
    'Szünet': 'BREAK',
    'Rendelkezesre allas': 'AVAILABILITY',
    'Offline': 'OFFLINE'
});

function normalizeWorkStatus(value) {
    const raw = String(value || '').trim();
    const upper = raw.toUpperCase();
    if (WORK_TIME_STATUSES[upper]) return upper;
    return LEGACY_STATUS_MAP[raw] || null;
}

function assertTransition(fromStatus, toStatus) {
    const to = normalizeWorkStatus(toStatus);
    if (!to) return { ok: false, error: 'Invalid work time status.' };
    const from = normalizeWorkStatus(fromStatus);
    if (!from || WORK_TIME_STATUSES[from].transitions.includes(to) || from === to) return { ok: true, to };
    return { ok: false, error: `Transition ${from} -> ${to} is not allowed.` };
}

function durationMs(start, end) {
    const s = Number(start);
    const e = Number(end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
    return e - s;
}

function summarizeEntries(entries, now = Date.now()) {
    const summary = {
        totalMs: 0,
        drivingMs: 0,
        workMs: 0,
        breakMs: 0,
        restMs: 0,
        availabilityMs: 0,
        manualCorrections: 0,
        hasOpenEntry: false,
        anomalies: []
    };
    const sorted = [...entries].sort((a, b) => Number(a.start_time || 0) - Number(b.start_time || 0));
    let previousEnd = null;
    for (const entry of sorted) {
        const status = normalizeWorkStatus(entry.status || entry.type) || 'WORK';
        const end = entry.end_time || now;
        const ms = durationMs(entry.start_time, end);
        if (entry.end_time == null) summary.hasOpenEntry = true;
        if (ms == null || ms <= 0) {
            summary.anomalies.push('INVALID_DURATION');
            continue;
        }
        if (previousEnd != null && Number(entry.start_time) < previousEnd) summary.anomalies.push('OVERLAP');
        if (ms > 14 * 60 * 60 * 1000) summary.anomalies.push('LONG_SEGMENT');
        if (Number(entry.start_time) > now + 5 * 60 * 1000) summary.anomalies.push('FUTURE_TIME');
        if (entry.manual_edit) summary.manualCorrections += 1;
        if (WORK_TIME_STATUSES[status].active) summary.totalMs += ms;
        if (WORK_TIME_STATUSES[status].countsAsDriving) summary.drivingMs += ms;
        if (status === 'WORK') summary.workMs += ms;
        if (status === 'BREAK') summary.breakMs += ms;
        if (status === 'REST') summary.restMs += ms;
        if (status === 'AVAILABILITY') summary.availabilityMs += ms;
        previousEnd = Number(end);
    }
    summary.anomalies = [...new Set(summary.anomalies)];
    return summary;
}

module.exports = {
    WORK_TIME_STATUSES,
    APPROVAL_STATUSES,
    normalizeWorkStatus,
    assertTransition,
    durationMs,
    summarizeEntries
};

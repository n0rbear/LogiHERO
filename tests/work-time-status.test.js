const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeWorkStatus,
    assertTransition,
    summarizeEntries
} = require('../src/utils/work-time-status');

test('work time status model normalizes legacy and technical values', () => {
    assert.equal(normalizeWorkStatus('Vezetés'), 'DRIVING');
    assert.equal(normalizeWorkStatus('BREAK'), 'BREAK');
    assert.equal(normalizeWorkStatus('Rendelkezesre allas'), 'AVAILABILITY');
});

test('work time transition model allows operational transitions and rejects invalid values', () => {
    assert.equal(assertTransition('WORK', 'DRIVING').ok, true);
    assert.equal(assertTransition('WORK', 'NOT_REAL').ok, false);
});

test('work time summary calculates daily totals and DST-safe UTC durations', () => {
    const start = Date.parse('2026-10-25T00:30:00.000Z');
    const end = Date.parse('2026-10-25T03:30:00.000Z');
    const summary = summarizeEntries([
        { status: 'DRIVING', start_time: start, end_time: end },
        { status: 'BREAK', start_time: end, end_time: end + 30 * 60000, manual_edit: true }
    ], end + 30 * 60000);
    assert.equal(summary.drivingMs, 3 * 60 * 60 * 1000);
    assert.equal(summary.breakMs, 30 * 60 * 1000);
    assert.equal(summary.manualCorrections, 1);
    assert.deepEqual(summary.anomalies, []);
});

test('work time summary flags overlap, future and invalid durations', () => {
    const now = Date.parse('2026-01-01T12:00:00.000Z');
    const summary = summarizeEntries([
        { status: 'WORK', start_time: now, end_time: now + 1000 },
        { status: 'DRIVING', start_time: now + 500, end_time: now + 2000 },
        { status: 'REST', start_time: now + 3000, end_time: now + 2000 },
        { status: 'BREAK', start_time: now + 10 * 60000, end_time: now + 11 * 60000 }
    ], now);
    assert.ok(summary.anomalies.includes('OVERLAP'));
    assert.ok(summary.anomalies.includes('INVALID_DURATION'));
    assert.ok(summary.anomalies.includes('FUTURE_TIME'));
});

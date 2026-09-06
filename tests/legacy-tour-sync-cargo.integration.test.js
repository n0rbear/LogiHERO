// PostgreSQL-backed coverage for the composition attack: a mobile payload that forges cargo
// lifecycle state in order to satisfy the stop-completion cargo check in the same sync.
// The mocked suites pin the logic; this one proves it against the real schema and real SQL.
const test = require('node:test');
const assert = require('node:assert');
const pool = require('../src/database/pool');
const ImportEngine = require('../src/engines/import-engine');

const DRIVER = 'TD009 Integration Driver';

async function seed(client) {
    const tour = await client.query(
        "INSERT INTO tours (name, driver_name, updated_at) VALUES ('TD009 Tour', $1, 100) RETURNING id, uuid",
        [DRIVER]
    );
    const stop = await client.query(
        `INSERT INTO stops (tour_id, address, order_index, stop_status, is_completed, updated_at)
         VALUES ($1, 'TD009 Stop', 0, 'PENDING', false, 100) RETURNING id, uuid`,
        [tour.rows[0].id]
    );
    const cargo = await client.query(
        `INSERT INTO cargo (tour_id, pickup_stop_id, name, status, updated_at)
         VALUES ($1, $2, 'TD009 Cargo', 'READY_FOR_PICKUP', 100) RETURNING id, uuid`,
        [tour.rows[0].id, stop.rows[0].id]
    );
    return { tour: tour.rows[0], stop: stop.rows[0], cargo: cargo.rows[0] };
}

function payload(fixture, cargoStatus) {
    return {
        tour: { uuid: fixture.tour.uuid, name: 'TD009 Tour', updated_at: 200 },
        stops: [{
            uuid: fixture.stop.uuid,
            address: 'TD009 Stop',
            order_index: 0,
            stop_status: 'COMPLETED',
            is_completed: true,
            updated_at: 200
        }],
        cargo: [{ uuid: fixture.cargo.uuid, name: 'TD009 Cargo', status: cargoStatus, updated_at: 300 }]
    };
}

async function readState(client, fixture) {
    const stop = await client.query('SELECT stop_status, is_completed FROM stops WHERE id = $1', [fixture.stop.id]);
    const cargo = await client.query('SELECT status FROM cargo WHERE id = $1', [fixture.cargo.id]);
    return { stop: stop.rows[0], cargo: cargo.rows[0] };
}

test('TD-009 cargo authority against real PostgreSQL', async (t) => {
    try {
        await pool.query('SELECT 1');
    } catch (e) {
        t.skip(`Local PostgreSQL unavailable: ${e.code || e.message}`);
        return;
    }

    await t.test('forged cargo state cannot unlock the stop', async () => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const fixture = await seed(client);
            const body = payload(fixture, 'DELIVERED'); // illegal READY_FOR_PICKUP -> DELIVERED
            await ImportEngine.processTour(client, DRIVER, body.tour, body.stops, { source: 'mobile', cargo: body.cargo });

            const state = await readState(client, fixture);
            assert.strictEqual(state.cargo.status, 'READY_FOR_PICKUP', 'illegal transition must be refused');
            assert.strictEqual(state.stop.is_completed, false, 'stop must remain blocked by the pending pickup');
            assert.notStrictEqual(state.stop.stop_status, 'COMPLETED');
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });

    await t.test('legitimate offline pickup is applied and unblocks the stop', async () => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const fixture = await seed(client);
            const body = payload(fixture, 'PICKED_UP'); // legal driver transition
            await ImportEngine.processTour(client, DRIVER, body.tour, body.stops, { source: 'mobile', cargo: body.cargo });

            const state = await readState(client, fixture);
            assert.strictEqual(state.cargo.status, 'PICKED_UP', 'legal offline transition must be accepted');
            assert.strictEqual(state.stop.is_completed, true, 'stop completes once its pickup is genuinely done');
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });

    await t.test('accepted offline transition leaves an audit row', async () => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const fixture = await seed(client);
            const body = payload(fixture, 'PICKED_UP');
            await ImportEngine.processTour(client, DRIVER, body.tour, body.stops, { source: 'mobile', cargo: body.cargo });

            const events = await client.query(
                'SELECT event_type, from_status, to_status, actor_type FROM cargo_events WHERE cargo_id = $1',
                [fixture.cargo.id]
            );
            assert.strictEqual(events.rowCount, 1, 'an offline transition must still be auditable');
            assert.strictEqual(events.rows[0].to_status, 'PICKED_UP');
            assert.strictEqual(events.rows[0].actor_type, 'DRIVER');
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });
});

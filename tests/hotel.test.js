const test = require('node:test');
const assert = require('node:assert');
const pool = require('../src/database/pool');
const HotelEngine = require('../src/engines/hotel-engine');

test('Hotel Core - Status transitions and idempotency', async (t) => {
    // Setup: Create a test tour and hotel
    const tourRes = await pool.query("INSERT INTO tours (name, driver_name) VALUES ('Test Tour', 'Test Driver') RETURNING id");
    const tourId = tourRes.rows[0].id;

    const hotelRes = await pool.query(
        "INSERT INTO hotels (tour_id, name, driver_name, status) VALUES ($1, 'Test Hotel', 'Test Driver', 'PLANNED') RETURNING id",
        [tourId]
    );
    const hotelId = hotelRes.rows[0].id;

    await t.test('Should transition from PLANNED to CHECKED_IN', async () => {
        const updated = await HotelEngine.transitionHotelStatus(pool, hotelId, 'CHECKED_IN', {
            actorType: 'DRIVER',
            actorId: 'Test Driver',
            clientEventId: 'event-1'
        });
        assert.strictEqual(updated.status, 'CHECKED_IN');
    });

    await t.test('Idempotency: Same event ID should not create double logs', async () => {
        // This is handled by logHotelEvent ON CONFLICT DO NOTHING
        await HotelEngine.transitionHotelStatus(pool, hotelId, 'CHECKED_IN', {
            actorType: 'DRIVER',
            actorId: 'Test Driver',
            clientEventId: 'event-1'
        });
        const events = await pool.query('SELECT * FROM hotel_events WHERE client_event_id = $1', ['event-1']);
        assert.strictEqual(events.rowCount, 1);
    });

    await t.test('Terminal state protection: Cannot transition from CHECKED_OUT', async () => {
        await pool.query("UPDATE hotels SET status = 'CHECKED_OUT' WHERE id = $1", [hotelId]);

        try {
            await HotelEngine.transitionHotelStatus(pool, hotelId, 'PROBLEM', {
                actorType: 'DRIVER',
                actorId: 'Test Driver'
            });
            assert.fail('Should have thrown error');
        } catch (e) {
            assert.strictEqual(e.message, 'CANNOT_TRANSITION_FROM_TERMINAL_STATE');
        }
    });

    await t.test('Admin override: Should allow transition from terminal state with reason', async () => {
        const updated = await HotelEngine.transitionHotelStatus(pool, hotelId, 'PROBLEM', {
            actorType: 'ADMIN',
            actorId: 'admin@logihero.com',
            isOverride: true,
            reason: 'Correction'
        });
        assert.strictEqual(updated.status, 'PROBLEM');
    });

    await t.test('Tour completion blocking: CHECKED_IN hotel should block tour', async () => {
        await pool.query("UPDATE hotels SET status = 'CHECKED_IN' WHERE id = $1", [hotelId]);
        const { blocking } = await HotelEngine.checkTourCompletionBlockedByHotels(pool, tourId);
        assert.ok(blocking.some(b => b.reason === 'CHECKED_IN_WITHOUT_CHECK_OUT'));
    });

    // Cleanup
    await pool.query('DELETE FROM hotel_events WHERE hotel_id = $1', [hotelId]);
    await pool.query('DELETE FROM hotels WHERE id = $1', [hotelId]);
    await pool.query('DELETE FROM tours WHERE id = $1', [tourId]);
});

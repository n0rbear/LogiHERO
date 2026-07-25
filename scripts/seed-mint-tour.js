const pool = require('../src/database/pool');

async function seed() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const now = Date.now();
        const companySlug = 'logihero-mint';

        console.log('Seeding company...');
        const companyRow = (await client.query(
            `INSERT INTO companies (name, slug, is_demo)
             VALUES ('LogiHERO Mint', $1, true)
             ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
             RETURNING uuid`, [companySlug])).rows[0];

        const driverName = 'Mint Driver';
        console.log('Seeding driver...');
        const driverRow = (await client.query(
            `INSERT INTO drivers (company_uuid, name, email, phone, license_plate, is_active, activation_code)
             VALUES ($1, $2, 'mint@logihero.test', '+36201234567', 'MINT-001', true, 'MINT001')
             ON CONFLICT (name) DO UPDATE SET company_uuid = EXCLUDED.company_uuid, license_plate = EXCLUDED.license_plate
             RETURNING uuid`, [companyRow.uuid, driverName])).rows[0];

        console.log('Seeding tour...');
        const tourRow = (await client.query(
            `INSERT INTO tours (company_uuid, driver_uuid, driver_name, name, customer, date, notes, is_closed, is_current, updated_at,
                               depot_name, depot_lat, depot_lng, return_depot_name, return_depot_lat, return_depot_lng, tour_status)
             VALUES ($1, $2, $3, 'Sprint 1.1 Mint Tour', 'LogiHERO Demo', $4, 'Stabilization test tour', false, true, $4,
                     'Budapest Depot', 47.4816, 19.1128, 'Budapest Depot', 47.4816, 19.1128, 'IN_PROGRESS')
             RETURNING id, uuid`, [companyRow.uuid, driverRow.uuid, driverName, now])).rows[0];

        const stops = [
            { recipient: 'Váci út Office', address: 'Budapest, Váci út 178', lat: 47.5528, lng: 19.0768, order: 0, status: 'COMPLETED', done: true },
            { recipient: 'Bazilika Checkpoint', address: 'Budapest, Szent István tér 1', lat: 47.5008, lng: 19.0539, order: 1, status: 'PENDING', done: false },
            { recipient: 'Allee Mall', address: 'Budapest, Október huszonharmadika u. 8-10', lat: 47.4768, lng: 19.0485, order: 2, status: 'PENDING', done: false },
            { recipient: 'Corvin Plaza', address: 'Budapest, Üllői út 26', lat: 47.4858, lng: 19.0705, order: 3, status: 'PENDING', done: false },
            { recipient: 'Invalid Stop', address: 'Nowhere', lat: 0, lng: 0, order: 4, status: 'PENDING', done: false }
        ];

        console.log('Seeding stops...');
        for (const s of stops) {
            await client.query(
                `INSERT INTO stops (company_uuid, driver_uuid, tour_id, recipient, address_full, order_index, latitude, longitude, is_completed, stop_status, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [companyRow.uuid, driverRow.uuid, tourRow.id, s.recipient, s.address, s.order, s.lat, s.lng, s.done, s.status, now]
            );
        }

        await client.query('COMMIT');
        console.log('Successfully seeded mint tour:', tourRow.uuid);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Seed failed:', e.message);
    } finally {
        client.release();
        process.exit();
    }
}

seed();

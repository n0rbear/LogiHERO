process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://logihero_dev:logihero_dev_password@127.0.0.1:5432/logihero_dev';

const initDb = require('../src/database/init');
const pool = require('../src/database/pool');
const crypto = require('node:crypto');

const LOCAL_DATABASE_RE = /@(localhost|127\.0\.0\.1|host\.docker\.internal):|\/\/[^@/]+@postgres:/i;

function assertSafeSeedTarget() {
    const env = process.env.NODE_ENV || 'development';
    const url = process.env.DATABASE_URL || '';
    if (env === 'production' || process.env.RENDER || process.env.RENDER_SERVICE_ID) {
        throw new Error('Refusing to seed a production/deployed environment.');
    }
    if (!url || !LOCAL_DATABASE_RE.test(url)) {
        throw new Error('Refusing to seed: DATABASE_URL must point to a local PostgreSQL database.');
    }
}

async function upsertCompany(client) {
    const result = await client.query(`
        INSERT INTO companies (name, slug, is_demo)
        VALUES ('LogiHERO Dev Company', 'logihero-dev-company', true)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, is_demo = true
        RETURNING uuid
    `);
    return result.rows[0].uuid;
}

async function upsertDrivers(client, companyUuid) {
    const now = Date.now();
    const drivers = [
        ['LogiHERO Dev Driver Active', 'active.driver@example.test', '+36 30 111 1111', '@logihero_active', 'DEV-101', true, 'DEV-ACT1'],
        ['LogiHERO Dev Driver Inactive', 'inactive.driver@example.test', '+36 30 222 2222', '@logihero_inactive', 'DEV-202', false, 'DEV-INAC'],
        ['=LogiHERO CSV Injection Driver', 'csv.driver@example.test', '+36 30 333 3333', '@logihero_csv', 'DEV-303', true, 'DEV-CSV1']
    ];
    const rows = [];
    for (const [name, email, phone, telegram, plate, active, code] of drivers) {
        const result = await client.query(`
            INSERT INTO drivers (company_uuid, name, email, phone, whatsapp, telegram, license_plate, is_active, activation_code, profile_updated_at)
            VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (name) DO UPDATE SET
                company_uuid = EXCLUDED.company_uuid,
                email = EXCLUDED.email,
                phone = EXCLUDED.phone,
                whatsapp = EXCLUDED.whatsapp,
                telegram = EXCLUDED.telegram,
                license_plate = EXCLUDED.license_plate,
                is_active = EXCLUDED.is_active,
                activation_code = EXCLUDED.activation_code,
                profile_updated_at = EXCLUDED.profile_updated_at
            RETURNING uuid, company_uuid, name
        `, [companyUuid, name, email, phone, telegram, plate, active, code, now]);
        rows.push(result.rows[0]);
    }
    return rows;
}

async function upsertTours(client, companyUuid, driver) {
    const now = Date.now();
    const tourData = [
        ['10000000-0000-4000-8000-000000000001', 'LogiHERO Dev Budapest Route', 'IN_PROGRESS', true, now],
        ['10000000-0000-4000-8000-000000000002', 'LogiHERO Dev Vienna Route', 'PLANNED', false, now + 86400000],
        ['10000000-0000-4000-8000-000000000003', 'LogiHERO Dev Completed Route', 'COMPLETED', false, now - 86400000]
    ];
    const tours = [];
    for (const [uuid, name, status, current, date] of tourData) {
        const result = await client.query(`
            INSERT INTO tours (uuid, company_uuid, driver_uuid, driver_name, name, customer, date, notes, is_closed, is_current,
                depot_name, depot_address_full, depot_lat, depot_lng, tour_status, route_status, planned_distance_km, planned_duration_seconds, updated_at)
            VALUES ($1, $2, $3, $4, $5, 'Dev Customer', $6, 'Seeded local development tour', $7, $8,
                'LogiHERO Depot', 'Budapest, Hungary', 47.4979, 19.0402, $9, 'CALCULATED', 248.5, 12600, $10)
            ON CONFLICT (uuid) DO UPDATE SET
                company_uuid = EXCLUDED.company_uuid,
                driver_uuid = EXCLUDED.driver_uuid,
                driver_name = EXCLUDED.driver_name,
                name = EXCLUDED.name,
                customer = EXCLUDED.customer,
                date = EXCLUDED.date,
                is_closed = EXCLUDED.is_closed,
                is_current = EXCLUDED.is_current,
                tour_status = EXCLUDED.tour_status,
                route_status = EXCLUDED.route_status,
                planned_distance_km = EXCLUDED.planned_distance_km,
                planned_duration_seconds = EXCLUDED.planned_duration_seconds,
                updated_at = EXCLUDED.updated_at
            RETURNING id, uuid, name
        `, [uuid, companyUuid, driver.uuid, driver.name, name, date, status === 'COMPLETED', current, status, now]);
        tours.push(result.rows[0]);
    }
    return tours;
}

async function upsertStopsCargoHotels(client, companyUuid, driver, tour) {
    const now = Date.now();
    const stops = [
        ['20000000-0000-4000-8000-000000000001', 'PICKUP', 'Budapest Pickup', 'Budapest, Andrassy ut 1', 'Budapest', 'Hungary', 47.503, 19.058, 1, 'COMPLETED'],
        ['20000000-0000-4000-8000-000000000002', 'HOTEL', 'Hotel Dev Coordinate', 'Budapest, Rakoczi ut 10', 'Budapest', 'Hungary', 47.497, 19.070, 2, 'CONFIRMED'],
        ['20000000-0000-4000-8000-000000000003', 'DELIVERY', 'Vienna Delivery', 'Vienna, Ringstrasse 1', 'Vienna', 'Austria', 48.208, 16.373, 3, 'PENDING']
    ];
    for (const row of stops) {
        await client.query(`
            INSERT INTO stops (uuid, company_uuid, driver_uuid, tour_id, recipient, address, address_full, city, country, order_index,
                latitude, longitude, stop_type, stop_status, notes, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13, 'Seeded local stop', $14)
            ON CONFLICT (uuid) DO UPDATE SET
                company_uuid = EXCLUDED.company_uuid,
                driver_uuid = EXCLUDED.driver_uuid,
                tour_id = EXCLUDED.tour_id,
                recipient = EXCLUDED.recipient,
                address = EXCLUDED.address,
                address_full = EXCLUDED.address_full,
                city = EXCLUDED.city,
                country = EXCLUDED.country,
                order_index = EXCLUDED.order_index,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                stop_type = EXCLUDED.stop_type,
                stop_status = EXCLUDED.stop_status,
                notes = EXCLUDED.notes,
                updated_at = EXCLUDED.updated_at
        `, [row[0], companyUuid, driver.uuid, tour.id, row[2], row[3], row[4], row[5], row[8], row[6], row[7], row[1], row[9], now]);
    }

    await client.query(`
        INSERT INTO cargo (uuid, company_uuid, driver_uuid, tour_id, name, description, quantity, unit, serial_number, status, driver_name, updated_at)
        VALUES ('30000000-0000-4000-8000-000000000001', $1, $2, $3, 'Dev Pallet', 'Seeded cargo for E2E route checks', 2, 'pcs', 'DEV-CARGO-1', 'PLANNED', $4, $5)
        ON CONFLICT (uuid) DO UPDATE SET
            company_uuid = EXCLUDED.company_uuid,
            driver_uuid = EXCLUDED.driver_uuid,
            tour_id = EXCLUDED.tour_id,
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            quantity = EXCLUDED.quantity,
            status = EXCLUDED.status,
            driver_name = EXCLUDED.driver_name,
            updated_at = EXCLUDED.updated_at
    `, [companyUuid, driver.uuid, tour.id, driver.name, now]);

    const hotels = [
        ['40000000-0000-4000-8000-000000000001', 'LogiHERO Dev Hotel With Map', 'Budapest, Rakoczi ut 10', 'Budapest', 'Hungary', 47.497, 19.070, 'CONFIRMED'],
        ['40000000-0000-4000-8000-000000000002', 'LogiHERO Dev Hotel No Coordinates', 'Vienna Test Street 5', 'Vienna', 'Austria', null, null, 'BOOKED']
    ];
    for (const hotel of hotels) {
        await client.query(`
            INSERT INTO hotels (uuid, company_uuid, tour_id, driver_uuid, driver_name, name, address, address_line_1, city, country,
                latitude, longitude, phone, email, booking_number, status, notes, check_in_date, check_out_date, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, '+36 1 555 0000', 'hotel@example.test',
                'DEV-HOTEL', $12, 'Seeded hotel for local validation', CURRENT_DATE::TEXT, (CURRENT_DATE + INTERVAL '1 day')::TEXT, $13, $13)
            ON CONFLICT (uuid) DO UPDATE SET
                company_uuid = EXCLUDED.company_uuid,
                tour_id = EXCLUDED.tour_id,
                driver_uuid = EXCLUDED.driver_uuid,
                driver_name = EXCLUDED.driver_name,
                name = EXCLUDED.name,
                address = EXCLUDED.address,
                address_line_1 = EXCLUDED.address_line_1,
                city = EXCLUDED.city,
                country = EXCLUDED.country,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                status = EXCLUDED.status,
                notes = EXCLUDED.notes,
                updated_at = EXCLUDED.updated_at
        `, [hotel[0], companyUuid, tour.id, driver.uuid, driver.name, hotel[1], hotel[2], hotel[3], hotel[4], hotel[5], hotel[6], hotel[7], now]);
    }
}

async function upsertDeviceState(client, companyUuid, driver) {
    const now = Date.now();
    const tokenHash = crypto.createHash('sha256').update('dev-device-token-active-1').digest('hex');
    await client.query(`
        INSERT INTO driver_devices (driver_uuid, device_id, device_name, is_active, linked_at, last_seen_at, device_token_hash, token_rotated_at)
        VALUES ($1, 'dev-device-active-1', 'Local Android Device', true, $2, $2, $3, $2)
        ON CONFLICT (device_id) DO UPDATE SET
            driver_uuid = EXCLUDED.driver_uuid,
            device_name = EXCLUDED.device_name,
            is_active = true,
            last_seen_at = EXCLUDED.last_seen_at,
            device_token_hash = EXCLUDED.device_token_hash,
            token_rotated_at = EXCLUDED.token_rotated_at
    `, [driver.uuid, now, tokenHash]);

    await client.query(`
        INSERT INTO live_updates (uuid, company_uuid, driver_uuid, driver_name, driver_phone, driver_email, license_plate, latitude, longitude,
            speed, status, current_tour, next_stop, timestamp)
        VALUES ('50000000-0000-4000-8000-000000000001', $1, $2, $3, '+36 30 111 1111', 'active.driver@example.test', 'DEV-101',
            47.4979, 19.0402, 42, 'DRIVING', 'LogiHERO Dev Budapest Route', 'Hotel Dev Coordinate', $4)
        ON CONFLICT (uuid) DO UPDATE SET
            company_uuid = EXCLUDED.company_uuid,
            driver_uuid = EXCLUDED.driver_uuid,
            driver_name = EXCLUDED.driver_name,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            speed = EXCLUDED.speed,
            status = EXCLUDED.status,
            current_tour = EXCLUDED.current_tour,
            next_stop = EXCLUDED.next_stop,
            timestamp = EXCLUDED.timestamp
    `, [companyUuid, driver.uuid, driver.name, now]);
}

async function upsertWorkTimeSeeds(client, companyUuid, drivers, tours) {
    const base = new Date();
    base.setUTCHours(6, 0, 0, 0);
    const dayStart = base.getTime();
    const rows = [
        {
            uuid: '60000000-0000-4000-8000-000000000001',
            driver: drivers[0],
            tour: tours[0],
            offset: 0,
            status: 'CLOSED',
            approval: 'APPROVED',
            entries: [['DRIVING', 0, 2], ['BREAK', 2, 2.75], ['WORK', 2.75, 4.5]]
        },
        {
            uuid: '60000000-0000-4000-8000-000000000002',
            driver: drivers[0],
            tour: null,
            offset: -86400000,
            status: 'CLOSED',
            approval: 'REJECTED',
            adminNote: 'Seed rejected day',
            entries: [['WORK', 0, 1.5], ['DRIVING', 1.5, 3.5], ['REST', 3.5, 4.5]]
        },
        {
            uuid: '60000000-0000-4000-8000-000000000003',
            driver: drivers[1],
            tour: null,
            offset: 0,
            status: 'OPEN',
            approval: 'PENDING',
            entries: [['AVAILABILITY', 0, null]]
        },
        {
            uuid: '60000000-0000-4000-8000-000000000004',
            driver: drivers[0],
            tour: null,
            offset: -172800000,
            status: 'CLOSED',
            approval: 'CORRECTION_REQUIRED',
            adminNote: 'Manual correction seed',
            anomalyFlags: ['MANUAL_CORRECTION'],
            entries: [['DRIVING', 0, 1], ['WORK', 1, 2]]
        },
        {
            uuid: '60000000-0000-4000-8000-000000000005',
            driver: drivers[2],
            tour: null,
            offset: -7 * 86400000,
            status: 'CLOSED',
            approval: 'PENDING',
            anomalyFlags: ['SYNC_CONFLICT'],
            entries: [['WORK', 0, 1], ['BREAK', 1, 1.5], ['DRIVING', 1.5, 3]]
        },
        {
            uuid: '60000000-0000-4000-8000-000000000006',
            driver: drivers[0],
            tour: null,
            offset: -14 * 86400000,
            status: 'CLOSED',
            approval: 'APPROVED',
            entries: [['DRIVING', 0, 2], ['REST', 2, 3], ['WORK', 3, 4]]
        }
    ];
    for (const day of rows) {
        const start = dayStart + day.offset;
        const end = day.status === 'OPEN' ? null : start + 5 * 60 * 60 * 1000;
        await client.query(`
            INSERT INTO work_days (uuid, company_uuid, driver_uuid, driver_name, tour_uuid, work_date, start_time, end_time, status,
                start_location, end_location, notes, approval_status, admin_note, anomaly_flags, updated_at)
            VALUES ($1, $2, $3, $4, $5::UUID, $6, $7, $8, $9, 'Depot', 'Depot', 'Seeded work day', $10, $11, $12, $13)
            ON CONFLICT (uuid) DO UPDATE SET
                driver_uuid = EXCLUDED.driver_uuid,
                driver_name = EXCLUDED.driver_name,
                tour_uuid = EXCLUDED.tour_uuid,
                work_date = EXCLUDED.work_date,
                start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time,
                status = EXCLUDED.status,
                approval_status = EXCLUDED.approval_status,
                admin_note = EXCLUDED.admin_note,
                anomaly_flags = EXCLUDED.anomaly_flags,
                updated_at = EXCLUDED.updated_at
        `, [day.uuid, companyUuid, day.driver.uuid, day.driver.name, day.tour?.uuid || null, new Date(start).toISOString().slice(0, 10), start, end, day.status, day.approval, day.adminNote || null, day.anomalyFlags || [], Date.now()]);

        for (let index = 0; index < day.entries.length; index += 1) {
            const [status, fromHour, toHour] = day.entries[index];
            const entryStart = start + Math.round(fromHour * 3600000);
            const entryEnd = toHour == null ? null : start + Math.round(toHour * 3600000);
            await client.query(`
                INSERT INTO work_time_entries (uuid, work_day_uuid, company_uuid, driver_uuid, driver_name, tour_uuid, status, start_time, end_time, duration_ms,
                    source, manual_edit, correction_reason, approval_status, updated_at)
                VALUES ($1, $2::UUID, $3, $4, $5, $6::UUID, $7, $8, $9, COALESCE($9::BIGINT - $8::BIGINT, 0), 'ANDROID', $10, $11, $12, $13)
                ON CONFLICT (uuid) DO UPDATE SET
                    status = EXCLUDED.status,
                    start_time = EXCLUDED.start_time,
                    end_time = EXCLUDED.end_time,
                    duration_ms = EXCLUDED.duration_ms,
                    manual_edit = EXCLUDED.manual_edit,
                    correction_reason = EXCLUDED.correction_reason,
                    approval_status = EXCLUDED.approval_status,
                    updated_at = EXCLUDED.updated_at
            `, [`70000000-0000-4000-8000-${String(Number(day.uuid.slice(-12)) + index).padStart(12, '0')}`, day.uuid, companyUuid, day.driver.uuid, day.driver.name, day.tour?.uuid || null, status, entryStart, entryEnd, day.uuid.endsWith('0004') && index === 1, day.uuid.endsWith('0004') && index === 1 ? 'Seed manual correction' : null, day.approval, Date.now()]);
        }
        await client.query(`
            UPDATE work_days d SET
                total_work_ms = COALESCE(s.total_work_ms, 0),
                driving_ms = COALESCE(s.driving_ms, 0),
                break_ms = COALESCE(s.break_ms, 0),
                rest_ms = COALESCE(s.rest_ms, 0),
                availability_ms = COALESCE(s.availability_ms, 0),
                updated_at = $2
            FROM (
                SELECT work_day_uuid,
                    SUM(CASE WHEN status IN ('WORK','DRIVING','BREAK','REST','AVAILABILITY') THEN COALESCE(duration_ms, 0) ELSE 0 END) AS total_work_ms,
                    SUM(CASE WHEN status = 'DRIVING' THEN COALESCE(duration_ms, 0) ELSE 0 END) AS driving_ms,
                    SUM(CASE WHEN status = 'BREAK' THEN COALESCE(duration_ms, 0) ELSE 0 END) AS break_ms,
                    SUM(CASE WHEN status = 'REST' THEN COALESCE(duration_ms, 0) ELSE 0 END) AS rest_ms,
                    SUM(CASE WHEN status = 'AVAILABILITY' THEN COALESCE(duration_ms, 0) ELSE 0 END) AS availability_ms
                FROM work_time_entries WHERE work_day_uuid = $1 GROUP BY work_day_uuid
            ) s
            WHERE d.uuid = s.work_day_uuid
        `, [day.uuid, Date.now()]);
        await client.query('INSERT INTO work_time_audit (event_uuid, work_day_uuid, event_type, actor_type, actor_id, request_id, occurred_at, reason) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7) ON CONFLICT (event_uuid) DO NOTHING', [day.uuid, 'SEED_CREATED', 'SYSTEM', 'seed', 'seed', Date.now(), 'Development seed']);
    }
}

(async () => {
    assertSafeSeedTarget();
    await initDb();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const companyUuid = await upsertCompany(client);
        const drivers = await upsertDrivers(client, companyUuid);
        const tours = await upsertTours(client, companyUuid, drivers[0]);
        await upsertStopsCargoHotels(client, companyUuid, drivers[0], tours[0]);
        await upsertDeviceState(client, companyUuid, drivers[0]);
        await upsertWorkTimeSeeds(client, companyUuid, drivers, tours);
        await client.query('COMMIT');
        console.log('[DB] seed complete');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
})().catch((error) => {
    console.error('[DB] seed failed:', error.message);
    process.exit(1);
});

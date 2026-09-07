const OWNED_BY_DRIVER = [
    'live_updates', 'costs', 'chat_messages', 'work_times', 'work_days',
    'work_time_entries', 'hotels', 'tours', 'cargo'
];
const SYNC_TABLES = [
    'drivers', 'driver_devices', 'tours', 'stops', 'hotels', 'cargo',
    'work_times', 'work_days', 'work_time_entries', 'costs'
];

async function count(client, sql, params = []) {
    return Number((await client.query(sql, params)).rows[0]?.count || 0);
}

async function requireUniqueDriverNames(client) {
    const duplicates = await client.query(`
        SELECT name FROM drivers WHERE name IS NOT NULL
        GROUP BY name HAVING COUNT(*) > 1 LIMIT 10
    `);
    if (duplicates.rowCount) throw new Error('BACKFILL_PRECONDITION: duplicate driver names prevent deterministic ownership mapping');
}

async function assignDriverUuids(client) {
    const duplicateUuids = await client.query(`
        SELECT uuid FROM drivers WHERE uuid IS NOT NULL
        GROUP BY uuid HAVING COUNT(*) > 1 LIMIT 10
    `);
    if (duplicateUuids.rowCount) throw new Error('BACKFILL_PRECONDITION: duplicate drivers.uuid values');
    await client.query('UPDATE drivers SET uuid = gen_random_uuid() WHERE uuid IS NULL');
}

async function resolveCompanyOwnership(client) {
    const unownedDrivers = await count(client, 'SELECT COUNT(*)::int AS count FROM drivers WHERE company_uuid IS NULL');
    if (unownedDrivers) {
        const companies = await client.query('SELECT uuid FROM companies ORDER BY uuid LIMIT 2');
        if (companies.rowCount !== 1) {
            throw new Error('BACKFILL_PRECONDITION: unowned drivers require exactly one existing company');
        }
        await client.query('UPDATE drivers SET company_uuid = $1 WHERE company_uuid IS NULL', [companies.rows[0].uuid]);
    }

    await client.query(`
        UPDATE hotels target SET company_uuid=tour.company_uuid, driver_uuid=COALESCE(target.driver_uuid, tour.driver_uuid)
        FROM tours tour WHERE target.tour_id=tour.id AND (target.company_uuid IS NULL OR target.driver_uuid IS NULL)
    `);
    await client.query(`
        UPDATE cargo target SET company_uuid=tour.company_uuid, driver_uuid=COALESCE(target.driver_uuid, tour.driver_uuid)
        FROM tours tour WHERE target.tour_id=tour.id AND (target.company_uuid IS NULL OR target.driver_uuid IS NULL)
    `);
    await client.query(`
        UPDATE work_time_entries target
        SET company_uuid=day.company_uuid, driver_uuid=COALESCE(target.driver_uuid, day.driver_uuid),
            driver_name=COALESCE(target.driver_name, day.driver_name)
        FROM work_days day WHERE target.work_day_uuid=day.uuid AND (target.company_uuid IS NULL OR target.driver_uuid IS NULL)
    `);

    for (const table of OWNED_BY_DRIVER) {
        await client.query(`
            UPDATE ${table} target SET company_uuid=driver.company_uuid
            FROM drivers driver
            WHERE target.driver_uuid=driver.uuid AND target.company_uuid IS NULL
        `);
        await client.query(`
            UPDATE ${table} target
            SET driver_uuid = driver.uuid,
                company_uuid = COALESCE(target.company_uuid, driver.company_uuid)
            FROM drivers driver
            WHERE target.driver_name = driver.name
              AND (target.driver_uuid IS NULL OR target.company_uuid IS NULL)
        `);
        const unresolved = await count(client, `
            SELECT COUNT(*)::int AS count FROM ${table}
            WHERE company_uuid IS NULL
               OR (driver_name IS NOT NULL AND driver_uuid IS NULL)
        `);
        if (unresolved) throw new Error(`BACKFILL_PRECONDITION: ${table} contains ${unresolved} rows with unresolved driver ownership`);
    }

    await client.query(`
        UPDATE stops target SET company_uuid = tour.company_uuid, driver_uuid = tour.driver_uuid
        FROM tours tour
        WHERE target.tour_id = tour.id AND (target.company_uuid IS NULL OR target.driver_uuid IS NULL)
    `);
    const unresolvedStops = await count(client, `
        SELECT COUNT(*)::int AS count FROM stops
        WHERE tour_id IS NOT NULL AND (driver_uuid IS NULL OR company_uuid IS NULL)
    `);
    if (unresolvedStops) throw new Error(`BACKFILL_PRECONDITION: stops contains ${unresolvedStops} rows with unresolved tour ownership`);

    await client.query(`
        UPDATE cargo_events target SET company_uuid = cargo.company_uuid, driver_uuid = cargo.driver_uuid
        FROM cargo WHERE target.cargo_id = cargo.id AND (target.company_uuid IS NULL OR target.driver_uuid IS NULL)
    `);
    const unresolvedEvents = await count(client, `
        SELECT COUNT(*)::int AS count FROM cargo_events
        WHERE cargo_id IS NOT NULL AND (driver_uuid IS NULL OR company_uuid IS NULL)
    `);
    if (unresolvedEvents) throw new Error(`BACKFILL_PRECONDITION: cargo_events contains ${unresolvedEvents} rows with unresolved cargo ownership`);
}

async function backfillSyncMetadata(client) {
    const now = Date.now();
    for (const table of SYNC_TABLES) {
        const columns = await client.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name=$1
        `, [table]);
        const names = new Set(columns.rows.map((row) => row.column_name));
        const timestamp = names.has('timestamp') ? 'timestamp' : 'NULL';
        if (names.has('created_at')) {
            const updated = names.has('updated_at') ? 'updated_at' : 'NULL';
            await client.query(`UPDATE ${table} SET created_at = COALESCE(created_at, ${updated}, ${timestamp}, $1) WHERE created_at IS NULL`, [now]);
        }
        if (names.has('updated_at')) {
            const created = names.has('created_at') ? 'created_at' : 'NULL';
            await client.query(`UPDATE ${table} SET updated_at = COALESCE(updated_at, ${timestamp}, ${created}, $1) WHERE updated_at IS NULL`, [now]);
        }
        if (names.has('sync_state')) await client.query(`UPDATE ${table} SET sync_state='SYNCED' WHERE sync_state IS NULL`);
        if (names.has('revision')) await client.query(`UPDATE ${table} SET revision=1 WHERE revision IS NULL`);
    }
}

module.exports = {
    id: '003_backfill_legacy_rows',
    description: 'Backfill UUID, ownership, and sync metadata only after deterministic preflight checks.',
    async up(client) {
        await requireUniqueDriverNames(client);
        await assignDriverUuids(client);
        await client.query('UPDATE cargo_events SET uuid = gen_random_uuid() WHERE uuid IS NULL');
        await resolveCompanyOwnership(client);
        await backfillSyncMetadata(client);
    }
};

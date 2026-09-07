const { FOREIGN_KEYS, INDEXES, UNIQUE_CONSTRAINTS } = require('../schema-contract');

async function assertNoDuplicates(client, table, columns, label) {
    const result = await client.query(`
        SELECT ${columns}, COUNT(*)::int AS count FROM ${table}
        WHERE ${columns.split(',').map((column) => `${column.trim()} IS NOT NULL`).join(' AND ')}
        GROUP BY ${columns} HAVING COUNT(*) > 1 LIMIT 1
    `);
    if (result.rowCount) throw new Error(`CONSTRAINT_PRECONDITION: duplicate values prevent ${label}`);
}

async function addUniqueConstraint(client, name, table, columns) {
    const existing = await client.query(`
        SELECT constraint_row.conname,
               array_agg(attribute.attname::text ORDER BY key_column.ordinality) AS columns
        FROM pg_constraint constraint_row
        CROSS JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
        JOIN pg_attribute attribute
          ON attribute.attrelid=constraint_row.conrelid AND attribute.attnum=key_column.attnum
        WHERE constraint_row.conrelid=$1::regclass AND constraint_row.contype IN ('p', 'u')
        GROUP BY constraint_row.conname
    `, [table]);
    const expected = columns.split(',').map((column) => column.trim());
    if (!existing.rows.some((row) => JSON.stringify(row.columns) === JSON.stringify(expected))) {
        await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} UNIQUE (${columns})`);
    }
}

async function addForeignKey(client, name, sourceTable, sourceColumn, targetTable, targetColumn) {
    const orphan = await client.query(`
        SELECT 1 FROM ${sourceTable} source
        LEFT JOIN ${targetTable} target ON target.${targetColumn}=source.${sourceColumn}
        WHERE source.${sourceColumn} IS NOT NULL AND target.${targetColumn} IS NULL LIMIT 1
    `);
    if (orphan.rowCount) throw new Error(`CONSTRAINT_PRECONDITION: ${sourceTable}.${sourceColumn} contains orphaned references`);
    const existing = await client.query(`
        SELECT 1
        FROM pg_constraint constraint_row
        JOIN pg_class source ON source.oid=constraint_row.conrelid
        JOIN pg_attribute source_attribute ON source_attribute.attrelid=source.oid AND source_attribute.attnum=constraint_row.conkey[1]
        JOIN pg_class target ON target.oid=constraint_row.confrelid
        JOIN pg_attribute target_attribute ON target_attribute.attrelid=target.oid AND target_attribute.attnum=constraint_row.confkey[1]
        WHERE constraint_row.contype='f' AND source.relname=$1 AND source_attribute.attname=$2
          AND target.relname=$3 AND target_attribute.attname=$4
    `, [sourceTable, sourceColumn, targetTable, targetColumn]);
    if (!existing.rowCount) {
        await client.query(`ALTER TABLE ${sourceTable} ADD CONSTRAINT ${name} FOREIGN KEY (${sourceColumn}) REFERENCES ${targetTable} (${targetColumn})`);
    }
}

module.exports = {
    id: '005_add_constraints_and_indexes',
    description: 'Enforce proven UUID and business-key constraints and create operational indexes.',
    checksumFiles: ['../schema-contract.js'],
    async up(client) {
        await assertNoDuplicates(client, 'drivers', 'uuid', 'drivers.uuid uniqueness');
        const nullDrivers = await client.query('SELECT 1 FROM drivers WHERE uuid IS NULL LIMIT 1');
        if (nullDrivers.rowCount) throw new Error('CONSTRAINT_PRECONDITION: drivers.uuid contains null values');
        await client.query('ALTER TABLE drivers ALTER COLUMN uuid SET NOT NULL');
        await addUniqueConstraint(client, 'drivers_uuid_unique', 'drivers', 'uuid');

        await assertNoDuplicates(client, 'cargo_events', 'uuid', 'cargo_events.uuid uniqueness');
        const nullCargoEvents = await client.query('SELECT 1 FROM cargo_events WHERE uuid IS NULL LIMIT 1');
        if (nullCargoEvents.rowCount) throw new Error('CONSTRAINT_PRECONDITION: cargo_events.uuid contains null values');
        await client.query('ALTER TABLE cargo_events ALTER COLUMN uuid SET NOT NULL');
        await addUniqueConstraint(client, 'cargo_events_uuid_unique', 'cargo_events', 'uuid');

        for (const [name, table, columns] of UNIQUE_CONSTRAINTS) {
            await assertNoDuplicates(client, table, columns, name);
            await addUniqueConstraint(client, name, table, columns);
        }
        for (const foreignKey of FOREIGN_KEYS) await addForeignKey(client, ...foreignKey);
        for (const [name, table, columns] of INDEXES) {
            await client.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${columns})`);
        }
    }
};

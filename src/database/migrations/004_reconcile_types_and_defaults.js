const { COLUMN_DEFAULTS, TABLES, baseType } = require('../schema-contract');

async function assertCompatibleTypes(client) {
    const result = await client.query(`
        SELECT c.table_name, c.column_name, format_type(a.atttypid, a.atttypmod) AS formatted_type
        FROM information_schema.columns c
        JOIN pg_class cl ON cl.relname=c.table_name
        JOIN pg_namespace n ON n.oid=cl.relnamespace AND n.nspname=c.table_schema
        JOIN pg_attribute a ON a.attrelid=cl.oid AND a.attname=c.column_name AND a.attnum > 0 AND NOT a.attisdropped
        WHERE c.table_schema='public' AND c.table_name=ANY($1::text[])
    `, [TABLES.map(([table]) => table)]);
    const actual = new Map(result.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.formatted_type.toLowerCase()]));
    for (const [table, columns] of TABLES) {
        for (const [column, definition] of columns) {
            const expected = baseType(definition);
            const found = actual.get(`${table}.${column}`);
            if (found !== expected) {
                throw new Error(`TYPE_PRECONDITION: ${table}.${column} expected ${expected}, found ${found || 'missing'}`);
            }
        }
    }
}

module.exports = {
    id: '004_reconcile_types_and_defaults',
    description: 'Verify compatible column types and apply non-destructive canonical defaults.',
    checksumFiles: ['../schema-contract.js'],
    async up(client) {
        await assertCompatibleTypes(client);
        for (const [table, column, expression] of COLUMN_DEFAULTS) {
            await client.query(`ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${expression}`);
        }
    }
};

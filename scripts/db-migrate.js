process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const pool = require('../src/database/pool');
const { inspectMigrations, migrate, verifyMigrations } = require('../src/database/migration-runtime');

function parseArgs(argv) {
    const args = [...argv];
    const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'migrate';
    let to;
    while (args.length) {
        const argument = args.shift();
        if (argument === '--to') to = args.shift();
        else if (argument.startsWith('--to=')) to = argument.slice(5);
        else throw new Error(`Unknown argument: ${argument}`);
    }
    if (!['migrate', 'status', 'verify'].includes(command)) throw new Error(`Unknown migration command: ${command}`);
    if (command !== 'migrate' && to) throw new Error('--to is supported only with migrate');
    if (argv.includes('--to') && !to) throw new Error('--to requires a migration id');
    return { command, to };
}

async function run(argv = process.argv.slice(2), clientPool = pool) {
    const options = parseArgs(argv);
    const client = await clientPool.connect();
    try {
        if (options.command === 'migrate') {
            const result = await migrate(client, { to: options.to });
            console.log(JSON.stringify({ status: 'MIGRATED', head: result.state.head, results: result.results }, null, 2));
            return result;
        }
        if (options.command === 'verify') {
            const state = await verifyMigrations(client);
            console.log(JSON.stringify({ status: 'VERIFIED', ...state }, null, 2));
            return state;
        }
        const inspected = await inspectMigrations(client);
        console.log(JSON.stringify({ status: inspected.state.ok ? 'CURRENT' : 'NOT_CURRENT', ...inspected.state }, null, 2));
        return inspected.state;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    run()
        .catch((error) => {
            console.error(`[MIGRATION] ${error.code || 'FAILED'}: ${error.message}`);
            process.exitCode = 1;
        })
        .finally(() => pool.end());
}

module.exports = { parseArgs, run };

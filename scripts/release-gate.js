const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const releaseMode = process.argv.includes('--release') || process.env.RELEASE_GATE_MODE === 'release';
const includeAndroidConnected = process.argv.includes('--connected-android') || process.env.RELEASE_GATE_CONNECTED_ANDROID === 'true';

function run(label, command, args, options = {}) {
    console.log(`[RELEASE_GATE] start ${label}`);
    const result = spawnSync(command, args, {
        stdio: 'inherit',
        shell: false,
        env: { ...process.env, ...options.env },
        windowsHide: true
    });
    if (result.status !== 0) {
        const status = options.blockStatus || 'BLOCKED_TEST_FAILURE';
        console.error(`[RELEASE_GATE] status=${status} failed=${label}`);
        process.exit(result.status || 1);
    }
    console.log(`[RELEASE_GATE] ok ${label}`);
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const gradleCmd = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';

function output(command, args) {
    return spawnSync(command, args, { encoding: 'utf8', shell: false, windowsHide: true }).stdout.trim();
}

function assertCleanTree() {
    const dirty = output('git', ['status', '--short'])
        .split(/\r?\n/)
        .filter(Boolean)
        .filter(line => !line.includes('.artifacts/0f209715-494d-432c-9bb2-b258c91ea7b1/walkthrough.artifact.md'));
    if (dirty.length) {
        console.error(`[RELEASE_GATE] status=BLOCKED_DIRTY_TREE files=${dirty.length}`);
        process.exit(1);
    }
}

function assertMainSynced() {
    const branch = output('git', ['branch', '--show-current']);
    const head = output('git', ['rev-parse', 'HEAD']);
    const origin = output('git', ['rev-parse', 'origin/main']);
    if (branch !== 'main' || head !== origin) {
        console.error(`[RELEASE_GATE] status=BLOCKED_DIRTY_TREE branch=${branch} head=${head} origin=${origin}`);
        process.exit(1);
    }
}

function assertForbiddenFiles() {
    const forbidden = [/^backups\//, /^playwright-report\//, /^test-results\//, /\.dump$/, /\.backup$/, /\.sql$/, /\.log$/, /^\.env(?:\.|$)/, /\.(jks|keystore|key|pem)$/];
    const files = output('git', ['ls-files']).split(/\r?\n/).filter(Boolean);
    const matches = files.filter((file) => {
        const normalized = file.replace(/\\/g, '/');
        if (normalized === '.env.example') return false;
        return forbidden.some(pattern => pattern.test(normalized));
    });
    if (matches.length) {
        console.error(`[RELEASE_GATE] status=BLOCKED_DIRTY_TREE forbidden=${matches.join(',')}`);
        process.exit(1);
    }
}

assertCleanTree();
assertMainSynced();
assertForbiddenFiles();

run('diff-check', 'git', ['diff', '--check']);
run('secret-scan', process.execPath, ['scripts/secret-scan.js']);
run('typecheck', npmCmd, ['run', 'typecheck']);
run('unit', npmCmd, ['test']);
run('integration', npmCmd, ['run', 'test:integration']);
run('e2e-headless', npmCmd, ['run', 'test:e2e']);
run('android-jvm', gradleCmd, ['test']);
run('migration-check', process.execPath, ['scripts/migration-check.js']);

if (process.env.RESTORE_FILE && process.env.RESTORE_DATABASE_URL) {
    run('restore-drill', process.execPath, ['scripts/db-restore.js'], { blockStatus: 'BLOCKED_BACKUP_RESTORE' });
} else {
    console.warn('[RELEASE_GATE] restore-drill skipped; set RESTORE_FILE and RESTORE_DATABASE_URL to enforce');
}

if (includeAndroidConnected) {
    run('android-connected', 'powershell', ['-ExecutionPolicy', 'Bypass', '-File', 'scripts\\android-connected-test.ps1', '-UseRunningDevice', '-GradleTask', 'connectedAndroidTest']);
}

if (releaseMode && !process.env.PRODUCTION_SMOKE_ADMIN_TOKEN) {
    console.error('[RELEASE_GATE] status=BLOCKED_MISSING_PRODUCTION_CREDENTIAL');
    process.exit(1);
}

run('production-smoke', npmCmd, ['run', 'smoke:production'], {
    blockStatus: 'BLOCKED_PRODUCTION_SMOKE',
    env: releaseMode ? {} : { SMOKE_ALLOW_PARTIAL: process.env.SMOKE_ALLOW_PARTIAL || 'true' }
});

console.log(`[RELEASE_GATE] status=${releaseMode ? 'RELEASE_READY' : 'RELEASE_READY_WITH_EXTERNAL_MONITORING_SETUP'}`);

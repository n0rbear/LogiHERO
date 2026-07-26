const { spawnSync } = require('node:child_process');
const { readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const excluded = new Set(['node_modules', '.git', 'build', 'reports', 'playwright-report', 'test-results', 'blob-report']);

function collectJsFiles(path) {
    const stat = statSync(path);
    if (stat.isFile()) return path.endsWith('.js') ? [path] : [];
    return readdirSync(path)
        .filter(name => !excluded.has(name))
        .flatMap(name => collectJsFiles(join(path, name)));
}

const files = [
    'server.js',
    'playwright.config.js',
    ...collectJsFiles('src'),
    ...collectJsFiles('scripts'),
    ...collectJsFiles('tests')
];
let failed = false;

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);

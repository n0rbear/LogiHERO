const { spawnSync } = require('node:child_process');
const { readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

function collectJsFiles(path) {
    const stat = statSync(path);
    if (stat.isFile()) return path.endsWith('.js') ? [path] : [];
    return readdirSync(path).flatMap(name => collectJsFiles(join(path, name)));
}

const files = ['server.js', ...collectJsFiles('src')];
let failed = false;

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);

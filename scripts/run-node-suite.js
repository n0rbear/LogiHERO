const { spawnSync } = require('node:child_process');
const { readdirSync, statSync } = require('node:fs');
const { join, normalize, relative, sep } = require('node:path');

const generatedPathSegments = new Set([
    'build',
    'dist',
    'coverage',
    'reports',
    'generated',
    'playwright-report',
    'test-results',
    'blob-report',
    '.gradle'
]);

function hasGeneratedSegment(filePath) {
    return normalize(filePath)
        .split(/[\\/]+/)
        .some(segment => generatedPathSegments.has(segment));
}

function isProjectNodeTest(filePath) {
    const normalized = normalize(filePath);
    if (hasGeneratedSegment(normalized)) return false;
    const rel = relative(process.cwd(), normalized);
    const segments = rel.split(sep);
    return segments.length === 2 && segments[0] === 'tests' && /\.test\.js$/i.test(segments[1]);
}

function collectProjectNodeTests(root = process.cwd()) {
    const testsDir = join(root, 'tests');
    return readdirSync(testsDir)
        .map(file => join(testsDir, file))
        .filter(file => statSync(file).isFile())
        .filter(isProjectNodeTest)
        .sort();
}

function runProjectNodeTests() {
    const files = collectProjectNodeTests();
    if (!files.length) {
        console.error('[PROJECT_TEST] status=NO_TEST_FILES');
        return 1;
    }
    const result = spawnSync(process.execPath, ['--test', ...files], {
        stdio: 'inherit',
        env: process.env,
        windowsHide: true
    });
    if (result.error) {
        console.error(`[PROJECT_TEST] status=SPAWN_FAILED error=${result.error.message}`);
        return 1;
    }
    return result.status || 0;
}

if (require.main === module) {
    process.exit(runProjectNodeTests());
}

module.exports = {
    collectProjectNodeTests,
    generatedPathSegments,
    hasGeneratedSegment,
    isProjectNodeTest,
    runProjectNodeTests
};

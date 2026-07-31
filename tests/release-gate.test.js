const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCommandInvocation, classifyRepositoryState, getSpawnOutcome } = require('../scripts/release-gate');
const { isProjectNodeTest, hasGeneratedSegment } = require('../scripts/run-node-suite');

test('Windows cmd files are routed through the Windows command processor', () => {
    const invocation = buildCommandInvocation('npm.cmd', ['run', 'typecheck'], {
        platform: 'win32',
        env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
    });

    assert.equal(invocation.command, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepEqual(invocation.args, ['/d', '/s', '/c', 'npm.cmd', 'run', 'typecheck']);
});

test('Windows cmd invocation preserves arguments', () => {
    const invocation = buildCommandInvocation('C:\\Program Files\\nodejs\\npm.cmd', ['run', 'test:e2e', '--', '--headed'], {
        platform: 'win32',
        env: { COMSPEC: 'cmd.exe' }
    });

    assert.equal(invocation.command, 'cmd.exe');
    assert.deepEqual(invocation.args, [
        '/d',
        '/s',
        '/c',
        'C:\\Program Files\\nodejs\\npm.cmd',
        'run',
        'test:e2e',
        '--',
        '--headed'
    ]);
});

test('Windows bat files are routed through the Windows command processor', () => {
    const invocation = buildCommandInvocation('.\\gradlew.bat', ['test'], {
        platform: 'win32',
        env: { ComSpec: 'cmd.exe' }
    });

    assert.equal(invocation.command, 'cmd.exe');
    assert.deepEqual(invocation.args, ['/d', '/s', '/c', '.\\gradlew.bat', 'test']);
});

test('Windows command script detection is case-insensitive', () => {
    const upper = buildCommandInvocation('tool.BAT', [], {
        platform: 'win32',
        env: { ComSpec: 'cmd.exe' }
    });
    const mixed = buildCommandInvocation('tool.BaT', ['run'], {
        platform: 'win32',
        env: { ComSpec: 'cmd.exe' }
    });

    assert.equal(upper.command, 'cmd.exe');
    assert.deepEqual(upper.args, ['/d', '/s', '/c', 'tool.BAT']);
    assert.equal(mixed.command, 'cmd.exe');
    assert.deepEqual(mixed.args, ['/d', '/s', '/c', 'tool.BaT', 'run']);
});

test('Windows bat invocation preserves paths and Gradle arguments', () => {
    const invocation = buildCommandInvocation(
        'C:\\Project Files\\LogiHERO\\gradlew.bat',
        ['test', '--no-daemon', '-Dexample=value with spaces'],
        { platform: 'win32', env: { ComSpec: 'cmd.exe' } }
    );

    assert.equal(invocation.command, 'cmd.exe');
    assert.deepEqual(invocation.args, [
        '/d',
        '/s',
        '/c',
        'C:\\Project Files\\LogiHERO\\gradlew.bat',
        'test',
        '--no-daemon',
        '-Dexample=value with spaces'
    ]);
});

test('non-Windows commands keep direct spawn behavior', () => {
    const invocation = buildCommandInvocation('npm', ['test'], {
        platform: 'linux',
        env: {}
    });

    assert.equal(invocation.command, 'npm');
    assert.deepEqual(invocation.args, ['test']);
});

test('non-script Windows executables keep direct spawn behavior', () => {
    const invocation = buildCommandInvocation('node', ['scripts/secret-scan.js'], {
        platform: 'win32',
        env: { ComSpec: 'cmd.exe' }
    });

    assert.equal(invocation.command, 'node');
    assert.deepEqual(invocation.args, ['scripts/secret-scan.js']);

    const gitInvocation = buildCommandInvocation('git.exe', ['status'], {
        platform: 'win32',
        env: { ComSpec: 'cmd.exe' }
    });

    assert.equal(gitInvocation.command, 'git.exe');
    assert.deepEqual(gitInvocation.args, ['status']);
});

test('bat-named commands on non-Windows platforms keep direct spawn behavior', () => {
    const invocation = buildCommandInvocation('./gradlew.bat', ['test'], {
        platform: 'linux',
        env: {}
    });

    assert.equal(invocation.command, './gradlew.bat');
    assert.deepEqual(invocation.args, ['test']);
});

test('successful command exit produces success', () => {
    assert.deepEqual(getSpawnOutcome({ status: 0 }), {
        ok: true,
        exitCode: 0,
        errorMessage: ''
    });
});

test('non-zero command exit remains a gate failure', () => {
    assert.deepEqual(getSpawnOutcome({ status: 7 }), {
        ok: false,
        exitCode: 7,
        errorMessage: ''
    });
});

test('spawn failure remains distinguishable from non-zero exit', () => {
    assert.deepEqual(getSpawnOutcome({ status: null, error: new Error('spawn failed') }), {
        ok: false,
        exitCode: 1,
        errorMessage: 'spawn failed'
    });
});

test('repository state classification allows a clean synchronized branch', () => {
    assert.deepEqual(classifyRepositoryState({
        dirty: [],
        branch: 'main',
        head: 'abc',
        upstream: 'abc',
        ahead: 0,
        behind: 0
    }), {
        ok: true,
        status: 'REPOSITORY_SYNCED',
        detail: 'ahead=0 behind=0'
    });
});

test('repository state classification allows clean ahead-only branch', () => {
    assert.deepEqual(classifyRepositoryState({
        dirty: [],
        branch: 'main',
        head: 'def',
        upstream: 'abc',
        ahead: 1,
        behind: 0
    }), {
        ok: true,
        status: 'REPOSITORY_AHEAD_OF_UPSTREAM',
        detail: 'ahead=1'
    });
});

test('repository state classification blocks behind-only branch', () => {
    assert.deepEqual(classifyRepositoryState({
        dirty: [],
        branch: 'main',
        head: 'abc',
        upstream: 'def',
        ahead: 0,
        behind: 2
    }), {
        ok: false,
        status: 'BLOCKED_BEHIND_UPSTREAM',
        detail: 'behind=2'
    });
});

test('repository state classification blocks diverged branch', () => {
    assert.deepEqual(classifyRepositoryState({
        dirty: [],
        branch: 'main',
        head: 'abc',
        upstream: 'def',
        ahead: 1,
        behind: 2
    }), {
        ok: false,
        status: 'BLOCKED_DIVERGED_FROM_UPSTREAM',
        detail: 'ahead=1 behind=2'
    });
});

test('repository state classification blocks dirty synchronized branch', () => {
    assert.deepEqual(classifyRepositoryState({
        dirty: ['M file'],
        branch: 'main',
        head: 'abc',
        upstream: 'abc',
        ahead: 0,
        behind: 0
    }), {
        ok: false,
        status: 'BLOCKED_DIRTY_TREE',
        detail: 'files=1'
    });
});

test('repository state classification blocks dirty ahead branch', () => {
    assert.deepEqual(classifyRepositoryState({
        dirty: ['M file'],
        branch: 'main',
        head: 'def',
        upstream: 'abc',
        ahead: 1,
        behind: 0
    }), {
        ok: false,
        status: 'BLOCKED_DIRTY_TREE',
        detail: 'files=1'
    });
});

test('repository state classification blocks missing upstream', () => {
    assert.deepEqual(classifyRepositoryState({
        dirty: [],
        branch: 'main',
        head: 'abc',
        upstream: '',
        ahead: 0,
        behind: 0
    }), {
        ok: false,
        status: 'BLOCKED_MISSING_UPSTREAM',
        detail: 'head=abc origin=unknown'
    });
});

test('repository state classification blocks git command failure', () => {
    assert.deepEqual(classifyRepositoryState({
        dirty: [],
        branch: 'main',
        head: 'abc',
        upstream: 'abc',
        ahead: 0,
        behind: 0,
        gitOk: false
    }), {
        ok: false,
        status: 'BLOCKED_GIT_STATE_UNAVAILABLE',
        detail: 'git command failed'
    });
});

test('repository state classification blocks non-main branch', () => {
    assert.deepEqual(classifyRepositoryState({
        dirty: [],
        branch: 'feature',
        head: 'abc',
        upstream: 'abc',
        ahead: 0,
        behind: 0
    }), {
        ok: false,
        status: 'BLOCKED_NON_MAIN_BRANCH',
        detail: 'branch=feature'
    });
});

test('project Node test discovery accepts only intended top-level project tests', () => {
    assert.equal(isProjectNodeTest('tests/admin-sprint-a.test.js'), true);
    assert.equal(isProjectNodeTest('tests/release-gate.test.js'), true);
    assert.equal(isProjectNodeTest('tests/e2e/admin-smoke.spec.js'), false);
    assert.equal(isProjectNodeTest('scripts/release-gate.js'), false);
    assert.equal(isProjectNodeTest('src/routes/tour-core.routes.js'), false);
});

test('project Node test discovery rejects generated build and report JavaScript', () => {
    assert.equal(hasGeneratedSegment('sdks/android-agent/build/reports/tests/test/js/report.js'), true);
    assert.equal(isProjectNodeTest('sdks/android-agent/build/reports/tests/test/js/report.js'), false);
    assert.equal(isProjectNodeTest('build/reports/tests/test/js/browser-report.test.js'), false);
    assert.equal(isProjectNodeTest('dist/generated/smoke.test.js'), false);
    assert.equal(isProjectNodeTest('coverage/tmp/report.test.js'), false);
});

test('project Node test discovery rejects browser-only Android report output', () => {
    const browserOnlyReport = 'sdks/android-agent/build/reports/tests/test/js/report.js';
    assert.equal(isProjectNodeTest(browserOnlyReport), false);
});

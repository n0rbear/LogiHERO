const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCommandInvocation, getSpawnOutcome } = require('../scripts/release-gate');

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

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

test('non-Windows commands keep direct spawn behavior', () => {
    const invocation = buildCommandInvocation('npm', ['test'], {
        platform: 'linux',
        env: {}
    });

    assert.equal(invocation.command, 'npm');
    assert.deepEqual(invocation.args, ['test']);
});

test('non-cmd Windows commands keep direct spawn behavior', () => {
    const invocation = buildCommandInvocation('node', ['scripts/secret-scan.js'], {
        platform: 'win32',
        env: { ComSpec: 'cmd.exe' }
    });

    assert.equal(invocation.command, 'node');
    assert.deepEqual(invocation.args, ['scripts/secret-scan.js']);
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

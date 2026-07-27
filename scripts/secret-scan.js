const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const allowedPlaceholders = [
    'replace-with-logihero-admin-token',
    'replace-with-logihero-read-only-token',
    'local-dev-admin-token',
    'local-dev-read-only-token',
    'unit-test-admin-token',
    'integration-test-admin-token',
    'test-token',
    'test-secret',
    'process.env.ADMIN_TOKEN',
    'process.env.READ_ONLY_ADMIN_TOKEN',
    'process.env.PRODUCTION_SMOKE_ADMIN_TOKEN',
    'postgresql://logihero_dev:logihero_dev_password@127.0.0.1:5432/logihero_dev',
    'postgresql://test:test@localhost:5432/test',
    'postgresql://user:secret@localhost:5432/test',
    'postgresql://USER:PASSWORD@HOST:PORT/DB'
];

const patterns = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/i],
    ['pem', /-----BEGIN CERTIFICATE-----/i],
    ['bearer-token', /Bearer\s+[A-Za-z0-9._~+/-]{20,}/i],
    ['admin-token', /(ADMIN_TOKEN|READ_ONLY_ADMIN_TOKEN|PRODUCTION_SMOKE_ADMIN_TOKEN)[^\S\r\n]*=[^\S\r\n]*(?!$)(?!replace-with)[^\s#]+/i],
    ['device-token', /x-device-token["'\s:=]+[A-Za-z0-9._~+/-]{20,}/i],
    ['database-url', /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i],
    ['render-secret', /(RENDER_API_KEY|RENDER_TOKEN)\s*=\s*[A-Za-z0-9._~+/-]{20,}/i],
    ['env-file', /^\.env(?:\..+)?$/i],
    ['keystore', /\.(?:jks|keystore|key)$/i]
];

function trackedFiles() {
    return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean);
}

function stagedFiles() {
    return execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean);
}

function mask(value) {
    const text = String(value || '');
    if (text.length <= 10) return '***';
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function allowedFinding(file, match, content) {
    if (allowedPlaceholders.some(value => String(match).includes(value) || content.includes(value))) return true;
    if (/^tests[\\/]/.test(file) && /ADMIN_TOKEN|DATABASE_URL/i.test(match)) return true;
    if (/^(scripts|src)[\\/]/.test(file) && /logihero_dev:logihero_dev_password|process\.env\./i.test(content)) return true;
    if (/^docs[\\/]/.test(file) && /logihero_dev:logihero_dev_password|USER:PASSWORD/i.test(content)) return true;
    return false;
}

function scanFile(file, findings) {
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return;
    const base = file.replace(/\\/g, '/').split('/').pop();
    for (const [name, pattern] of patterns) {
        if (name === 'env-file' || name === 'keystore') {
            if (name === 'env-file' && base === '.env.example') continue;
            if (pattern.test(base)) findings.push({ file, type: name, sample: base });
        }
    }
    const content = fs.readFileSync(file, 'utf8');
    if (allowedPlaceholders.some(value => content.includes(value))) {
        // Placeholders are allowed, but the file may still contain other secrets.
    }
    for (const [name, pattern] of patterns) {
        if (name === 'env-file' || name === 'keystore') continue;
        const match = content.match(pattern);
        if (match && !allowedFinding(file, match[0], content)) {
            findings.push({ file, type: name, sample: mask(match[0]) });
        }
    }
}

const files = Array.from(new Set([...trackedFiles(), ...stagedFiles()]));
const findings = [];
for (const file of files) scanFile(file, findings);

if (findings.length) {
    for (const finding of findings) {
        console.error(`[SECRET_SCAN] ${finding.type} ${finding.file} sample=${finding.sample}`);
    }
    process.exit(1);
}

console.log(`[SECRET_SCAN] ok files=${files.length}`);

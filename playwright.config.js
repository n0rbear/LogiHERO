const { defineConfig, devices } = require('@playwright/test');

const localE2eBaseUrl = 'http://127.0.0.1:3100';
const externalE2eBaseUrl = (process.env.LOGIHERO_E2E_BASE_URL || '').trim();
const useExternalE2eServer = Boolean(externalE2eBaseUrl || process.env.LOGIHERO_E2E_EXTERNAL_SERVER);

module.exports = defineConfig({
    testDir: './tests/e2e',
    timeout: 60000,
    expect: { timeout: 10000 },
    reporter: [['list']],
    use: {
        baseURL: externalE2eBaseUrl || localE2eBaseUrl,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    webServer: useExternalE2eServer ? undefined : {
        command: 'node scripts/e2e-server.js',
        url: `${localE2eBaseUrl}/health`,
        reuseExistingServer: false,
        timeout: 120000
    },
    projects: [
        {
            name: 'local-e2e',
            testIgnore: /production-smoke\.spec\.js/,
            use: {
                ...devices['Desktop Chrome'],
                launchOptions: {
                    executablePath: process.env.PLAYWRIGHT_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
                }
            }
        },
        {
            name: 'production-smoke',
            testMatch: /production-smoke\.spec\.js/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: process.env.SMOKE_BASE_URL || 'https://logihero-backend.onrender.com',
                launchOptions: {
                    executablePath: process.env.PLAYWRIGHT_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
                }
            }
        }
    ]
});

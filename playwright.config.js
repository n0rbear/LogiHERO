const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/e2e',
    timeout: 60000,
    expect: { timeout: 10000 },
    reporter: [['list']],
    use: {
        baseURL: 'http://127.0.0.1:3100',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    webServer: process.env.LOGIHERO_E2E_EXTERNAL_SERVER ? undefined : {
        command: 'node scripts/e2e-server.js',
        url: 'http://127.0.0.1:3100/health',
        reuseExistingServer: false,
        timeout: 120000
    },
    projects: [
        {
            name: process.env.LOGIHERO_E2E_EXTERNAL_SERVER ? 'local-e2e' : 'local-e2e',
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

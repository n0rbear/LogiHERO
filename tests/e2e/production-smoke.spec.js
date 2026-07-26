const { test, expect } = require('@playwright/test');

test('production smoke read-only pages are reachable', async ({ page, baseURL }) => {
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => {
        if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
    });

    await page.goto(`${baseURL}/health`);
    await expect(page.locator('body')).toContainText('ok');

    await page.goto(`${baseURL}/version`);
    await expect(page.locator('body')).toContainText('logihero-backend');

    await page.goto(`${baseURL}/admin/work-time/weekly`);
    await expect(page).toHaveURL(/\/admin\/login/);
    expect(failures).toEqual([]);
});

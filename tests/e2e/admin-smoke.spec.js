const { test, expect } = require('@playwright/test');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'local-dev-admin-token';
const READ_ONLY_ADMIN_TOKEN = process.env.READ_ONLY_ADMIN_TOKEN || 'local-dev-read-only-token';

test.beforeEach(async ({ page }) => {
    const failures = [];

    page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().includes('favicon')) {
            failures.push(`console error: ${message.text()}`);
        }
    });
    page.on('pageerror', (error) => failures.push(`page error: ${error.message}`));
    page.on('response', (response) => {
        const url = response.url();
        if (response.status() >= 500 && !url.includes('favicon')) {
            failures.push(`${response.status()} response: ${url}`);
        }
    });
    page.on('requestfailed', (request) => {
        const url = request.url();
        if (!url.includes('favicon') && !url.includes('tile.openstreetmap.org')) {
            failures.push(`request failed: ${url}`);
        }
    });

    page.failures = failures;
});

test.afterEach(async ({ page }) => {
    expect(page.failures).toEqual([]);
});

async function login(page) {
    await page.goto('/admin/login');
    await page.locator('#token').fill(ADMIN_TOKEN);
    await page.locator('#loginForm button[type="submit"]').click();
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole('heading', { name: /Dashboard/i })).toBeVisible();
}

async function readOnlyLogin(page) {
    await page.goto('/admin/login');
    await page.locator('#token').fill(READ_ONLY_ADMIN_TOKEN);
    await page.locator('#loginForm button[type="submit"]').click();
    await expect(page).toHaveURL(/\/admin/);
}

test('admin production flow works in real Chromium', async ({ page }) => {
    await login(page);

    await page.goto('/admin');
    await expect(page.getByText(/Rendszer/)).toBeVisible();

    await page.goto('/admin/drivers');
    await expect(page.locator('table')).toBeVisible();
    await page.getByRole('button', { name: /\+.*sof/i }).click();
    await expect(page).toHaveURL(/\/admin\/drivers\/new/);

    const unique = Date.now();
    await page.locator('input[name="name"]').fill(`E2E Driver ${unique}`);
    await page.locator('input[name="email"]').fill(`e2e-${unique}@example.test`);
    await page.locator('input[name="phone"]').fill('+36 30 999 0000');
    await page.locator('input[name="whatsapp"]').fill('+36 30 999 0000');
    await page.locator('input[name="telegram"]').fill('@e2e_driver');
    await page.locator('input[name="license_plate"]').fill(`E2E-${String(unique).slice(-3)}`);
    await page.locator('#driverForm button[type="submit"]').click();
    await expect(page).toHaveURL(/\/admin\/drivers\/[0-9a-f-]+/i);
    await expect(page.getByRole('heading', { name: `E2E Driver ${unique}`, exact: true })).toBeVisible();

    await page.locator('input[name="phone"]').fill('+36 30 999 1111');
    await page.locator('#driverForm button[type="submit"]').click();
    await expect(page.getByText(/Sof.*r mentve/i)).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#code-area + div button').nth(1).click();
    await expect(page.locator('#code-area')).not.toHaveText(/^[•]+$/);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /Deaktiv/i }).click();
    await expect(page.getByText('Sofőr deaktiválva.')).toBeVisible();
    await page.waitForTimeout(800);

    await page.goto('/admin/hotels');
    await expect(page.locator('#hotel-map')).toBeVisible();
    await page.locator('#hotel-search').fill('Dev Hotel');
    await expect(page.locator('#hotel-list')).toContainText('LogiHERO Dev Hotel');
    await page.locator('#hotel-status').selectOption('CONFIRMED');
    await expect(page.locator('#hotel-list')).toContainText('LogiHERO Dev Hotel With Map');
    await page.locator('#hotel-list .hotel-card').first().click();
    await expect(page.getByRole('button', { name: /Szerkeszt/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Google Maps/i })).toBeVisible();
    await page.getByRole('button', { name: /Szerkeszt/i }).click();
    await page.locator('textarea[name="notes"]').fill(`E2E hotel note ${unique}`);
    await page.locator('#hotel-form button[type="submit"]').click();
    await expect(page.getByText(/Hotel mentve/i)).toBeVisible();

    await page.goto('/admin/cargo');
    await expect(page.locator('#cargo-list')).toBeVisible();
    await expect(page.locator('#cargo-list')).toContainText('Dev Pallet');
    await page.locator('#cargo-search').fill('DEV-CARGO-1');
    await expect(page.locator('#cargo-list')).toContainText('Dev Pallet');
    await page.locator('#cargo-list .cargo-card').first().click();
    await expect(page.locator('#cargo-detail')).toContainText('DEV-CARGO-1');
    await expect(page.locator('#cargo-detail')).toContainText('Serial');
    await page.getByRole('button', { name: /^Edit$/ }).click();
    const seededCargoTour = await page.locator('#cargo-form select[name="tour_id"]').inputValue();
    await page.getByRole('button', { name: /^Cancel$/ }).click();

    await page.getByRole('button', { name: /\+ Create Cargo/i }).click();
    await page.locator('#cargo-form select[name="tour_id"]').selectOption(seededCargoTour);
    await page.locator('#cargo-form input[name="name"]').fill(`E2E Cargo duplicate ${unique}`);
    await page.locator('#cargo-form input[name="serial_number"]').fill('DEV-CARGO-1');
    await page.locator('#cargo-form button[type="submit"]').click();
    await expect(page.locator('#cargo-form-message')).toContainText('DUPLICATE_SERIAL_IN_TOUR');
    page.failures = page.failures.filter((failure) => !failure.includes('409 (Conflict)'));

    const cargoName = `E2E Cargo ${unique}`;
    const cargoSerial = `E2E-CARGO-${unique}`;
    await page.locator('#cargo-form input[name="name"]').fill(cargoName);
    await page.locator('#cargo-form input[name="serial_number"]').fill(cargoSerial);
    await page.locator('#cargo-form input[name="external_reference"]').fill('E2E machine model');
    await page.locator('#cargo-form textarea[name="notes"]').fill(`E2E cargo note ${unique}`);
    await page.locator('#cargo-form button[type="submit"]').click();
    await expect(page.locator('#cargo-detail')).toContainText(cargoName);
    await expect(page.locator('#cargo-detail')).toContainText(cargoSerial);

    await page.getByRole('button', { name: /^Edit$/ }).click();
    await page.locator('#cargo-form textarea[name="notes"]').fill(`E2E cargo edited ${unique}`);
    await page.locator('#cargo-form button[type="submit"]').click();
    await expect(page.locator('#cargo-detail')).toContainText(`E2E cargo edited ${unique}`);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /Soft delete/i }).click();
    await expect(page.locator('#cargo-detail')).toContainText('Select cargo to inspect details.');

    await page.goto('/admin/work-time');
    await expect(page.getByRole('heading', { name: /Munkaido|Munkaidő/i })).toBeVisible();
    await page.locator('input[name="driver"]').fill('LogiHERO Dev Driver Active');
    await page.getByRole('button', { name: /Szures|Szűrés/i }).click();
    await expect(page.locator('table')).toContainText('LogiHERO Dev Driver Active');
    await page.locator('tbody tr').first().click();
    await expect(page.getByText(/Timeline/i)).toBeVisible();
    await page.locator('input[name="reason"]').first().fill(`E2E correction ${unique}`);
    await page.getByRole('button', { name: /Korrekcio|Korrekció/i }).first().click();
    await expect(page.getByText(/Korrekcio mentve|Korrekció mentve/i)).toBeVisible();
    await page.waitForTimeout(900);
    await expect(page.getByText(/Audit history/i)).toBeVisible();
    await page.getByRole('button', { name: /Jovahagyas|Jóváhagyás/i }).click();
    await expect(page.getByText(/Allapot mentve|Állapot mentve/i)).toBeVisible();

    await page.goto('/admin/drivers');
    await page.getByRole('row', { name: /LogiHERO Dev Driver Active/i }).getByRole('button', { name: /Adatlap/i }).click();
    await expect(page.locator('.rotate-device-token').first()).toBeVisible();
    await page.waitForTimeout(700);
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('.rotate-device-token').first().evaluate((button) => button.click());
    await expect(page.locator('#rotated-token-panel')).toBeVisible();
    const rotatedToken = await page.locator('#rotated-token-value').textContent();
    expect(rotatedToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(rotatedToken).not.toContain('dev-device-token-active-1');
    await page.reload();
    await expect(page.locator('#rotated-token-panel')).toBeHidden();

    await page.goto('/admin/work-time/weekly');
    await expect(page.locator('table')).toContainText('LogiHERO Dev Driver Active');
    await page.getByRole('link', { name: /Kovetkezo|Következő/i }).click();
    await expect(page.getByRole('heading', { name: /Heti|heti/i })).toBeVisible();
    await page.goto('/admin/work-time/weekly');
    await page.locator('table tbody tr').first().click();
    await expect(page.getByText(/Heti teljes/i)).toBeVisible();
    const csv = await page.request.get('/admin/work-time/export.csv');
    expect(csv.ok()).toBeTruthy();
    expect(await csv.text()).toContain('driver,date,start,end,total_ms');
    const json = await page.request.get('/admin/work-time/export.json');
    expect(json.ok()).toBeTruthy();
    expect((await json.json()).records.length).toBeGreaterThan(0);

    await page.goto('/admin/tours');
    await expect(page.locator('#tour-map')).toBeVisible();
    await expect(page.locator('#tours-list-container')).toContainText('LogiHERO Dev');
    await page.locator('#tours-list-container .tour-item').first().click();
    await expect(page.locator('#tour-details-card')).toBeVisible();

    await page.getByRole('button', { name: /Kijelentkez/i }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
});

test('read-only admin cannot write in real Chromium', async ({ page }) => {
    await readOnlyLogin(page);

    for (const path of ['/admin', '/admin/drivers', '/admin/hotels', '/admin/tours', '/admin/cargo', '/admin/work-time', '/admin/work-time/weekly']) {
        await page.goto(path);
        await expect(page.locator('body')).not.toContainText('Internal Server Error');
    }

    const denied = await page.request.post('/admin/work-time/bulk/approve', {
        data: { days: [] }
    });
    expect(denied.status()).toBe(403);

    await page.goto('/admin/drivers');
    await expect(page.locator('.rotate-device-token')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Token rotation');

    await page.goto('/admin/cargo');
    await expect(page.getByText('Read-only admin')).toBeVisible();
    await expect(page.getByRole('button', { name: /\+ Create Cargo/i })).toHaveCount(0);
    const deniedCargoCreate = await page.request.post('/api/tours/1/cargo', {
        data: { name: 'Read only denied cargo' }
    });
    expect(deniedCargoCreate.status()).toBe(403);

    const directRotate = await page.request.post('/admin/drivers/11111111-1111-4111-8111-111111111111/devices/dev-device-active-1/rotate-token');
    expect(directRotate.status()).toBe(403);

    await page.getByRole('button', { name: /Kijelentkez/i }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
});

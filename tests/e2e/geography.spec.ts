import { test, expect } from '@playwright/test';

function fixture() {
  const locations = [
    {
      id: 'chicago',
      countryCode: 'US',
      countryName: 'United States',
      region: 'Illinois',
      city: 'Chicago',
      latitude: 41.9,
      longitude: -87.6,
      accuracyLevel: 'city',
      totalEvents: 20,
      totalVisits: 12,
      uniqueUsers: 8,
      percentage: 50,
    },
    {
      id: 'london',
      countryCode: 'GB',
      countryName: 'United Kingdom',
      region: 'England',
      city: 'London',
      latitude: 51.5,
      longitude: -0.1,
      accuracyLevel: 'city',
      totalEvents: 10,
      totalVisits: 7,
      uniqueUsers: 5,
      percentage: 25,
    },
  ].map((l) => ({
    ...l,
    accuracyRadius: 25,
    firstSeen: '2026-10-01T01:00:00.000Z',
    lastSeen: '2026-10-01T02:00:00.000Z',
    previousEvents: 5,
    previousVisits: 3,
    previousUsers: 2,
    trend: 100,
    applications: ['Deck'],
    providers: ['github'],
    vpnEvents: null,
    proxyEvents: null,
    hostingEvents: null,
    torEvents: null,
  }));
  return {
    locations,
    summary: {
      totalEvents: 40,
      totalVisits: 25,
      geolocatedEvents: 30,
      totalLogins: 40,
      uniqueUsers: 15,
      geolocatedLogins: 30,
      coverage: 75,
      countries: 2,
      places: 2,
      unknownLocations: 10,
      newCountries: ['GB'],
      mostActiveLocation: 'Chicago',
    },
    granularity: 'city',
    enabled: true,
    sample: false,
    truncated: false,
    map: { darkStyle: '/geo-test-style.json', lightStyle: '/geo-test-style.json' },
  };
}
test.beforeEach(async ({ page }) => {
  // A local empty style isolates interaction tests from remote tile availability.
  await page.route('**/geo-test-style.json', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#172116' } }],
      },
    }),
  );
});
test('Login Geography shows its skeleton, empty and disabled states', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/api/login-geography?*', async (route) => {
    await pending;
    await route.fulfill({ json: { ...fixture(), locations: [] } });
  });
  await page.goto('/login-geography');
  await expect(page.getByLabel('Loading Login Geography')).toBeVisible();
  release();
  await expect(page.getByText('No geolocated logins in this range')).toBeVisible();
  await expect(page.getByText('Unknown · never plotted')).toBeVisible();
  await page.unroute('**/api/login-geography?*');
  await page.route('**/api/login-geography?*', (route) =>
    route.fulfill({ json: { ...fixture(), locations: [], enabled: false } }),
  );
  await page.reload();
  await expect(page.getByText('Login Geography is disabled')).toBeVisible();
});
test('Login Geography reports request failures and recovers on retry', async ({ page }) => {
  let failed = true;
  await page.route('**/api/login-geography?*', (route) =>
    failed
      ? route.fulfill({ status: 503, json: { error: 'Test provider unavailable' } })
      : route.fulfill({ json: fixture() }),
  );
  await page.goto('/login-geography');
  await expect(page.locator('.geography-view [role=alert]')).toContainText('Test provider unavailable');
  failed = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Top Locations', exact: true })).toBeVisible();
});
test('table selection focuses the map, aggregate details, modes, sorting and global filters work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const queries: URL[] = [];
  await page.route('**/api/login-geography?*', (route) => {
    queries.push(new URL(route.request().url()));
    return route.fulfill({ json: fixture() });
  });
  await page.goto('/login-geography?granularity=city');
  await expect(page.getByTestId('login-map')).toHaveAttribute('data-map-ready', 'true');
  await page.locator('.geo-table tbody tr').filter({ hasText: 'Chicago' }).click();
  await expect(page.getByTestId('login-map')).toHaveAttribute('data-selected-location', 'chicago');
  await expect(page.getByTestId('login-map')).toHaveAttribute('data-camera-center', '-87.6,41.9');
  await expect(page.locator('.geo-details')).toContainText('Chicago, Illinois, United States');
  await expect(page.locator('.geo-details')).toContainText('Deck');
  await expect(page.locator('.geo-details')).toContainText('Unavailable');
  await page.getByRole('button', { name: 'Login density', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Login density', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('Login measure').selectOption('users');
  await expect.poll(() => queries.at(-1)?.searchParams.get('metric')).toBe('users');
  await page.getByLabel('Date range').selectOption('30d');
  await expect(page).toHaveURL(/range=30d/);
  await expect
    .poll(() => {
      const q = queries.at(-1);
      return q
        ? Math.round((Date.parse(q.searchParams.get('to')!) - Date.parse(q.searchParams.get('from')!)) / 86400000)
        : 0;
    })
    .toBe(30);
  expect(queries.at(-1)?.searchParams.get('metric')).toBe('users');
  await page.getByLabel('Login environment').selectOption('production');
  await expect.poll(() => queries.at(-1)?.searchParams.get('environment')).toBe('production');
  await page.getByLabel('Login result').selectOption('failure');
  await expect.poll(() => queries.at(-1)?.searchParams.get('success')).toBe('failure');
  await page.getByRole('button', { name: /^Login events/ }).click();
  await expect(page.locator('.geo-table tbody tr').first()).toContainText('London');
  await page.getByRole('button', { name: 'Reset map view' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
test('map style failure preserves the table and aggregate privacy', async ({ page }) => {
  await page.route('**/api/login-geography?*', (route) => route.fulfill({ json: fixture() }));
  await page.unroute('**/geo-test-style.json');
  await page.route('**/geo-test-style.json', (route) => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.goto('/login-geography?granularity=city');
  await expect(page.locator('.geography-view [role=alert]')).toContainText('Map tiles are unavailable');
  await page.locator('.geo-table tbody tr').filter({ hasText: 'London' }).click();
  await expect(page.locator('.geo-details')).toContainText('United Kingdom');
  await expect(page.locator('.geography-view')).not.toContainText('sourceIp');
});

test('Event Geography defaults to all events and preserves event filters, login scope, exports and saved views', async ({
  page,
}) => {
  const queries: URL[] = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/geography?*', (route) => {
    queries.push(new URL(route.request().url()));
    return route.fulfill({ json: fixture() });
  });
  await page.goto('/geography?granularity=city');
  await expect(page.getByRole('heading', { name: 'Event Geography', exact: true })).toBeVisible();
  await expect(page.getByLabel('Event scope')).toHaveValue('all');
  await expect(page.getByText('40 total events')).toBeVisible();
  await expect(page.getByTestId('login-map')).toHaveAttribute('data-map-ready', 'true');
  await page.getByLabel('Event name', { exact: true }).fill('checkout_completed');
  await page.getByLabel('Event name', { exact: true }).press('Enter');
  await expect.poll(() => queries.at(-1)?.searchParams.get('event')).toBe('checkout_completed');
  await page.getByLabel('Date range').selectOption('30d');
  await expect(page).toHaveURL(/event=checkout_completed/);
  await page.getByLabel('Event scope').selectOption('logins');
  await expect.poll(() => queries.at(-1)?.searchParams.get('scope')).toBe('logins');
  await expect.poll(() => queries.at(-1)?.searchParams.get('success')).toBe('all');
  await page.getByLabel('Event scope').selectOption('all');
  await expect.poll(() => queries.at(-1)?.searchParams.get('scope')).toBe('events');
  await page.getByLabel('Event name', { exact: true }).fill('');
  await page.getByLabel('Event name', { exact: true }).press('Enter');
  await expect.poll(() => queries.at(-1)?.searchParams.has('event')).toBe(false);
  await page.getByRole('button', { name: 'Event density', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Event density', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('Save current view').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('View name').fill('All-event geography');
  await dialog.getByRole('button', { name: 'Save this view', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await (await page.request.get('/api/data?view=saved')).json();
  const row = saved.rows.find((r: { name: string }) => r.name === 'All-event geography');
  expect(row.view_type).toBe('geography');
  expect(JSON.parse(row.filters_json).scope).toBe('events');
  const download = page.waitForEvent('download');
  await page.getByLabel('Export CSV').click();
  expect((await download).suggestedFilename()).toBe('house-edge-geography.csv');
  expect(errors).toEqual([]);
});

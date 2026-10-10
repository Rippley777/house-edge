import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('stored Cloudflare page views render as aggregate visitor markers and respond to existing controls', async ({
  page,
}) => {
  const origin = 'http://127.0.0.1:4318';
  const projectKey = `cf-${randomUUID()}`;
  const projectResponse = await page.request.post('/api/projects', {
    headers: { origin },
    data: {
      name: 'Synthetic Cloudflare map',
      projectKey,
      domain: 'fixture.example',
      origins: ['https://fixture.example'],
      environment: 'development',
    },
  });
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json();
  const keyResponse = await page.request.post('/api/keys', {
    headers: { origin },
    data: { projectId: project.id, scope: 'server' },
  });
  expect(keyResponse.ok()).toBeTruthy();
  const { key } = await keyResponse.json();
  const names = ['Fort Worth', 'Dallas', 'New York', 'Los Angeles', 'London', 'Sydney', 'Tokyo'];
  const locations = [
    ['US', 'Texas', 32.8, -97.3],
    ['US', 'Texas', 32.8, -96.8],
    ['US', 'New York', 40.7, -74],
    ['US', 'California', 34.1, -118.2],
    ['GB', 'England', 51.5, -0.1],
    ['AU', 'New South Wales', -33.9, 151.2],
    ['JP', 'Tokyo', 35.7, 139.7],
  ];
  const events = locations.flatMap(([country, region, latitude, longitude], i) => {
    const event = {
      id: randomUUID(),
      sessionId: `session-${i}`,
      anonymousId: `visitor-${i}`,
      event: 'page_view',
      timestamp: new Date().toISOString(),
      location: { version: 1, source: 'cloudflare', country, region, latitude, longitude, city: names[i] },
      properties: { synthetic: true },
    };
    return [
      event,
      { ...event, id: randomUUID(), anonymousId: `second-${i}`, sessionId: `second-${i}` },
      { ...event, id: randomUUID(), sessionId: `return-${i}`, anonymousId: `third-${i}` },
      { ...event, id: randomUUID(), event: 'session_start' },
    ];
  });
  const send = () => page.request.post('/api/collect', { data: { projectKey, key, events } });
  expect(await (await send()).json()).toEqual({ accepted: 28, duplicates: 0 });
  expect(await (await send()).json()).toEqual({ accepted: 0, duplicates: 28 });
  // Only the basemap is local; events, persistence and the geography API are real.
  await page.route('https://tiles.openfreemap.org/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#172116' } }],
      },
    }),
  );
  await page.goto(`/geography?project=${project.id}&scope=visits&metric=visits&granularity=city`);
  await expect(page.getByTestId('login-map')).toHaveAttribute('data-map-ready', 'true');
  await expect(page.getByLabel('Event scope')).toHaveValue('visits');
  await expect(page.getByLabel('Event measure')).toHaveValue('visits');
  await expect(page.locator('.geo-table tbody tr')).toHaveCount(7);
  await expect(page.locator('.summary-card').filter({ hasText: 'Total visits' }).locator('strong')).toHaveText('21');
  await expect(page.locator('.summary-card').filter({ hasText: 'Unique visitors' }).locator('strong')).toHaveText('21');
  await page.locator('.geo-table tbody tr').filter({ hasText: 'Fort Worth' }).click();
  await expect(page.getByTestId('login-map')).toHaveAttribute('data-camera-center', '-97.3,32.8');
  await expect(page.locator('.geo-details')).toContainText('city-level estimate');
  await expect(page.getByText('Approximate network locations · GPS is never collected')).toBeVisible();
  await page.getByLabel('Map granularity').selectOption('region');
  await expect(page.locator('.geo-table tbody tr')).toHaveCount(6);
  await page.getByLabel('Map granularity').selectOption('country');
  await expect(page.locator('.geo-table tbody tr')).toHaveCount(4);
  await page.getByLabel('Event measure').selectOption('users');
  await expect(page).toHaveURL(/metric=users/);
  await page.getByLabel('Date range').selectOption('30d');
  await expect(page).toHaveURL(/metric=users/);
  await expect(page).toHaveURL(/scope=visits/);
  await expect(page.locator('.geo-table tbody tr')).toHaveCount(4);
  const api = await (
    await page.request.get(`/api/geography?project=${project.id}&scope=visits&metric=visits&granularity=city`)
  ).json();
  expect(api.summary).toMatchObject({ totalEvents: 21, totalVisits: 21, uniqueUsers: 21, countries: 4 });
  await page.screenshot({ path: 'test-results/cloudflare-geography.png', fullPage: true });
});

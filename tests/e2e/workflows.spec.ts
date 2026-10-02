import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const origin = 'http://127.0.0.1:4318';
const headers = { origin };
async function createProject(request: APIRequestContext) {
  const suffix = randomUUID().slice(0, 8);
  const response = await request.post('/api/projects', { headers, data: { name: `SDK test ${suffix}`, projectKey: `sdk-test-${suffix}`, domain: '127.0.0.1:4318', origins: [origin], environment: 'development' } });
  expect(response.status()).toBe(201);
  return await response.json() as { id: string; key: string; projectKey: string };
}

test('overview filters, project drilldown, event inspector, and session journey work', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.getByText('Ecosystem activity', { exact: true })).toBeVisible();
  await expect(page.locator('.metric-card')).toHaveCount(4);
  await page.getByLabel('Date range').selectOption('30d');
  await expect(page).toHaveURL(/range=30d/);
  await page.locator('.project-table tbody tr').filter({ hasText: 'Repo Reaper' }).click();
  await expect(page.getByRole('heading', { name: 'Repo Reaper', exact: true })).toBeVisible();
  await expect(page.locator('.project-table tbody tr')).toHaveCount(1);
  await page.getByRole('link', { name: 'Events', exact: true }).click();
  await expect(page).toHaveURL(/\/events\?/);
  await expect(page.getByPlaceholder('Search events, routes, users, or versions…')).toBeVisible();
  await page.locator('.view-content .data-table tbody tr.clickable').first().click();
  await expect(page.getByRole('dialog', { name: 'Event details' })).toBeVisible();
  await expect(page.getByText('event properties · JSON')).toBeVisible();
  await page.getByRole('button', { name: 'Explore session' }).click();
  await expect(page.getByRole('heading', { name: 'Session Explorer', exact: true })).toBeVisible();
  await page.locator('.data-table tbody tr').first().click();
  await expect(page.getByRole('dialog', { name: 'Session journey' })).toBeVisible();
  await expect(page.locator('.timeline-item').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('all analytical views render without runtime errors or failed queries', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  for (const path of ['projects', 'live', 'geography', 'login-geography', 'users', 'journeys', 'funnels', 'retention', 'features', 'errors', 'performance', 'releases', 'health', 'anomalies', 'pulse', 'graveyard', 'rising', 'compare', 'ecosystem', 'relationships', 'heatmap', 'snapshot', 'saved', 'alerts', 'keys', 'settings', 'docs']) {
    await page.goto(`/${path}`);
    await expect(page.locator('.view-content')).toBeVisible();
    await expect(page.locator('.loading-state')).toHaveCount(0);
    await expect(page.locator('.error-banner')).toHaveCount(0);
    expect(errors, `Runtime errors on ${path}`).toEqual([]);
  }
});

test('project creation shows a one-time key and persists the project', async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  await page.goto('/'); await page.getByRole('button', { name: 'Add project', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project name', { exact: true }).fill(`New App ${suffix}`);
  await dialog.getByLabel('Application domain').fill('new-app.example');
  await dialog.getByRole('button', { name: 'Connect a project', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'You’re in the house.' })).toBeVisible();
  await expect(dialog.locator('code').filter({ hasText: 'houseEdge.init' })).toContainText('he_pk_');
  await dialog.getByRole('button', { name: 'Open project' }).click();
  await expect(page.getByRole('heading', { name: `New App ${suffix}`, exact: true })).toBeVisible();
});

test('live feed pauses and resumes; command palette searches projects', async ({ page }) => {
  await page.goto('/live');
  await page.getByRole('button', { name: 'Pause feed' }).click();
  await expect(page.getByText('Feed paused. Your place is held.')).toBeVisible();
  await page.getByRole('button', { name: 'Resume feed' }).click();
  await expect(page.getByText(/Listening for events/)).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search your workspace' }); await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Projects, events, sessions, releases…').fill('Repo Reaper');
  await dialog.getByRole('button', { name: 'RR Repo Reaper reporeaper.dev', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Repo Reaper', exact: true })).toBeVisible();
});

test('browser script collects real events, navigation and redacts secrets', async ({ page, request }) => {
  const project = await createProject(request);
  await page.route('**/sdk-host*', route => route.fulfill({ contentType: 'text/html', body: `<html><body>SDK host<script src="/house-edge.js" data-project="${project.projectKey}" data-key="${project.key}"></script></body></html>` }));
  await page.goto('/sdk-host?token=secret#private');
  await page.waitForFunction(() => !!(window as unknown as { houseEdge?: unknown }).houseEdge);
  await page.evaluate(async () => {
    const sdk = (window as unknown as { houseEdge: { track: (name: string, props: object) => void; identify: (id: string) => void; flush: () => Promise<void> } }).houseEdge;
    sdk.identify('opaque-user-42');
    sdk.track('repository_analyzed', { language: 'Rust', password: 'never-store', nested: { access_token: 'never-store', result: 'ok' }, durationMs: 1421 });
    history.pushState({}, '', '/sdk-next?authorization=secret');
    await sdk.flush();
  });
  const response = await request.get(`/api/data?view=events&project=${project.id}`); const data = await response.json();
  expect(data.rows.some((e: { event_name: string }) => e.event_name === 'page_view')).toBe(true);
  expect(data.rows.some((e: { event_name: string }) => e.event_name === 'session_start')).toBe(true);
  const event = data.rows.find((e: { event_name: string }) => e.event_name === 'repository_analyzed');
  expect(event.duration_ms).toBe(1421); expect(event.user_id).toBe('opaque-user-42');
  expect(JSON.stringify(data)).not.toContain('never-store'); expect(event.path).toBe('/sdk-host');
  expect(data.rows.find((e: { path: string }) => e.path === '/sdk-next')).toBeTruthy();
});

test('collector retries are idempotent and rotated keys stop working', async ({ request }) => {
  const project = await createProject(request);
  const batch = { projectKey: project.projectKey, key: project.key, events: [{ id: randomUUID(), event: 'conversion', sessionId: 's', anonymousId: 'a', timestamp: new Date().toISOString(), properties: {} }] };
  expect((await request.post('/api/collect', { headers, data: batch })).status()).toBe(202);
  const retry = await request.post('/api/collect', { headers, data: batch }); expect(await retry.json()).toEqual({ accepted: 0, duplicates: 1 });
  const keyRows = (await (await request.get('/api/data?view=keys')).json()).rows;
  const previous = keyRows.find((r: { project_id: string; revoked_at: string | null }) => r.project_id === project.id && !r.revoked_at);
  const rotation = await request.post('/api/keys', { headers, data: { projectId: project.id, revokeId: previous.id, scope: 'ingest' } }); expect(rotation.ok()).toBe(true);
  expect((await request.post('/api/collect', { headers, data: batch })).status()).toBe(401);
  const { key } = await rotation.json();
  expect((await request.post('/api/collect', { headers, data: { ...batch, key, events: [{ ...batch.events[0], id: randomUUID() }] } })).status()).toBe(202);
});

test('mobile navigation and overview fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByText('Ecosystem activity', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
  await page.getByRole('link', { name: 'Projects', exact: false }).first().click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await expect(page.locator('.sidebar')).not.toHaveClass(/mobile-open/);
});

import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

// Browser harness only: real SDK, HTTP collector, SQLite, aggregation and dashboard.
// This deliberately does not claim to verify the deployed consumer applications.
test('two real browser sessions persist page views and synthetic errors in isolated dashboards', async ({
  page,
}, testInfo) => {
  const origin = 'http://127.0.0.1:4318';
  const evidence: unknown[] = [];
  const projects: { id: string; key: string; projectKey: string }[] = [];
  for (const name of ['Stacked Deck loop', 'Rippley Labs loop']) {
    const response = await page.request.post('/api/projects', {
      headers: { origin },
      data: {
        name,
        projectKey: `loop-${randomUUID()}`,
        domain: '127.0.0.1:4318',
        origins: [origin],
        environment: 'development',
      },
    });
    expect(response.status()).toBe(201);
    projects.push(await response.json());
  }
  for (const [i, project] of projects.entries()) {
    const path = `/loop-fixture-${i}`;
    await page.route(
      (url) => url.pathname.startsWith(path),
      (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><title>Analytics verification</title><h1>Local SDK visit</h1><script src="/house-edge.js" data-project="${project.projectKey}" data-key="${project.key}"></script>`,
        }),
    );
    const responses: { status: number; body: unknown }[] = [];
    const firstResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/collect') && response.request().method() === 'POST',
    );
    await page.goto(path);
    await page.evaluate(() => window.houseEdge.flush());
    const first = await firstResponse;
    expect(first.status()).toBe(202);
    responses.push({
      status: first.status(),
      body: 'Browser keepalive response body unavailable to Playwright; persistence checked below',
    });
    const navigationResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/collect') && response.request().method() === 'POST',
    );
    await page.evaluate(async () => {
      history.pushState({}, '', location.pathname + '/second');
      history.replaceState({}, '', location.pathname + '?token=should-never-persist');
      window.houseEdge.error(new Error('Synthetic loop verification item 123'), { synthetic: true });
      window.houseEdge.error(new Error('Synthetic loop verification item 456'), { synthetic: true });
      await window.houseEdge.flush();
    });
    const navigation = await navigationResponse;
    expect(navigation.status()).toBe(202);
    responses.push({
      status: navigation.status(),
      body: 'Browser keepalive response body unavailable to Playwright; persistence checked below',
    });
    await page.reload();
    await page.evaluate(() => window.houseEdge.flush());
    const data = await (await page.request.get(`/api/data?view=events&project=${project.id}`)).json();
    const views = data.rows.filter((e: { event_name: string }) => e.event_name === 'page_view');
    expect(views).toHaveLength(3);
    expect(new Set(views.map((e: { session_id: string }) => e.session_id)).size).toBe(1);
    expect(views.every((e: { received_at?: string }) => !!e.received_at)).toBeTruthy();
    expect(JSON.stringify(data)).not.toContain('should-never-persist');
    const row = views[0];
    const duplicate = await page.request.post('/api/collect', {
      headers: { origin },
      data: {
        projectKey: project.projectKey,
        key: project.key,
        events: [
          {
            id: row.id,
            event: 'page_view',
            timestamp: row.timestamp,
            sessionId: row.session_id,
            anonymousId: row.anonymous_id,
          },
        ],
      },
    });
    const duplicateBody = await duplicate.json();
    expect(duplicateBody).toEqual({ accepted: 0, duplicates: 1 });
    responses.push({ status: duplicate.status(), body: duplicateBody });
    const mismatch = await page.request.post('/api/collect', {
      headers: { origin },
      data: {
        projectKey: projects[1 - i].projectKey,
        key: project.key,
        events: [
          {
            id: randomUUID(),
            event: 'page_view',
            timestamp: new Date().toISOString(),
            sessionId: 'test',
            anonymousId: 'test',
          },
        ],
      },
    });
    expect(mismatch.status()).toBe(401);
    const other = await (await page.request.get(`/api/data?view=events&project=${projects[1 - i].id}`)).json();
    expect(other.rows.some((e: { id: string }) => views.some((v: { id: string }) => v.id === e.id))).toBe(false);
    const errors = await (await page.request.get(`/api/data?view=errors&project=${project.id}`)).json();
    expect(errors.summary.occurrences).toBe(2);
    expect(errors.summary.issues).toBe(1);
    expect(errors.summary.affectedSessions).toBe(1);
    await page.evaluate(() => window.houseEdge.destroy());
    await page.goto(`/projects?project=${project.id}`);
    await expect(
      page.getByRole('heading', { name: i === 0 ? 'Stacked Deck loop' : 'Rippley Labs loop', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Top pages', exact: true })).toBeVisible();
    await expect(page.getByText(path, { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`project-${i}.png`), fullPage: true });

    evidence.push({
      verifiedAt: new Date().toISOString(),
      environment: 'isolated local SDK harness',
      projectId: project.id,
      projectKey: project.projectKey,
      events: views.map((e: Record<string, unknown>) => ({
        eventId: e.id,
        timestamp: e.timestamp,
        receivedAt: e.received_at,
        path: e.path,
        geography: e.geo_enrichment_status || 'unknown',
      })),
      responses,
      duplicate: 'idempotent',
      mismatchStatus: mismatch.status(),
      dashboard: 'confirmed',
      productionVerified: false,
    });
  }
  const evidencePath = testInfo.outputPath('verification.json');
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  await testInfo.attach('analytics-loop-evidence', { path: evidencePath, contentType: 'application/json' });
});

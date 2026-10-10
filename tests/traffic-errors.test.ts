import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect, migrate, createProject, ingest, type Connection } from '@house-edge/database';
import type { AnalyticsEvent, Project, Filters } from '@house-edge/shared';
import { series, viewData } from '@house-edge/engine';
import { trafficBreakdowns } from '../packages/analytics-engine/src/traffic';
let db: Connection, a: Project, b: Project;
const f: Filters = { from: '2026-10-08T00:00:00.000Z', to: '2026-10-08T23:59:59.999Z' };
const event = (props: Partial<AnalyticsEvent> = {}): AnalyticsEvent => ({
  id: randomUUID(),
  event: 'page_view',
  timestamp: '2026-10-08T12:00:00.000Z',
  sessionId: 'session',
  anonymousId: 'visitor',
  properties: {},
  path: '/home',
  browser: 'Firefox',
  ...props,
});
beforeEach(async () => {
  db = await connect({ provider: 'sqlite', filename: ':memory:' });
  await migrate(db);
  for (const key of ['alpha', 'beta'])
    await createProject(db, {
      name: key,
      projectKey: key,
      domain: `${key}.example`,
      origins: [`https://${key}.example`],
      environment: 'production',
    });
  [a, b] = await db.query<Project>('SELECT * FROM projects ORDER BY project_key');
  (globalThis as unknown as { houseEdgeDb: Promise<Connection> }).houseEdgeDb = Promise.resolve(db);
});
afterEach(async () => {
  await db.close();
  delete (globalThis as unknown as { houseEdgeDb?: unknown }).houseEdgeDb;
});

test('traffic breakdowns, returning visitors and hourly series preserve project boundaries', async () => {
  await ingest(db, a, [
    event({ timestamp: '2026-10-07T12:00:00.000Z' }),
    event({ referrer: 'https://source.example/private?token=secret' }),
    event({ anonymousId: 'new', sessionId: 'new' }),
  ]);
  await ingest(db, b, [event({ path: '/beta-only' })]);
  await db.execute(
    "UPDATE events SET referrer = 'https://source.example/legacy-path' WHERE project_id = @project AND referrer <> ''",
    { project: a.id },
  );
  const traffic = await trafficBreakdowns(db, { ...f, project: a.id });
  assert.equal(traffic.newVisitors, 1);
  assert.equal(traffic.returningVisitors, 1);
  assert.deepEqual(traffic.pages, [{ label: '/home', count: 2 }]);
  assert.ok(!JSON.stringify(traffic).includes('beta-only'));
  assert.ok(traffic.referrers.some((row) => row.label === 'https://source.example'));
  const points = await series(db, f);
  assert.equal(points.length, 24);
  assert.equal(points[0].users, 0);
  assert.equal(points[12].users, 3);
  assert.equal(points[12].sessions, 3);
});

test('errors group variable IDs, separate synthetic incidents and count distinct affected sessions', async () => {
  const error = (message: string, props = {}) =>
    event({ event: 'error', properties: { name: 'TypeError', message, ...props } });
  await ingest(db, a, [
    event(),
    event({ sessionId: 'healthy' }),
    error('Failed item 123', { version: 'ignored' }),
    error('Failed item 456'),
    error('Different failure'),
    error('Failed item 123', { synthetic: true }),
  ]);
  await ingest(db, b, [error('Beta secret failure')]);
  const data = await viewData('errors', { ...f, project: a.id });
  assert.equal(data.summary?.issues, 3);
  assert.equal(data.summary?.occurrences, 4);
  assert.equal(data.summary?.affectedSessions, 1);
  assert.equal(data.summary?.activeSessions, 2);
  assert.equal(data.summary?.affectedSessionRate, 50);
  assert.equal(data.rows[0].occurrences, 2);
  assert.ok(data.rows.every((row) => row.project_id === a.id));
  assert.ok(!JSON.stringify(data).includes('Beta secret failure'));
});

test('legacy stored error text is scrubbed on dashboard and event reads', async () => {
  const e = event({ event: 'error' });
  await ingest(db, a, [e]);
  await db.execute('UPDATE events SET properties_json = @properties WHERE id = @id', {
    id: e.id,
    properties: JSON.stringify({
      message: 'Legacy token=private-value person@example.com',
      stack: 'at https://example.com/app.js?secret=hidden',
      token: 'private',
    }),
  });
  for (const view of ['errors', 'events']) {
    const data = JSON.stringify(await viewData(view, { ...f, project: a.id }));
    for (const value of ['private-value', 'person@example.com', 'hidden']) assert.ok(!data.includes(value), value);
  }
});

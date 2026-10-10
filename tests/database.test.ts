import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  connect,
  createProject,
  consumeRateLimit,
  hashKey,
  ingest,
  migrate,
  type Connection,
} from '@house-edge/database';
import { metrics } from '@house-edge/engine';
import type { AnalyticsEvent, Project } from '@house-edge/shared';
let db: Connection;
let project: Project;
beforeEach(async () => {
  db = await connect({ provider: 'sqlite', filename: ':memory:' });
  await migrate(db);
  const created = await createProject(db, {
    name: 'Test app',
    projectKey: 'test-app',
    domain: 'example.com',
    origins: ['https://example.com'],
    environment: 'production',
  });
  [project] = await db.query<Project>('SELECT * FROM projects WHERE id = @id', { id: created.id });
});
afterEach(async () => db.close());
function event(overrides: Partial<AnalyticsEvent> = {}): AnalyticsEvent {
  return {
    id: randomUUID(),
    event: 'page_view',
    sessionId: 'session-a',
    anonymousId: 'visitor-a',
    timestamp: '2026-09-29T12:00:00.000Z',
    path: '/?token=secret',
    referrer: 'https://example.org/?token=secret',
    properties: { token: 'private', nested: { password: 'private', language: 'Rust' } },
    ...overrides,
  };
}

test('ingestion is idempotent and all projections agree after a retry', async () => {
  const e = event();
  assert.deepEqual(await ingest(db, project, [e]), { accepted: 1, duplicates: 0 });
  assert.deepEqual(await ingest(db, project, [e]), { accepted: 0, duplicates: 1 });
  const [session] = await db.query<{ event_count: number; page_views: number }>('SELECT * FROM sessions');
  const [rollup] = await db.query<{ events: number; users: number; sessions: number }>('SELECT * FROM daily_rollups');
  assert.equal(session.event_count, 1);
  assert.equal(session.page_views, 1);
  assert.deepEqual(
    { events: rollup.events, users: rollup.users, sessions: rollup.sessions },
    { events: 1, users: 1, sessions: 1 },
  );
});
test('ingestion removes sensitive nested properties, queries and fragments', async () => {
  await ingest(db, project, [event()]);
  const [row] = await db.query<{ path: string; referrer: string; properties_json: string }>('SELECT * FROM events');
  assert.equal(row.path, '/');
  assert.equal(row.referrer, 'https://example.org');
  assert.deepEqual(JSON.parse(row.properties_json), { nested: { language: 'Rust' } });
});
test('out-of-order events preserve session boundaries and update identification', async () => {
  await ingest(db, project, [
    event({ timestamp: '2026-09-29T12:01:00.000Z', path: '/end' }),
    event({ path: '/start', userId: 'opaque-123' }),
  ]);
  const [session] = await db.query<{ duration_ms: number; landing_page: string; exit_page: string; user_id: string }>(
    'SELECT * FROM sessions',
  );
  assert.equal(session.duration_ms, 60000);
  assert.equal(session.landing_page, '/start');
  assert.equal(session.exit_page, '/end');
  assert.equal(session.user_id, 'opaque-123');
  const [user] = await db.query<{ total_sessions: number; total_events: number }>('SELECT * FROM analytics_users');
  assert.equal(user.total_sessions, 1);
  assert.equal(user.total_events, 2);
});
test('simultaneous duplicate batches cannot double-count the event', async () => {
  const e = event();
  const results = await Promise.all([ingest(db, project, [e]), ingest(db, project, [e]), ingest(db, project, [e])]);
  assert.equal(
    results.reduce((n, r) => n + r.accepted, 0),
    1,
  );
  const [row] = await db.query<{ events: number }>('SELECT events FROM daily_rollups');
  assert.equal(row.events, 1);
});
test('session and visitor identities are scoped per project', async () => {
  const created = await createProject(db, {
    name: 'Second',
    projectKey: 'second',
    domain: 'second.com',
    origins: ['https://second.com'],
    environment: 'production',
  });
  const [second] = await db.query<Project>('SELECT * FROM projects WHERE id = @id', { id: created.id });
  await ingest(db, project, [event()]);
  await ingest(db, second, [event()]);
  const result = await metrics(db, { from: '2026-09-29T00:00:00.000Z', to: '2026-09-29T23:59:59.999Z' });
  assert.equal(result.users, 2);
  assert.equal(result.sessions, 2);
  assert.equal(result.events, 2);
});
test('metrics use exact partial-day boundaries and do not expose future duration', async () => {
  await ingest(db, project, [
    event(),
    event({ timestamp: '2026-09-29T12:01:00.000Z' }),
    event({ timestamp: '2026-09-29T12:03:00.000Z' }),
  ]);
  const result = await metrics(db, {
    project: project.id,
    from: '2026-09-29T12:00:00.000Z',
    to: '2026-09-29T12:01:00.000Z',
  });
  assert.equal(result.events, 2);
  assert.equal(result.users, 1);
  assert.ok(Math.abs(result.avgDuration - 60000) < 1);
});
test('transaction rollback keeps events and projections atomic', async () => {
  const original = db.execute;
  db.execute = async (statement, params) => {
    if (statement.startsWith('INSERT INTO sessions')) throw new Error('Simulated projection failure');
    return original(statement, params);
  };
  await assert.rejects(() => ingest(db, project, [event()]), /Simulated/);
  const [count] = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM events');
  assert.equal(count.n, 0);
});
test('rate limits are durable and reject over-budget concurrent writes', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => consumeRateLimit(db, 'test', 1, 5)));
  assert.equal(results.filter(Boolean).length, 5);
});
test('keys are stored only as hashes and project creation is audited', async () => {
  const created = await createProject(db, {
    name: 'Keys app',
    projectKey: 'keys-app',
    domain: 'keys.com',
    origins: ['https://keys.com'],
    environment: 'development',
  });
  const [key] = await db.query<{ key_hash: string; prefix: string }>('SELECT * FROM api_keys WHERE project_id = @id', {
    id: created.id,
  });
  assert.equal(key.key_hash, hashKey(created.key));
  assert.notEqual(key.key_hash, created.key);
  assert.equal(key.prefix.length, 14);
  const [audit] = await db.query<{ action: string }>('SELECT action FROM audit_logs WHERE target = @id', {
    id: created.id,
  });
  assert.equal(audit.action, 'project.created');
});

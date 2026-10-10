import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { collect, collectorOptions } from '@house-edge/collector';
import { connect, createProject, issueKey, migrate, type Connection } from '@house-edge/database';
let db: Connection;
let key: string;
let projectId: string;
beforeEach(async () => {
  db = await connect({ provider: 'sqlite', filename: ':memory:' });
  await migrate(db);
  const created = await createProject(db, {
    name: 'Collector test',
    projectKey: 'test',
    domain: 'allowed.com',
    origins: ['https://allowed.com'],
    environment: 'production',
  });
  key = created.key;
  projectId = created.id;
  (globalThis as unknown as { houseEdgeDb: Promise<Connection> }).houseEdgeDb = Promise.resolve(db);
});
afterEach(async () => {
  await db.close();
  delete (globalThis as unknown as { houseEdgeDb?: Promise<Connection> }).houseEdgeDb;
});
const event = () => ({
  id: randomUUID(),
  event: 'page_view',
  sessionId: 's',
  anonymousId: 'a',
  timestamp: new Date().toISOString(),
  properties: {},
});
function request(origin: string | null = 'https://allowed.com', overrides: object = {}) {
  return new Request('https://analytics.example/api/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ projectKey: 'test', key, events: [event()], ...overrides }),
  });
}
test('collector accepts allowed origins and returns exact CORS response', async () => {
  const response = await collect(request());
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://allowed.com');
  assert.deepEqual(await response.json(), { accepted: 1, duplicates: 0 });
});
test('browser keys reject missing, foreign and null origins', async () => {
  for (const origin of [null, 'null', 'https://allowed.com.evil.test', 'https://evil.test'])
    assert.equal((await collect(request(origin))).status, 403);
});
test('server keys accept origin-less ingestion and reject browser origins', async () => {
  key = await db.transaction((tx) => issueKey(tx, projectId, 'server'));
  assert.equal((await collect(request(null))).status, 202);
  assert.equal((await collect(request())).status, 403);
});
test('revoked keys are immediately rejected', async () => {
  await db.execute('UPDATE api_keys SET revoked_at = @now', { now: new Date().toISOString() });
  assert.equal((await collect(request())).status, 401);
});
test('invalid timestamps, oversized bodies and malformed events cannot be ingested', async () => {
  assert.equal(
    (await collect(request('https://allowed.com', { events: [{ ...event(), timestamp: '2020-01-01T00:00:00.000Z' }] })))
      .status,
    400,
  );
  assert.equal((await collect(request('https://allowed.com', { events: [{ ...event(), id: 'bad-id' }] }))).status, 400);
  const large = new Request('https://example.test', { method: 'POST', body: 'x'.repeat(65537) });
  assert.equal((await collect(large)).status, 413);
  const [{ n }] = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM events');
  assert.equal(n, 0);
});
test('preflight only allows configured origins', async () => {
  assert.equal(
    (
      await collectorOptions(
        new Request('https://collector.test', { method: 'OPTIONS', headers: { origin: 'https://allowed.com' } }),
      )
    ).status,
    204,
  );
  assert.equal(
    (
      await collectorOptions(
        new Request('https://collector.test', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }),
      )
    ).status,
    403,
  );
});

test('project credentials cannot be mismatched or used to read dashboards', async () => {
  const other = await createProject(db, {
    name: 'Other app',
    projectKey: 'other',
    domain: 'allowed.com',
    origins: ['https://allowed.com'],
    environment: 'production',
  });
  assert.equal((await collect(request(undefined, { projectKey: 'other' }))).status, 401);
  assert.equal((await collect(request(undefined, { key: 'invalid-key-012345678901234' }))).status, 401);
  const original = process.env.DEMO_MODE;
  const admin = process.env.ADMIN_KEY;
  process.env.DEMO_MODE = 'false';
  process.env.ADMIN_KEY = 'test-admin-key-that-is-not-an-ingestion-key';
  try {
    const { GET } = await import('../apps/dashboard/app/api/[...path]/route');
    for (const path of ['overview', 'projects', 'data', 'geography', 'session', 'export']) {
      const response = await GET(
        new Request(`https://analytics.example/api/${path}?project=${other.id}`, {
          headers: { Authorization: `Bearer ${key}` },
        }),
        { params: Promise.resolve({ path: [path] }) },
      );
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  } finally {
    if (original === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = original;
    if (admin === undefined) delete process.env.ADMIN_KEY;
    else process.env.ADMIN_KEY = admin;
  }
});

test('receive time is server-owned, duplicate retries are idempotent, and spoofed country is ignored', async () => {
  const e = { ...event(), country: 'US', received_at: '2000-01-01T00:00:00.000Z' };
  const before = new Date().toISOString();
  assert.deepEqual(await (await collect(request(undefined, { events: [e] }))).json(), { accepted: 1, duplicates: 0 });
  assert.deepEqual(await (await collect(request(undefined, { events: [e] }))).json(), { accepted: 0, duplicates: 1 });
  const [row] = await db.query<{ received_at: string; country: string }>('SELECT received_at, country FROM events');
  assert.ok(row.received_at >= before);
  assert.equal(row.country, '');
});

test('rate limit rejects overflow and a database failure never acknowledges persistence', async () => {
  const original = process.env.INGESTION_EVENTS_PER_MINUTE;
  process.env.INGESTION_EVENTS_PER_MINUTE = '1';
  try {
    assert.equal((await collect(request())).status, 202);
    const limited = await collect(request());
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
  } finally {
    if (original === undefined) delete process.env.INGESTION_EVENTS_PER_MINUTE;
    else process.env.INGESTION_EVENTS_PER_MINUTE = original;
  }
  await db.execute(
    "CREATE TRIGGER fail_insert BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'synthetic persistence failure'); END",
  );
  const { POST } = await import('../apps/dashboard/app/api/collect/route');
  const failed = await POST(request());
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'Collector temporarily unavailable; retry later' });
  assert.equal((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM events'))[0].n, 1);
});

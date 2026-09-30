import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { collect, collectorOptions } from '@house-edge/collector';
import { connect, createProject, issueKey, migrate, type Connection } from '@house-edge/database';
let db: Connection; let key: string; let projectId: string;
beforeEach(async () => {
  db = await connect({ provider: 'sqlite', filename: ':memory:' }); await migrate(db);
  const created = await createProject(db, { name: 'Collector test', projectKey: 'test', domain: 'allowed.com', origins: ['https://allowed.com'], environment: 'production' }); key = created.key; projectId = created.id;
  (globalThis as unknown as { houseEdgeDb: Promise<Connection> }).houseEdgeDb = Promise.resolve(db);
});
afterEach(async () => { await db.close(); delete (globalThis as unknown as { houseEdgeDb?: Promise<Connection> }).houseEdgeDb; });
const event = () => ({ id: randomUUID(), event: 'page_view', sessionId: 's', anonymousId: 'a', timestamp: new Date().toISOString(), properties: {} });
function request(origin: string | null = 'https://allowed.com', overrides: object = {}) { return new Request('https://analytics.example/api/collect', { method: 'POST', headers: { 'Content-Type': 'text/plain', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ projectKey: 'test', key, events: [event()], ...overrides }) }); }
test('collector accepts allowed origins and returns exact CORS response', async () => { const response = await collect(request()); assert.equal(response.status, 202); assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://allowed.com'); assert.deepEqual(await response.json(), { accepted: 1, duplicates: 0 }); });
test('browser keys reject missing, foreign and null origins', async () => { for (const origin of [null, 'null', 'https://allowed.com.evil.test', 'https://evil.test']) assert.equal((await collect(request(origin))).status, 403); });
test('server keys accept origin-less ingestion and reject browser origins', async () => { key = await db.transaction(tx => issueKey(tx, projectId, 'server')); assert.equal((await collect(request(null))).status, 202); assert.equal((await collect(request())).status, 403); });
test('revoked keys are immediately rejected', async () => { await db.execute('UPDATE api_keys SET revoked_at = @now', { now: new Date().toISOString() }); assert.equal((await collect(request())).status, 401); });
test('invalid timestamps, oversized bodies and malformed events cannot be ingested', async () => {
  assert.equal((await collect(request('https://allowed.com', { events: [{ ...event(), timestamp: '2020-01-01T00:00:00.000Z' }] }))).status, 400);
  assert.equal((await collect(request('https://allowed.com', { events: [{ ...event(), id: 'bad-id' }] }))).status, 400);
  const large = new Request('https://example.test', { method: 'POST', body: 'x'.repeat(65537) }); assert.equal((await collect(large)).status, 413);
  const [{ n }] = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM events'); assert.equal(n, 0);
});
test('preflight only allows configured origins', async () => { assert.equal((await collectorOptions(new Request('https://collector.test', { method: 'OPTIONS', headers: { origin: 'https://allowed.com' } }))).status, 204); assert.equal((await collectorOptions(new Request('https://collector.test', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }))).status, 403); });

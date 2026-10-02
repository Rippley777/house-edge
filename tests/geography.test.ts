import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect, createProject, ingest, issueKey, migrate, type Connection } from '@house-edge/database';
import type { AnalyticsEvent, Project } from '@house-edge/shared';
import { extractClientNetwork, normalizeIp, publicIp } from '@house-edge/database/client-ip';
import {
  countryLocation,
  normalizeLocation,
  processGeographyJobs,
  resolveLocation,
  stageGeography,
  cleanupGeography,
  HttpGeolocationProvider,
  type GeolocationProvider,
} from '@house-edge/database/geolocation';
import { loginGeography } from '@house-edge/engine/geography';
import { viewData } from '@house-edge/engine';
import { collect } from '@house-edge/collector';
import { GET } from '../apps/dashboard/app/api/[...path]/route';

let db: Connection, project: Project, key: string;
const environmentKeys = [
  'GEO_QUEUE_KEY',
  'GEO_IP_HASH_SALT',
  'LOGIN_GEOGRAPHY_ENABLED',
  'DEMO_MODE',
  'ADMIN_KEY',
  'DATABASE_PROVIDER',
  'GEO_RETENTION_DAYS',
  'GEO_LOOKUP_INTERVAL_MS',
];
let original: Record<string, string | undefined>;
beforeEach(async () => {
  original = Object.fromEntries(environmentKeys.map((k) => [k, process.env[k]]));
  process.env.GEO_QUEUE_KEY = '12'.repeat(32);
  process.env.GEO_IP_HASH_SALT = 'test-only-geography-hash-salt-12345678';
  process.env.LOGIN_GEOGRAPHY_ENABLED = 'true';
  process.env.GEO_LOOKUP_INTERVAL_MS = '0';
  process.env.GEO_RETENTION_DAYS = '30';
  process.env.DEMO_MODE = 'false';
  process.env.ADMIN_KEY = 'test-only-admin-key-with-at-least-32-chars';
  process.env.DATABASE_PROVIDER = 'sqlite';
  db = await connect({ provider: 'sqlite', filename: ':memory:' });
  await migrate(db);
  const created = await createProject(db, {
    name: 'Geography test',
    projectKey: 'geo-test',
    domain: 'test.example',
    origins: ['https://test.example'],
    environment: 'production',
  });
  [project] = await db.query<Project>('SELECT * FROM projects WHERE id = @id', { id: created.id });
  key = await db.transaction((tx) => issueKey(tx, project.id, 'server'));
  (globalThis as unknown as { houseEdgeDb: Promise<Connection> }).houseEdgeDb = Promise.resolve(db);
});
afterEach(async () => {
  await db.close();
  delete (globalThis as unknown as { houseEdgeDb?: Promise<Connection> }).houseEdgeDb;
  for (const k of environmentKeys) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});
function login(overrides: Partial<AnalyticsEvent> = {}): AnalyticsEvent {
  return {
    id: randomUUID(),
    event: 'deck.auth.login.succeeded.v1',
    sessionId: randomUUID(),
    anonymousId: 'anonymous-visitor',
    timestamp: new Date().toISOString(),
    properties: {},
    login: { success: true, provider: 'github', sourceIp: '8.8.8.8' },
    ...overrides,
  };
}
const location = () =>
  normalizeLocation(
    {
      countryCode: 'US',
      region: 'Illinois',
      city: 'Chicago',
      latitude: 41.8781,
      longitude: -87.6298,
      accuracyLevel: 'city',
      coordinatesAreCentroid: true,
      isVpn: false,
    },
    'mock',
  );
const provider: GeolocationProvider = { name: 'mock', version: '1', lookup: async () => location() };
const f = () => ({
  from: new Date(Date.now() - 86400000).toISOString(),
  to: new Date(Date.now() + 60000).toISOString(),
});
async function stage(e: AnalyticsEvent, p = project) {
  await ingest(db, p, [e]);
  await stageGeography(db, p, [e], { ip: null, country: null }, true);
}

test('normalizes IPv4 and IPv6 and excludes local, special-use and malformed addresses', () => {
  assert.equal(publicIp('8.8.8.8'), '8.8.8.8');
  assert.equal(publicIp('2606:4700:4700::1111'), '2606:4700:4700::1111');
  assert.equal(publicIp('::ffff:8.8.8.8'), '8.8.8.8');
  assert.equal(normalizeIp('[2606:4700:4700::1111]:443'), '2606:4700:4700::1111');
  for (const ip of [
    'localhost',
    '127.0.0.1',
    '10.1.2.3',
    '192.168.2.1',
    '172.16.0.1',
    '169.254.1.2',
    '100.64.0.1',
    '192.0.2.1',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '999.1.1.1',
    '010.0.0.1',
    '8.8.8.8, 1.1.1.1',
  ])
    assert.equal(publicIp(ip), null, ip);
});
test('ignores spoofed forwarded and Cloudflare headers from an untrusted peer', () => {
  const headers = new Headers({ 'x-forwarded-for': '1.1.1.1', 'cf-connecting-ip': '8.8.8.8', 'cf-ipcountry': 'US' });
  assert.deepEqual(extractClientNetwork(headers), { ip: null, country: null });
  assert.deepEqual(extractClientNetwork(headers, { remoteAddress: '9.9.9.9' }), { ip: '9.9.9.9', country: null });
});
test('peels a trusted IPv4/IPv6 proxy chain without accepting a spoofed leftmost address', () => {
  const trust = { remoteAddress: '10.0.0.2', trustedCidrs: ['10.0.0.0/8', 'fc00::/7'] };
  assert.equal(
    extractClientNetwork(new Headers({ 'x-forwarded-for': '1.1.1.1, 8.8.8.8, 10.0.0.3' }), trust).ip,
    '8.8.8.8',
  );
  assert.equal(
    extractClientNetwork(new Headers({ 'x-forwarded-for': '2606:4700:4700::1111, fc00::2' }), trust).ip,
    '2606:4700:4700::1111',
  );
  assert.equal(extractClientNetwork(new Headers({ 'x-forwarded-for': '1.1.1.1, invalid' }), trust).ip, null);
});
test('Cloudflare headers require its trusted peer or authenticated restricted ingress', () => {
  const h = new Headers({ 'cf-connecting-ip': '8.8.8.8', 'cf-ipcountry': 'US' });
  assert.deepEqual(extractClientNetwork(h, { remoteAddress: '173.245.48.1', cloudflareCidrs: ['173.245.48.0/20'] }), {
    ip: '8.8.8.8',
    country: 'US',
  });
  const ingressSecret = 'trusted-ingress-token-at-least-32-characters';
  h.set('x-house-edge-ingress-token', ingressSecret);
  assert.deepEqual(extractClientNetwork(h, { ingressSecret, cloudflareIngress: true }), {
    ip: '8.8.8.8',
    country: 'US',
  });
  h.set('x-house-edge-ingress-token', 'spoof');
  assert.equal(extractClientNetwork(h, { ingressSecret, cloudflareIngress: true }).ip, null);
});
test('provider success is normalized, rounded and unknown indicators remain unknown', async () => {
  const geo = await resolveLocation('8.8.8.8', null, [provider]);
  assert.equal(geo.latitude, 41.9);
  assert.equal(geo.longitude, -87.6);
  assert.equal(geo.accuracyLevel, 'city');
  assert.equal(geo.isVpn, false);
  assert.equal(geo.isProxy, null);
  assert.equal(geo.accuracyRadius, 15);
  assert.equal(
    normalizeLocation(
      { countryCode: 'US', city: 'Street location', latitude: 41.123456, longitude: -87.123456 },
      'mock',
    ).accuracyLevel,
    'country',
  );
});
test('provider timeouts, failures and malformed responses fall back safely', async () => {
  const hung: GeolocationProvider = { name: 'hung', version: '1', lookup: () => new Promise(() => {}) };
  assert.equal((await resolveLocation('8.8.8.8', null, [hung], 15)).status, 'timeout');
  const failure = {
    ...provider,
    lookup: async () => {
      throw new Error('offline');
    },
  };
  assert.equal((await resolveLocation('8.8.8.8', null, [failure])).status, 'failed');
  assert.equal((await resolveLocation('8.8.8.8', 'GB', [failure])).accuracyLevel, 'country');
  assert.equal((await resolveLocation(null, null, [])).accuracyLevel, 'unknown');
  assert.equal(normalizeLocation({ countryCode: 'XX', latitude: 999 }, 'mock').status, 'failed');
  const fetchOriginal = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ countryCode: 'US', latitude: 'not-number', city: '<script>' });
    const result = await new HttpGeolocationProvider('https://geo.example', '1').lookup(
      '8.8.8.8',
      new AbortController().signal,
    );
    assert.equal(result.accuracyLevel, 'country');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
test('collection returns before enrichment, survives provider failure, and retains no plaintext IP', async () => {
  const event = login({ properties: { ip_address: '8.8.8.8', nested: { sourceIp: '8.8.8.8' } } });
  const request = new Request('https://collector.example/api/collect', {
    method: 'POST',
    body: JSON.stringify({ projectKey: project.project_key, key, events: [event] }),
  });
  assert.equal((await collect(request)).status, 202);
  const stored = await db.query('SELECT * FROM events');
  assert.ok(!JSON.stringify(stored).includes('8.8.8.8'));
  const jobs = await db.query('SELECT * FROM geo_jobs');
  assert.equal(jobs.length, 1);
  assert.ok(!JSON.stringify(jobs).includes('8.8.8.8'));
  const result = await processGeographyJobs(db, 25, [
    {
      ...provider,
      lookup: async () => {
        throw new Error('down');
      },
    },
  ]);
  assert.equal(result.failed, 1);
  assert.equal((await db.query('SELECT * FROM events')).length, 1);
  assert.equal((await db.query('SELECT * FROM geo_jobs')).length, 0);
});
test('browser claims and mismatched login metadata are rejected; service IP is never inferred', async () => {
  const browserKey = await db.transaction((tx) => issueKey(tx, project.id, 'ingest'));
  const request = (keyValue: string, events: AnalyticsEvent[], origin?: string) =>
    new Request('https://collector.example/api/collect', {
      method: 'POST',
      headers: origin ? { origin } : {},
      body: JSON.stringify({ projectKey: project.project_key, key: keyValue, events }),
    });
  assert.equal((await collect(request(browserKey, [login()], 'https://test.example'))).status, 400);
  assert.equal((await collect(request(key, [login({ login: { success: false, provider: 'github' } })]))).status, 400);
  const event = login({ login: { success: true, provider: 'google' } });
  assert.equal((await collect(request(key, [event]), { remoteAddress: '8.8.8.8' })).status, 202);
  assert.equal((await db.query('SELECT * FROM geo_jobs')).length, 0);
});
test('deduplicates retries and caches repeated IP/provider-version lookups', async () => {
  const first = login();
  await stage(first);
  await stage(first);
  assert.equal((await db.query('SELECT * FROM geo_jobs')).length, 1);
  let calls = 0;
  const counted = {
    ...provider,
    lookup: async () => {
      calls++;
      return location();
    },
  };
  await processGeographyJobs(db, 25, [counted]);
  await stage(login());
  await processGeographyJobs(db, 25, [counted]);
  assert.equal(calls, 1);
  await stage(login());
  await processGeographyJobs(db, 25, [{ ...counted, version: '2' }]);
  assert.equal(calls, 2);
});
test('excludes development/private traffic, supports country-only fallback and global disable', async () => {
  await stage(login({ login: { success: true, provider: 'github', sourceIp: '127.0.0.1' } }));
  await stage(login({ login: { success: true, provider: 'github', sourceIp: '8.8.8.8', environment: 'development' } }));
  assert.equal((await db.query('SELECT * FROM geo_jobs')).length, 0);
  const browserLogin = login({ login: { success: true, provider: 'github' } });
  await ingest(db, project, [browserLogin]);
  await stageGeography(db, project, [browserLogin], { ip: null, country: 'JP' }, false);
  await processGeographyJobs(db, 25, []);
  const [row] = await db.query<{ location_accuracy_level: string; latitude: number }>(
    'SELECT * FROM events WHERE id = @id',
    { id: browserLogin.id },
  );
  assert.equal(row.location_accuracy_level, 'country');
  assert.equal(row.latitude, countryLocation('JP').latitude);
  process.env.LOGIN_GEOGRAPHY_ENABLED = 'false';
  await stage(login());
  assert.equal((await db.query('SELECT * FROM geo_jobs')).length, 0);
  assert.equal((await loginGeography(db, f())).locations.length, 0);
});
test('aggregates project-scoped users, provider/result/date filters, totals, trends and countries', async () => {
  const now = Date.now();
  const first = login({ userId: 'opaque-user', timestamp: new Date(now - 600000).toISOString() });
  await stage(first);
  await stage(
    login({ anonymousId: 'second-device', userId: 'opaque-user', timestamp: new Date(now - 300000).toISOString() }),
  );
  await stage(
    login({ event: 'deck.auth.login.failed.v1', login: { success: false, provider: 'google', sourceIp: '1.1.1.1' } }),
  );
  await stage(login({ timestamp: new Date(now - 2 * 86400000).toISOString() }));
  await processGeographyJobs(db, 25, [provider]);
  const result = await loginGeography(db, { ...f(), project: project.id, granularity: 'city' });
  assert.equal(result.summary.totalLogins, 2);
  assert.equal(result.locations[0].totalEvents, 2);
  assert.equal(result.locations[0].uniqueUsers, 1);
  assert.equal(result.summary.coverage, 100);
  assert.equal(result.locations[0].percentage, 100);
  assert.equal(result.summary.newCountries.length, 0);
  assert.equal(result.locations[0].previousEvents, 1);
  assert.equal(result.locations[0].trend, 100);
  assert.deepEqual(result.locations[0].applications, ['Geography test']);
  assert.deepEqual(result.locations[0].providers, ['github']);
  assert.equal((await loginGeography(db, { ...f(), provider: 'google', success: 'failure' })).summary.totalLogins, 1);
  assert.equal((await loginGeography(db, { ...f(), country: 'GB' })).summary.totalLogins, 0);
  assert.equal((await loginGeography(db, { ...f(), minEvents: 3 })).locations.length, 0);
  const country = await loginGeography(db, { ...f(), granularity: 'country' });
  assert.equal(country.locations[0].latitude, countryLocation('US').latitude);
  assert.equal(country.locations[0].city, null);
});
test('project isolation and authorized API responses exclude IPs, hashes and personal identifiers', async () => {
  await stage(login({ userId: 'private-opaque-user' }));
  await processGeographyJobs(db, 25, [provider]);
  assert.equal((await loginGeography(db, { ...f(), project: randomUUID() })).summary.totalLogins, 0);
  const url = 'https://analytics.example/api/login-geography';
  const context = { params: Promise.resolve({ path: ['login-geography'] }) };
  assert.equal((await GET(new Request(url), context)).status, 401);
  const response = await GET(
    new Request(url, { headers: { Authorization: `Bearer ${process.env.ADMIN_KEY}` } }),
    context,
  );
  assert.equal(response.status, 200);
  const text = JSON.stringify(await response.json());
  for (const denied of [
    '8.8.8.8',
    'private-opaque-user',
    'ip_hash',
    'anonymous_id',
    'user_id',
    'session_id',
    'encrypted_ip',
  ])
    assert.ok(!text.includes(denied), denied);
  const rawEvents = JSON.stringify(await viewData('events', f()));
  assert.ok(!rawEvents.includes('ip_hash'));
});
test('retention clears geography without deleting the login and expired jobs purge their IP', async () => {
  const event = login();
  await stage(event);
  await processGeographyJobs(db, 25, [provider]);
  await db.execute('UPDATE events SET timestamp = @time WHERE id = @id', {
    time: new Date(Date.now() - 31 * 86400000).toISOString(),
    id: event.id,
  });
  const pending = login();
  await stage(pending);
  await db.execute('UPDATE geo_jobs SET expires_at = @time', { time: '2000-01-01T00:00:00.000Z' });
  await cleanupGeography(db);
  const [expired] = await db.query<{ latitude: number | null; ip_hash: string | null; geo_enrichment_status: string }>(
    'SELECT * FROM events WHERE id = @id',
    { id: event.id },
  );
  assert.equal(expired.latitude, null);
  assert.equal(expired.ip_hash, null);
  assert.equal(expired.geo_enrichment_status, 'expired');
  assert.equal((await db.query('SELECT * FROM geo_jobs')).length, 0);
});
test('migration 2 upgrades an existing database and is restartable', async () => {
  await migrate(db);
  const versions = await db.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(
    versions.map((v) => v.version),
    [1, 2],
  );
});

test('large map distributions coarsen in SQL and comparisons only scan the selected locations', async () => {
  const current = Array.from({ length: 502 }, (_, i) => login({ anonymousId: `visitor-${i}` }));
  await ingest(db, project, current, { skipRollups: true });
  await db.transaction(async (tx) => {
    for (const [i, e] of current.entries())
      await tx.execute(
        "UPDATE events SET geo_enrichment_status = 'enriched', location_accuracy_level = 'city', country_code = 'US', country_name = 'United States', region = 'Illinois', city = @city, latitude = 41.9, longitude = -87.6 WHERE id = @id",
        { city: `Test city ${i}`, id: e.id },
      );
  });
  const result = await loginGeography(db, { ...f(), granularity: 'city' });
  assert.equal(result.granularity, 'region');
  assert.equal(result.locations.length, 1);
  assert.equal(result.locations[0].totalEvents, 502);
  assert.equal(result.locations[0].uniqueUsers, 502);
});

test('enrichment leases prevent concurrent workers and recover after a crash', async () => {
  await stage(login());
  let calls = 0;
  const slow = {
    ...provider,
    lookup: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return location();
    },
  };
  const results = await Promise.all([processGeographyJobs(db, 25, [slow]), processGeographyJobs(db, 25, [slow])]);
  assert.equal(calls, 1);
  assert.equal(
    results.reduce((n, r) => n + r.processed, 0),
    1,
  );
  await stage(login({ login: { success: true, provider: 'github', sourceIp: '1.1.1.1' } }));
  await db.execute("UPDATE geo_jobs SET lease_token = 'crashed-worker', lease_until = '2000-01-01T00:00:00.000Z'");
  assert.equal((await processGeographyJobs(db, 25, [provider])).enriched, 1);
});

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect, migrate, createProject, issueKey, type Connection } from '@house-edge/database';
import { collect } from '@house-edge/collector';
import { cleanupGeography, ipHash } from '@house-edge/database/geolocation';
import { GET } from '../apps/dashboard/app/api/[...path]/route';
import { geographyFeatures } from '../packages/shared/src/geography-map';
import type { GeographyData } from '../packages/shared/src/geography';

let db: Connection, serverKey: string, browserKey: string, projectId: string;
let original: NodeJS.ProcessEnv;
beforeEach(async () => {
  original = { ...process.env };
  Object.assign(process.env, {
    DATABASE_PROVIDER: 'sqlite',
    DEMO_MODE: 'false',
    GEOGRAPHY_ENABLED: 'true',
    GEO_PRODUCTION_ONLY: 'false',
    GEO_IP_HASH_SALT: 'synthetic-hash-key-for-tests-only-123456',
    ADMIN_KEY: 'synthetic-admin-key-for-tests-only-123456',
  });
  db = await connect({ provider: 'sqlite', filename: ':memory:' });
  await migrate(db);
  const p = await createProject(db, {
    name: 'Rippley fixture',
    projectKey: 'rippley-fixture',
    domain: 'fixture.example',
    origins: ['https://fixture.example'],
    environment: 'development',
  });
  projectId = p.id;
  browserKey = p.key;
  serverKey = await db.transaction((tx) => issueKey(tx, p.id, 'server'));
  (globalThis as unknown as { houseEdgeDb: Promise<Connection> }).houseEdgeDb = Promise.resolve(db);
});
afterEach(async () => {
  await db.close();
  delete (globalThis as unknown as { houseEdgeDb?: unknown }).houseEdgeDb;
  for (const k of Object.keys(process.env)) if (!(k in original)) delete process.env[k];
  Object.assign(process.env, original);
});
const location = (overrides = {}) => ({
  version: 1,
  source: 'cloudflare',
  ip: '8.8.8.8',
  city: 'Fort Worth',
  region: 'Texas',
  regionCode: 'TX',
  country: 'US',
  latitude: 32.75,
  longitude: -97.33,
  postalCode: '76102',
  timezone: 'America/Chicago',
  colo: 'DFW',
  asn: 64500,
  networkOrganization: 'Synthetic network',
  ...overrides,
});
const event = (overrides = {}) => ({
  id: randomUUID(),
  event: 'page_view',
  sessionId: 'session-a',
  anonymousId: 'visitor-a',
  timestamp: new Date().toISOString(),
  properties: {},
  location: location(),
  ...overrides,
});
const send = (events: unknown[], key = serverKey) =>
  collect(
    new Request('http://collector.test/api/collect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key === browserKey ? { origin: 'https://fixture.example' } : {}),
      },
      body: JSON.stringify({ projectKey: 'rippley-fixture', key, events }),
    }),
  );
async function map(query: Record<string, string> = {}) {
  const q = new URLSearchParams({
    project: projectId,
    scope: 'visits',
    metric: 'visits',
    granularity: 'city',
    ...query,
  });
  const response = await GET(
    new Request(`http://collector.test/api/geography?${q}`, {
      headers: { authorization: `Bearer ${process.env.ADMIN_KEY}` },
    }),
    { params: Promise.resolve({ path: ['geography'] }) },
  );
  assert.equal(response.status, 200);
  return (await response.json()) as GeographyData;
}
test('Cloudflare persists structured geography and IPv4/IPv6 HMACs, never raw IP or queue inputs', async () => {
  for (const ip of ['8.8.8.8', '2606:4700:4700::1111']) {
    const e = event({ location: location({ ip }) });
    assert.equal((await send([e])).status, 202);
    const [row] = await db.query('SELECT * FROM events WHERE id = @id', { id: e.id });
    assert.equal(row.ip_hash, ipHash(ip));
    assert.equal(row.city, 'Fort Worth');
    assert.equal(row.region_code, 'TX');
    assert.equal(row.postal_code, '76102');
    assert.equal(row.cloudflare_colo, 'DFW');
    assert.equal(row.network_asn, 64500);
    assert.equal(row.latitude, 32.8);
    assert.equal(row.longitude, -97.3);
    assert.equal(row.geo_provider, 'cloudflare');
    assert.equal(row.geo_enrichment_status, 'enriched');
    assert.equal(row.location_accuracy_level, 'city');
    assert.equal(row.accuracy_radius, 15);
    assert.ok(!JSON.stringify(row).includes(ip));
  }
  assert.equal((await db.query('SELECT * FROM geo_jobs')).length, 0);
  assert.equal((await db.query('SELECT * FROM geo_cache')).length, 0);
  delete process.env.GEO_IP_HASH_SALT;
  const e = event();
  await send([e]);
  assert.equal((await db.query('SELECT ip_hash FROM events WHERE id = @id', { id: e.id }))[0].ip_hash, null);
});
test('partial, absent and malformed metadata never block analytics; countries degrade to centroids', async () => {
  for (const loc of [
    undefined,
    null,
    'bad',
    { version: 99 },
    { version: 1, source: 'cloudflare', country: 'GB' },
    location({ latitude: 1000 }),
    location({ longitude: 'oops' }),
    location({ latitude: null }),
    location({ country: 'XX' }),
  ]) {
    const e = event({ location: loc });
    assert.equal((await send([e])).status, 202);
    const [r] = await db.query('SELECT * FROM events WHERE id = @id', { id: e.id });
    assert.notEqual(r.location_accuracy_level, 'city');
    assert.notEqual(r.latitude, 1000);
  }
  const result = await map();
  assert.equal(result.summary.totalEvents, 9);
  assert.ok(result.summary.unknownLocations > 0);
});
test('browser keys cannot assert server geography', async () => {
  assert.equal((await send([event()], browserKey)).status, 400);
  assert.equal((await send([event({ location: undefined })], browserKey)).status, 202);
});
test('duplicate IDs, multiple pages and returning visitors preserve counts, sessions and first geography', async () => {
  const first = event();
  const events = [
    first,
    event({ event: 'session_start' }),
    event({ path: '/downloads' }),
    event({ sessionId: 'return-visit' }),
    event({ sessionId: 'second-person', anonymousId: 'visitor-b' }),
  ];
  assert.deepEqual(await (await send(events)).json(), { accepted: 5, duplicates: 0 });
  assert.deepEqual(
    await (await send(events.map((e) => ({ ...e, location: location({ city: 'Spoofed retry' }) })))).json(),
    { accepted: 0, duplicates: 5 },
  );
  const rows = await db.query('SELECT * FROM events');
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.city === 'Fort Worth'));
  assert.equal((await db.query('SELECT * FROM sessions')).length, 3);
  const result = await map();
  assert.equal(result.summary.totalEvents, 4);
  assert.equal(result.summary.totalVisits, 3);
  assert.equal(result.summary.uniqueUsers, 2);
  assert.equal(result.locations.length, 1);
  assert.equal(result.locations[0].totalVisits, 3);
  assert.equal(geographyFeatures(result.locations, 'visits').features[0].properties.weight, 3);
  assert.equal(geographyFeatures(result.locations, 'users').features[0].properties.weight, 2);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('ip_hash'));
  assert.ok(!serialized.includes('visitor-a'));
  assert.ok(!serialized.includes('76102'));
});
test('map API aggregates country/region/city, applies exact date and project filters and excludes session_start', async () => {
  const now = Date.now();
  await send([
    event({ timestamp: new Date(now - 120000).toISOString() }),
    event({ sessionId: 'b', anonymousId: 'b', location: location({ city: 'Dallas', longitude: -96.8 }) }),
    event({ event: 'session_start', sessionId: 'c' }),
  ]);
  assert.equal((await map()).locations.length, 2);
  for (const granularity of ['country', 'region']) {
    const data = await map({ granularity });
    assert.equal(data.locations.length, 1);
    assert.equal(data.locations[0].totalVisits, 2);
    assert.equal(data.locations[0].uniqueUsers, 2);
  }
  const recent = await map({ from: new Date(now - 60000).toISOString(), to: new Date(now + 60000).toISOString() });
  assert.equal(recent.summary.totalEvents, 1);
  assert.equal(recent.locations[0].city, 'Dallas');
  assert.equal((await map({ project: randomUUID() })).locations.length, 0);
  assert.equal((await map({ country: 'GB' })).locations.length, 0);
});
test('migration is repeatable and geographic retention also clears new Cloudflare fields', async () => {
  await send([event()]);
  await migrate(db);
  await migrate(db);
  assert.equal((await db.query('SELECT * FROM schema_migrations WHERE version = 4')).length, 1);
  await cleanupGeography(db, new Date(Date.now() + 40 * 86400000));
  const [r] = await db.query('SELECT * FROM events');
  for (const k of [
    'ip_hash',
    'region_code',
    'postal_code',
    'cloudflare_colo',
    'network_asn',
    'network_organization',
    'latitude',
    'longitude',
  ])
    assert.equal(r[k], null);
});
test('disabled or production-only geography does not collect location', async () => {
  process.env.GEOGRAPHY_ENABLED = 'false';
  await send([event()]);
  process.env.GEOGRAPHY_ENABLED = 'true';
  process.env.GEO_PRODUCTION_ONLY = 'true';
  await send([event()]);
  const rows = await db.query('SELECT * FROM events');
  assert.ok(rows.every((r) => r.latitude === null && r.ip_hash === null && r.postal_code === null));
});

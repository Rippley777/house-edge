import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { connect, migrate, createProject, issueKey, type Connection } from '@house-edge/database';
import { collect } from '@house-edge/collector';
import { GET } from '../apps/dashboard/app/api/[...path]/route';
import { geographyFeatures } from '../packages/shared/src/geography-map';
import type { GeographyData } from '../packages/shared/src/geography';

// Always create a fresh isolated local DB. Never use configured production credentials/data.
if (process.env.NODE_ENV === 'production') throw new Error('Run verification in development');
const rippley = process.argv[2];
if (!rippley) throw new Error('Usage: npm run geo:verify -- /path/to/rippley-labs');
const fixtureScript = path.resolve(rippley, 'scripts/geography-fixture.mjs');
await access(fixtureScript);
await mkdir('.data', { recursive: true });
const directory = await mkdtemp(path.resolve('.data/cloudflare-verification-'));
const database = path.join(directory, 'house-edge.db');
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DEMO_MODE: 'false',
  GEOGRAPHY_ENABLED: 'true',
  GEO_PRODUCTION_ONLY: 'false',
  ADMIN_KEY: randomBytes(32).toString('hex'),
  GEO_IP_HASH_SALT: randomBytes(32).toString('hex'),
});
const db = await connect({ provider: 'sqlite', filename: database });
(globalThis as unknown as { houseEdgeDb: Promise<Connection> }).houseEdgeDb = Promise.resolve(db);
await migrate(db);
const project = await createProject(db, {
  name: 'Rippley Labs — synthetic geography',
  projectKey: 'rippley-labs-geo-fixture',
  domain: 'rippley-fixture.example',
  origins: ['https://rippley-fixture.example'],
  environment: 'development',
});
const key = await db.transaction((tx) => issueKey(tx, project.id, 'server'));
let eventPayload: unknown;
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 65536) throw new Error('Too large');
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString();
    if (!eventPayload) {
      const event = JSON.parse(body).events.find((e: { event: string }) => e.event === 'page_view');
      eventPayload = { ...event, location: { ...event.location, ip: '[synthetic input redacted]' } };
    }
    const result = await collect(
      new Request('http://127.0.0.1/api/collect', {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    outgoing.writeHead(result.status, { 'Content-Type': 'application/json' });
    outgoing.end(await result.text());
  } catch {
    outgoing.writeHead(500);
    outgoing.end('Fixture failure');
  }
});
try {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture server');
  const endpoint = `http://127.0.0.1:${address.port}/api/collect`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href, fixtureScript],
      {
        cwd: path.resolve(rippley),
        stdio: ['ignore', 'pipe', 'inherit'],
        env: {
          ...process.env,
          HOUSE_EDGE_ENDPOINT: endpoint,
          HOUSE_EDGE_SERVER_KEY: key,
          HOUSE_EDGE_PROJECT: 'rippley-labs-geo-fixture',
        },
      },
    );
    child.stdout.on('data', (data) => process.stdout.write(data));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Fixture exited ${code}`))));
  });
  const query = new URLSearchParams({
    project: project.id,
    scope: 'visits',
    metric: 'visits',
    granularity: 'city',
    from: new Date(Date.now() - 3600000).toISOString(),
    to: new Date(Date.now() + 60000).toISOString(),
  });
  const response = await GET(
    new Request(`http://127.0.0.1/api/geography?${query}`, {
      headers: { authorization: `Bearer ${process.env.ADMIN_KEY}` },
    }),
    { params: Promise.resolve({ path: ['geography'] }) },
  );
  assert.equal(response.status, 200);
  const api = (await response.json()) as GeographyData;
  assert.equal(api.locations.length, 7);
  assert.equal(api.summary.totalEvents, 21);
  assert.equal(api.summary.totalVisits, 14);
  assert.equal(api.summary.uniqueUsers, 7);
  assert.equal(api.summary.countries, 4);
  const [record] = await db.query('SELECT * FROM events WHERE id = @id', { id: (eventPayload as { id: string }).id });
  const [session] = await db.query('SELECT * FROM sessions WHERE project_id = @project AND session_id = @session', {
    project: project.id,
    session: String(record.session_id),
  });
  assert.equal(session.page_views, 2);
  assert.equal(session.event_count, 3);
  assert.equal((await db.query('SELECT * FROM geo_jobs')).length, 0);
  const map = geographyFeatures(api.locations, 'visits');
  assert.equal(map.features.length, 7);
  const report = {
    synthetic: true,
    database,
    eventPayload,
    storedRecord: record,
    session,
    apiPath: `/api/geography?${query}`,
    api,
    map,
  };
  const reportPath = path.join(directory, 'verification.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        report: reportPath,
        database,
        projectId: project.id,
        events: 28,
        pageViews: 21,
        visits: 14,
        uniqueVisitors: 7,
        mapLocations: 7,
        countries: 4,
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.close();
  delete (globalThis as unknown as { houseEdgeDb?: unknown }).houseEdgeDb;
}

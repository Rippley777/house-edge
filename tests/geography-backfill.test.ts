import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { connect, createProject, ingest, migrate, schemaStatements } from '@house-edge/database';
import type { Project } from '@house-edge/shared';
import { geographySchemaStatements } from '@house-edge/database/geography-schema';

const exec = promisify(execFile);
test('migration 2 preserves historical events when upgrading the original schema', async () => {
  const db = await connect({ provider: 'sqlite', filename: ':memory:' });
  try {
    for (const statement of schemaStatements('sqlite')) await db.execute(statement);
    await db.execute('INSERT INTO schema_migrations VALUES (1, @now)', { now: new Date().toISOString() });
    const created = await createProject(db, {
      name: 'Old project',
      projectKey: 'old',
      domain: 'old.example',
      origins: ['https://old.example'],
      environment: 'production',
    });
    await db.execute(
      "INSERT INTO events (id, project_id, event_name, timestamp, session_id, anonymous_id, path, referrer, properties_json, device_type, browser, operating_system, country, app_version) VALUES (@id, @project, 'page_view', @now, 's', 'a', '/', '', '{}', 'desktop', 'Unknown', 'Unknown', '', '')",
      { id: randomUUID(), project: created.id, now: new Date().toISOString() },
    );
    await migrate(db);
    await migrate(db);
    const [row] = await db.query<{ event_name: string; country_code: string | null }>('SELECT * FROM events');
    assert.equal(row.event_name, 'page_view');
    assert.equal(row.country_code, null);
  } finally {
    await db.close();
  }
});

test('authorized backfill is resumable, enriches valid history, excludes development and records invalid lines', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'house-edge-geo-backfill-'));
  const filename = path.join(folder, 'database.db');
  const input = path.join(folder, 'source.ndjson');
  const checkpoint = path.join(folder, 'checkpoint.json');
  const mock = path.join(folder, 'provider.mjs');
  const db = await connect({ provider: 'sqlite', filename });
  try {
    await migrate(db);
    const created = await createProject(db, {
      name: 'Backfill app',
      projectKey: 'backfill',
      domain: 'backfill.example',
      origins: ['https://backfill.example'],
      environment: 'production',
    });
    const [project] = await db.query<Project>('SELECT * FROM projects WHERE id = @id', { id: created.id });
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const [i, id] of ids.entries())
      await ingest(db, project, [
        {
          id,
          event: i < 2 ? 'deck.auth.login.succeeded.v1' : i === 2 ? 'page_view' : 'checkout_completed',
          sessionId: id,
          anonymousId: id,
          timestamp: new Date().toISOString(),
          properties: {},
          environment: i === 1 ? 'development' : 'production',
          ...(i < 2
            ? {
                login: {
                  success: true,
                  provider: 'github',
                  environment: i === 1 ? ('development' as const) : ('production' as const),
                },
              }
            : {}),
        },
      ]);
    await fs.writeFile(
      input,
      ids.map((eventId) => JSON.stringify({ eventId, projectId: project.id, sourceIp: '8.8.8.8' })).join('\n') +
        '\ninvalid-line\n',
      { mode: 0o600 },
    );
    await fs.writeFile(
      mock,
      "globalThis.fetch = async () => Response.json({ countryCode: 'US', region: 'Illinois', city: 'Chicago', latitude: 41.9, longitude: -87.6, accuracyLevel: 'city', coordinatesAreCentroid: true });",
    );
    const args = ['--import', 'tsx', '--import', mock, 'scripts/geography-backfill.ts', input, checkpoint];
    const env = {
      ...process.env,
      DATABASE_PROVIDER: 'sqlite',
      SQLITE_PATH: filename,
      DEMO_MODE: 'false',
      GEOGRAPHY_ENABLED: 'true',
      GEO_PRODUCTION_ONLY: 'true',
      LOGIN_GEOGRAPHY_ENABLED: 'true',
      GEO_QUEUE_KEY: '12'.repeat(32),
      GEO_IP_HASH_SALT: 'backfill-test-salt-at-least-32-characters',
      GEO_PROVIDER_URL: 'https://geo.example.invalid',
      GEO_MMDB_PATH: '',
      GEO_LOOKUP_INTERVAL_MS: '0',
      GEO_RETENTION_DAYS: '30',
    };
    const first = await exec(process.execPath, args, { env });
    assert.ok(!first.stdout.includes('8.8.8.8'));
    const state = JSON.parse(await fs.readFile(checkpoint, 'utf8'));
    assert.equal(state.enriched, 3);
    assert.equal(state.skipped, 1);
    assert.equal(state.failed, 1);
    const [enriched] = await db.query<{ geo_enrichment_status: string; city: string }>(
      'SELECT * FROM events WHERE id = @id',
      { id: ids[0] },
    );
    assert.equal(enriched.city, 'Chicago');
    assert.equal(enriched.geo_enrichment_status, 'enriched');
    await exec(process.execPath, args, { env });
    assert.deepEqual(JSON.parse(await fs.readFile(checkpoint, 'utf8')), state);
    assert.equal((await db.query('SELECT * FROM geo_jobs')).length, 0);
  } finally {
    await db.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('migration 3 upgrades version 2 and preserves enriched login metadata', async () => {
  const db = await connect({ provider: 'sqlite', filename: ':memory:' });
  try {
    for (const statement of [...schemaStatements('sqlite'), ...geographySchemaStatements('sqlite')])
      await db.execute(statement);
    for (const version of [1, 2])
      await db.execute('INSERT INTO schema_migrations VALUES (@version, @now)', {
        version,
        now: new Date().toISOString(),
      });
    const created = await createProject(db, {
      name: 'Existing app',
      projectKey: 'existing',
      domain: 'existing.example',
      origins: ['https://existing.example'],
      environment: 'production',
    });
    await db.execute(
      "INSERT INTO events (id, project_id, event_name, timestamp, session_id, anonymous_id, path, referrer, properties_json, device_type, browser, operating_system, country, app_version, login_success, login_environment, country_code, country_name, city, geo_enrichment_status) VALUES (@id, @project, 'deck.auth.login.succeeded.v1', @now, 's', 'a', '/', '', '{}', 'desktop', 'Unknown', 'Unknown', '', '', 1, 'staging', 'US', 'United States', 'Chicago', 'enriched')",
      { id: randomUUID(), project: created.id, now: new Date().toISOString() },
    );
    await migrate(db);
    await migrate(db);
    const [row] = await db.query<{
      event_environment: string;
      city: string;
      geo_enrichment_status: string;
      login_success: number;
    }>('SELECT * FROM events');
    assert.equal(row.event_environment, 'staging');
    assert.equal(row.city, 'Chicago');
    assert.equal(row.geo_enrichment_status, 'enriched');
    assert.equal(row.login_success, 1);
    assert.deepEqual(
      (await db.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version')).map(
        (r) => r.version,
      ),
      [1, 2, 3, 4],
    );
  } finally {
    await db.close();
  }
});

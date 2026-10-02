import 'dotenv/config';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { Project } from '@house-edge/shared';
import { connect, migrate } from '@house-edge/database';
import { geographyEnabled, stageGeography, processGeographyJobs } from '@house-edge/database/geolocation';

const file = process.argv[2];
if (!file) throw new Error('Usage: npm run geo:backfill -- /path/to/authorized-source.ndjson [checkpoint.json]');
if (!geographyEnabled()) throw new Error('Event geography is disabled');
if (!/^[a-f\d]{64}$/i.test(process.env.GEO_QUEUE_KEY || '')) throw new Error('Configure GEO_QUEUE_KEY before backfill');
const checkpoint = process.argv[3] || '.data/geography-backfill.json';
const stat = await fs.stat(file);
const sourceId = createHash('sha256').update(`${file}:${stat.size}:${stat.mtimeMs}`).digest('hex');
let state = { sourceId, line: 0, queued: 0, skipped: 0, failed: 0, enriched: 0, enrichmentFailed: 0 };
try {
  const saved = JSON.parse(await fs.readFile(checkpoint, 'utf8'));
  if (saved.sourceId !== sourceId) throw new Error('Checkpoint belongs to a different source; choose a new checkpoint');
  state = saved;
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
const sourceSchema = z.object({
  eventId: z.string().uuid(),
  projectId: z.string().uuid(),
  sourceIp: z.string().max(64),
});
const db = await connect();
await migrate(db);
async function save() {
  await fs.mkdir(path.dirname(checkpoint), { recursive: true });
  await fs.writeFile(`${checkpoint}.tmp`, JSON.stringify(state), { mode: 0o600 });
  await fs.rename(`${checkpoint}.tmp`, checkpoint);
}
try {
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let n = 0;
  for await (const line of lines) {
    n++;
    if (n <= state.line) continue;
    try {
      if (line.length > 4096) throw new Error('Oversized source record');
      const record = sourceSchema.parse(JSON.parse(line));
      const [event] = await db.query<{
        id: string;
        event_name: string;
        timestamp: string;
        session_id: string;
        anonymous_id: string;
        auth_provider: string | null;
        login_environment: string | null;
        event_environment: string | null;
        geo_enrichment_status: string | null;
      }>(
        'SELECT id, event_name, timestamp, session_id, anonymous_id, auth_provider, login_environment, event_environment, geo_enrichment_status FROM events WHERE id = @id AND project_id = @project',
        { id: record.eventId, project: record.projectId },
      );
      const [project] = await db.query<Project>('SELECT * FROM projects WHERE id = @id', { id: record.projectId });
      if (
        !event ||
        !project ||
        (process.env.GEO_PRODUCTION_ONLY === 'true' &&
          (event.event_environment || event.login_environment || project.environment) !== 'production') ||
        Date.parse(event.timestamp) <
          Date.now() - Math.max(1, Math.min(730, Number(process.env.GEO_RETENTION_DAYS) || 30)) * 86400000 ||
        ['enriched', 'pending'].includes(event.geo_enrichment_status || '')
      ) {
        state.skipped++;
      } else {
        const reset = await db.transaction(async (tx) => {
          const updated = await tx.execute(
            "UPDATE events SET geo_enrichment_status = NULL WHERE id = @id AND COALESCE(geo_enrichment_status, '') NOT IN ('enriched', 'pending')",
            { id: event.id },
          );
          if (updated) await tx.execute('DELETE FROM geo_jobs WHERE event_id = @id', { id: event.id });
          return updated;
        });
        if (!reset) {
          state.skipped++;
          state.line = n;
          continue;
        }
        await stageGeography(
          db,
          project,
          [
            {
              id: event.id,
              event: event.event_name,
              timestamp: event.timestamp,
              sessionId: event.session_id,
              anonymousId: event.anonymous_id,
              properties: {},
              sourceIp: record.sourceIp,
              environment: (event.event_environment || event.login_environment || project.environment) as
                'production' | 'staging' | 'development' | 'test',
              ...(/^(?:[a-z0-9-]+\.)?auth\.login\.(succeeded|failed)\.v1$/.test(event.event_name)
                ? {
                    login: {
                      success: event.event_name.includes('.succeeded.'),
                      provider: event.auth_provider || 'unknown',
                    },
                  }
                : {}),
            },
          ],
          { ip: null, country: null },
          true,
        );
        state.queued++;
      }
    } catch {
      state.failed++;
    } // Never print a line containing sensitive IP data.
    state.line = n;
    if (n % 100 === 0) {
      const result = await processGeographyJobs(db, 100);
      state.enriched += result.enriched;
      state.enrichmentFailed = (state.enrichmentFailed || 0) + result.failed;
      await save();
      console.log(JSON.stringify(state));
    }
  }
  let result;
  do {
    result = await processGeographyJobs(db, 100);
    state.enriched += result.enriched;
    state.enrichmentFailed = (state.enrichmentFailed || 0) + result.failed;
  } while (result.processed);
  await save();
  console.log(JSON.stringify({ ...state, complete: true }));
} finally {
  await db.close();
}

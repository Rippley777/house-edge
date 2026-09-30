import { batchSchema } from '@house-edge/shared';
import { consumeRateLimit, getDb, hashKey, ingest } from '@house-edge/database';
import type { Project } from '@house-edge/shared';

export const MAX_BODY_BYTES = 65536;
export async function readLimitedJson(request: Request, limit = MAX_BODY_BYTES) {
  if (Number(request.headers.get('content-length') || 0) > limit) throw new Error('Payload exceeds size limit');
  if (!request.body) throw new Error('Empty request');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new Error('Payload exceeds size limit'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { reader.releaseLock(); }
}
function cors(origin: string) {
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin', 'Cache-Control': 'no-store' };
}
export async function collectorOptions(request: Request) {
  const origin = request.headers.get('origin'); if (!origin) return new Response(null, { status: 403 });
  const db = await getDb();
  const projects = await db.query<Project>('SELECT * FROM projects WHERE active = 1');
  if (!projects.some(p => (JSON.parse(p.allowed_origins) as string[]).includes(origin))) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: cors(origin) });
}
export async function collect(request: Request) {
  let payload: unknown;
  try { payload = await readLimitedJson(request); }
  catch (error) { return Response.json({ error: (error as Error).message.includes('size limit') ? 'Payload too large' : 'Invalid JSON payload' }, { status: (error as Error).message.includes('size limit') ? 413 : 400 }); }
  const parsed = batchSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: 'Invalid event batch', issues: parsed.error.issues.map(i => ({ path: i.path, message: i.message })) }, { status: 400 });
  const { projectKey, key, events } = parsed.data;
  const db = await getDb();
  const [project] = await db.query<Project & { scope: string }>(`SELECT p.*, k.scope FROM projects p JOIN api_keys k ON k.project_id = p.id WHERE p.project_key = @key AND k.key_hash = @hash AND k.revoked_at IS NULL AND p.active = 1`, { key: projectKey, hash: hashKey(key) });
  if (!project) return Response.json({ error: 'Invalid ingestion key' }, { status: 401 });
  const origin = request.headers.get('origin');
  const origins: string[] = JSON.parse(project.allowed_origins);
  if ((project.scope === 'ingest' && (!origin || !origins.includes(origin))) || (project.scope === 'server' && origin)) return Response.json({ error: 'Origin is not allowed for this key' }, { status: 403 });
  const headers = origin ? cors(origin) : { 'Cache-Control': 'no-store' };
  const now = Date.now();
  if (events.some(e => Date.parse(e.timestamp) > now + 5 * 60000 || Date.parse(e.timestamp) < now - 7 * 86400000)) return Response.json({ error: 'Event timestamps must be within the past 7 days and no more than 5 minutes in the future' }, { status: 400, headers });
  if (!await consumeRateLimit(db, `ingest:${project.id}`, events.length, Number(process.env.INGESTION_EVENTS_PER_MINUTE) || 6000)) return Response.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { ...headers, 'Retry-After': '60' } });
  const result = await ingest(db, project, events);
  return Response.json(result, { status: 202, headers });
}

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { audit, consumeRateLimit, createProject, getDb, isDemo, issueKey } from '@house-edge/database';
import { getOverview, sessionDetail, viewData } from '@house-edge/engine';
import { readLimitedJson } from '@house-edge/collector';
import { authorized, COOKIE, createSession, safeEqual, trustedMutation } from '@/lib/auth';
import type { Filters } from '@house-edge/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const id = z.string().uuid();
const origin = z.string().url().refine(s => { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) && u.origin === s; }, 'Use a full origin without a trailing slash or path');
const projectSchema = z.object({
  name: z.string().trim().min(2).max(120), projectKey: z.string().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  domain: z.string().min(1).max(253).regex(/^[a-zA-Z0-9.-]+(?::\d+)?$/),
  origins: z.array(origin).min(1).max(20), environment: z.enum(['production', 'staging', 'development']).default('production'),
});
function filters(url: URL): Filters {
  const to = url.searchParams.get('to') || new Date().toISOString();
  const from = url.searchParams.get('from') || new Date(Date.now() - 7 * 86400000).toISOString();
  if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) > Date.parse(to) || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new Error('Select a valid date range of at most 366 days');
  const minDuration = url.searchParams.get('minDuration');
  if (minDuration && (!Number.isFinite(Number(minDuration)) || Number(minDuration) < 0)) throw new Error('Duration must be a positive number');
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), project: url.searchParams.get('project') || undefined, search: url.searchParams.get('search')?.slice(0, 120), event: url.searchParams.get('event')?.slice(0, 120), property: url.searchParams.get('property') || undefined, value: url.searchParams.get('value') || undefined, minDuration: minDuration ? Number(minDuration) : undefined };
}
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params; const resource = path[0];
  if (resource === 'health') { try { const db = await getDb(); await db.query('SELECT 1 AS healthy'); return json({ status: 'ok' }); } catch { return json({ status: 'unavailable' }, 503); } }
  if (!authorized(request)) return json({ error: 'Authentication required' }, 401);
  try {
    const db = await getDb(); const url = new URL(request.url);
    if (resource === 'projects') return json(await db.query('SELECT * FROM projects ORDER BY name'));
    const f = filters(url);
    if (isDemo() && Date.parse(f.to) >= Date.now() - 60000 && (resource === 'overview' || url.searchParams.get('view') === 'live')) {
      const { tickDemo } = await import('@house-edge/database/seed');
      await tickDemo(db);
      f.to = new Date().toISOString();
    }
    if (resource === 'overview') return json(await getOverview(f));
    if (resource === 'session') return json(await sessionDetail(url.searchParams.get('project') || '', url.searchParams.get('session') || '', f.to));
    if (resource === 'data' || resource === 'export') {
      const view = url.searchParams.get('view') || 'events';
      const data = await viewData(view, f, { offset: Math.max(0, Math.min(1000000, Number(url.searchParams.get('offset')) || 0)), interval: z.enum(['daily', 'weekly', 'monthly']).catch('weekly').parse(url.searchParams.get('interval')) });
      if (resource === 'data') return json(data);
      const columns = data.rows.length ? Object.keys(data.rows[0]) : [];
      const cell = (v: unknown) => { const str = String(v ?? ''); return `"${(/^[=+\-@\t\r]/.test(str) ? "'" : '') + str.replaceAll('"', '""')}"`; };
      return new Response([columns.map(cell).join(','), ...data.rows.map(row => columns.map(c => cell(row[c])).join(','))].join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="house-edge-${view.replace(/[^a-z-]/g, '')}.csv"`, 'Cache-Control': 'no-store' } });
    }
    return json({ error: 'Route not found' }, 404);
  } catch (error) {
    console.error('Analytics request failed', error);
    return json({ error: error instanceof Error && error.message.startsWith('Select a valid') ? error.message : 'Unable to load analytics. Check your database connection and migrations.' }, 400);
  }
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params; const resource = path[0];
  if (!trustedMutation(request)) return json({ error: 'Untrusted request origin' }, 403);
  try {
    const db = await getDb();
    if (resource === 'login') {
      if (!await consumeRateLimit(db, 'admin-login', 1, 10, 60000)) return json({ error: 'Too many sign-in attempts. Try again in one minute.' }, 429);
      const body = z.object({ key: z.string().max(200) }).parse(await readLimitedJson(request, 2048));
      if (!process.env.ADMIN_KEY || process.env.ADMIN_KEY.length < 32 || !safeEqual(body.key, process.env.ADMIN_KEY)) return json({ error: 'Invalid administrative key' }, 401);
      const session = createSession();
      await db.transaction(tx => audit(tx, 'admin.login', 'dashboard'));
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': `${COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.PUBLIC_URL?.startsWith('https://') ? '; Secure' : ''}` } });
    }
    if (!authorized(request)) return json({ error: 'Authentication required' }, 401);
    if (resource === 'logout') return new Response('{}', { headers: { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` } });
    if (resource === 'maintenance') { const { maintain } = await import('@house-edge/engine/maintenance'); return json(await maintain(db)); }
    const body = await readLimitedJson(request);
    if (resource === 'projects') return json(await createProject(db, projectSchema.parse(body)), 201);
    if (resource === 'project-settings') {
      const data = z.object({ id, origins: z.array(origin).min(1).max(20), blockedProperties: z.array(z.string().min(1).max(80)).max(50) }).parse(body);
      return json(await db.transaction(async tx => {
        const updated = await tx.execute('UPDATE projects SET allowed_origins = @origins, blocked_properties = @blocked WHERE id = @id', { id: data.id, origins: JSON.stringify(data.origins), blocked: JSON.stringify(data.blockedProperties) });
        if (!updated) throw new Error('Project not found'); await audit(tx, 'project.settings_updated', data.id); return { ok: true };
      }));
    }
    if (resource === 'keys') {
      const data = z.object({ projectId: id, scope: z.enum(['ingest', 'server']).default('ingest'), revokeId: id.optional(), revokeOnly: z.boolean().optional() }).parse(body);
      return json(await db.transaction(async tx => {
        const exists = await tx.query('SELECT id FROM projects WHERE id = @id', { id: data.projectId }); if (!exists.length) throw new Error('Project not found');
        if (data.revokeId) await tx.execute('UPDATE api_keys SET revoked_at = @now WHERE id = @id AND project_id = @project', { id: data.revokeId, project: data.projectId, now: new Date().toISOString() });
        const key = data.revokeOnly ? null : await issueKey(tx, data.projectId, data.scope);
        await audit(tx, data.revokeOnly ? 'key.revoked' : data.revokeId ? 'key.rotated' : 'key.created', data.projectId, { scope: data.scope });
        return { key };
      }));
    }
    if (resource === 'deployments') {
      const data = z.object({ projectId: id, version: z.string().min(1).max(80), commitSha: z.string().max(64).regex(/^[a-fA-F0-9]*$/), environment: z.enum(['production', 'staging', 'development']).default('production') }).parse(body);
      const deploymentId = randomUUID();
      await db.transaction(async tx => { await tx.execute('INSERT INTO deployments (id, project_id, version, commit_sha, environment, deployed_at) VALUES (@id, @project, @version, @sha, @environment, @now)', { id: deploymentId, project: data.projectId, version: data.version, sha: data.commitSha, environment: data.environment, now: new Date().toISOString() }); await audit(tx, 'deployment.created', deploymentId); });
      return json({ id: deploymentId }, 201);
    }
    if (resource === 'features') {
      const data = z.object({ projectId: id, name: z.string().min(1).max(120), event: z.string().min(1).max(120) }).parse(body);
      const featureId = randomUUID();
      await db.transaction(async tx => { await tx.execute('INSERT INTO features (id, project_id, name, event_name, created_at) VALUES (@id, @project, @name, @event, @now)', { id: featureId, project: data.projectId, name: data.name, event: data.event, now: new Date().toISOString() }); await audit(tx, 'feature.created', featureId); });
      return json({ id: featureId }, 201);
    }
    if (resource === 'funnels') {
      const data = z.object({ name: z.string().min(1).max(120), projectId: id.nullable(), steps: z.array(z.string().min(1).max(120)).min(2).max(8), windowHours: z.number().int().min(1).max(168).default(24) }).parse(body);
      const funnelId = randomUUID();
      await db.transaction(async tx => { await tx.execute('INSERT INTO funnels (id, name, project_id, steps_json, window_hours, created_at) VALUES (@id, @name, @project, @steps, @window, @now)', { id: funnelId, name: data.name, project: data.projectId, steps: JSON.stringify(data.steps), window: data.windowHours, now: new Date().toISOString() }); await audit(tx, 'funnel.created', funnelId); });
      return json({ id: funnelId }, 201);
    }
    if (resource === 'saved') {
      const data = z.object({ name: z.string().min(1).max(120), viewType: z.enum(['overview', 'events', 'sessions', 'users', 'errors', 'performance', 'features', 'retention', 'releases', 'projects', 'live']), filters: z.record(z.string(), z.union([z.string(), z.number()])) }).parse(body);
      const viewId = randomUUID();
      await db.transaction(async tx => { await tx.execute('INSERT INTO saved_views (id, name, view_type, filters_json, created_at) VALUES (@id, @name, @view, @filters, @now)', { id: viewId, name: data.name, view: data.viewType, filters: JSON.stringify(data.filters), now: new Date().toISOString() }); await audit(tx, 'view.saved', viewId); });
      return json({ id: viewId }, 201);
    }
    if (resource === 'alerts') {
      const data = z.object({ name: z.string().min(1).max(120), projectId: id.nullable(), metric: z.enum(['error_rate', 'p95_latency', 'silence_minutes', 'traffic_drop', 'conversion_drop']), operator: z.enum(['gt', 'lt']).default('gt'), threshold: z.number().finite().min(0).max(100000), enabled: z.boolean().default(true) }).parse(body);
      const alertId = randomUUID();
      await db.transaction(async tx => { await tx.execute('INSERT INTO alerts (id, name, project_id, metric, operator, threshold, enabled, created_at) VALUES (@id, @name, @project, @metric, @operator, @threshold, @enabled, @now)', { id: alertId, name: data.name, project: data.projectId, metric: data.metric, operator: data.operator, threshold: data.threshold, enabled: data.enabled ? 1 : 0, now: new Date().toISOString() }); await audit(tx, 'alert.created', alertId); });
      return json({ id: alertId }, 201);
    }
    if (resource === 'alert-toggle') {
      const data = z.object({ id, enabled: z.boolean() }).parse(body);
      await db.transaction(async tx => { await tx.execute('UPDATE alerts SET enabled = @enabled WHERE id = @id', { enabled: data.enabled ? 1 : 0, id: data.id }); await audit(tx, 'alert.toggled', data.id); }); return json({ ok: true });
    }
    if (resource === 'delete') {
      const data = z.object({ id, type: z.enum(['saved_views', 'alerts', 'funnels', 'features']) }).parse(body);
      await db.transaction(async tx => { if (data.type === 'alerts') await tx.execute('DELETE FROM alert_incidents WHERE alert_id = @id', { id: data.id }); await tx.execute(`DELETE FROM ${data.type} WHERE id = @id`, { id: data.id }); await audit(tx, `${data.type}.deleted`, data.id); }); return json({ ok: true });
    }
    if (resource === 'settings') {
      const data = z.object({ retentionDays: z.number().int().min(7).max(730) }).parse(body);
      await db.transaction(async tx => { await tx.execute("DELETE FROM settings WHERE setting_key = 'retention_days'"); await tx.execute("INSERT INTO settings (setting_key, value) VALUES ('retention_days', @value)", { value: String(data.retentionDays) }); await audit(tx, 'retention.updated', 'settings', data); }); return json({ ok: true });
    }
    return json({ error: 'Route not found' }, 404);
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE|duplicate/i.test(message)) return json({ error: 'That project key or feature event already exists.' }, 409);
    console.error('Administrative request failed', error);
    return json({ error: 'Unable to save. Check your input and database configuration.' }, 400);
  }
}

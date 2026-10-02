import { change, type Filters, type MetricSet, type Overview, type Project, type EventRow, type SeriesPoint, type ProjectMetrics, type Insight } from '@house-edge/shared';
import { datePart, getDb, isDemo, limitQuery, type Connection, type Params } from '@house-edge/database';

export type Row = Record<string, string | number | null>;
export interface ViewData { rows: Row[]; total?: number; summary?: Record<string, number>; extra?: unknown; }
export function jsonValue(db: Connection, column: string, property: string) {
  if (!/^[a-zA-Z0-9_]+$/.test(property)) throw new Error('Invalid JSON property');
  return db.dialect === 'azure' ? `JSON_VALUE(${column}, '$.${property}')` : `json_extract(${column}, '$.${property}')`;
}
async function projectRetention(db: Connection, project: string, f: Filters, previousUsers?: number) {
  const previous = previousFilters(f);
  const [row] = await db.query<{ returned: number; visitors: number }>(`SELECT COUNT(*) AS visitors, COALESCE(SUM(returned),0) AS returned FROM (SELECT DISTINCT e.anonymous_id, CASE WHEN EXISTS (SELECT 1 FROM events n WHERE n.project_id = e.project_id AND n.anonymous_id = e.anonymous_id AND n.timestamp >= @from AND n.timestamp <= @to) THEN 1 ELSE 0 END AS returned FROM events e WHERE e.project_id = @project AND e.timestamp >= @previousFrom AND e.timestamp <= @previousTo) cohort`, { project, from: f.from, to: f.to, previousFrom: previous.from, previousTo: previous.to });
  const denominator = previousUsers ?? row.visitors;
  return denominator ? row.returned / denominator * 100 : 0;
}
export function where(filters: Filters, alias = 'e', timeColumn = 'timestamp') {
  const params: Params = { from: filters.from, to: filters.to };
  let clause = `${alias}.${timeColumn} >= @from AND ${alias}.${timeColumn} <= @to`;
  if (filters.project && filters.project !== 'all') { clause += ` AND ${alias}.project_id = @project`; params.project = filters.project; }
  return { clause, params };
}
export function previousFilters(f: Filters): Filters {
  const span = Date.parse(f.to) - Date.parse(f.from) + 1;
  return { ...f, from: new Date(Date.parse(f.from) - span).toISOString(), to: new Date(Date.parse(f.from) - 1).toISOString() };
}
export async function metrics(db: Connection, filters: Filters): Promise<MetricSet> {
  const { clause, params } = where(filters);
  const projectClause = filters.project && filters.project !== 'all' ? ' AND project_id = @project' : '';
  // Full days come from rollups; only partial boundary days inspect raw events.
  const fromDay = filters.from.slice(0, 10); const toDay = filters.to.slice(0, 10);
  const [rolled] = await db.query<{ events: number; pageViews: number; conversions: number; errors: number }>(`SELECT COALESCE(SUM(events),0) AS events, COALESCE(SUM(page_views),0) AS pageViews, COALESCE(SUM(conversions),0) AS conversions, COALESCE(SUM(errors),0) AS errors FROM daily_rollups WHERE day > @first AND day < @last${projectClause}`, { first: fromDay, last: toDay, ...(params.project ? { project: params.project } : {}) });
  const [boundary] = await db.query<{ events: number; pageViews: number; conversions: number; errors: number }>(`SELECT COUNT(*) AS events, COALESCE(SUM(CASE WHEN event_name = 'page_view' THEN 1 ELSE 0 END),0) AS pageViews, COALESCE(SUM(CASE WHEN event_name IN ('conversion','signup') THEN 1 ELSE 0 END),0) AS conversions, COALESCE(SUM(CASE WHEN event_name = 'error' THEN 1 ELSE 0 END),0) AS errors FROM events e WHERE ${clause} AND (${datePart(db, 'e.timestamp')} = @first OR ${datePart(db, 'e.timestamp')} = @last)`, { ...params, first: fromDay, last: toDay });
  const [users] = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM (
    SELECT project_id, anonymous_id FROM daily_users WHERE day > @first AND day < @last${projectClause}
    UNION SELECT e.project_id, e.anonymous_id FROM events e WHERE ${clause} AND (${datePart(db, 'e.timestamp')} = @first OR ${datePart(db, 'e.timestamp')} = @last)
    ) visitors`, { ...params, first: fromDay, last: toDay });
  const s = where(filters, 's', 'first_seen');
  // Clamp sessions at the selected endpoint so historical snapshots cannot see future activity.
  const lastKnown = '(SELECT MAX(he.timestamp) FROM events he WHERE he.project_id = s.project_id AND he.session_id = s.session_id AND he.timestamp <= @to)';
  const clippedDuration = db.dialect === 'azure' ? `DATEDIFF_BIG(millisecond, CAST(s.first_seen AS datetime2), CAST(${lastKnown} AS datetime2))` : `(julianday(${lastKnown}) - julianday(s.first_seen)) * 86400000`;
  // SQL Server disallows aggregates over expressions containing subqueries; use a derived table.
  const [sessions] = await db.query<{ n: number; duration: number }>(`SELECT COUNT(*) AS n, COALESCE(AVG(observed_duration),0) AS duration FROM (SELECT CASE WHEN s.last_seen <= @to THEN s.duration_ms ELSE ${clippedDuration} END AS observed_duration FROM sessions s WHERE ${s.clause}) observed_sessions`, s.params);
  return {
    events: rolled.events + boundary.events, pageViews: rolled.pageViews + boundary.pageViews,
    conversions: rolled.conversions + boundary.conversions, errors: rolled.errors + boundary.errors,
    users: users.n, sessions: sessions.n,
    avgDuration: Math.max(0, sessions.duration),
  };
}
export async function series(db: Connection, filters: Filters): Promise<SeriesPoint[]> {
  const { clause, params } = where(filters);
  const span = Date.parse(filters.to) - Date.parse(filters.from);
  const short = span <= 2 * 86400000;
  const part = datePart(db, 'e.timestamp', short ? 13 : 10);
  if (short) return db.query<SeriesPoint>(`SELECT ${part} AS date, COUNT(*) AS events, COUNT(DISTINCT anonymous_id) AS users, COUNT(DISTINCT session_id) AS sessions, SUM(CASE WHEN event_name='page_view' THEN 1 ELSE 0 END) AS pageViews, SUM(CASE WHEN event_name='error' THEN 1 ELSE 0 END) AS errors, SUM(CASE WHEN event_name IN ('conversion','signup') THEN 1 ELSE 0 END) AS conversions FROM events e WHERE ${clause} GROUP BY ${part} ORDER BY date`, params);
  const projectClause = params.project ? ' AND project_id = @project' : '';
  const rows = await db.query<SeriesPoint>(`SELECT day AS date, SUM(events) AS events, SUM(users) AS users, SUM(sessions) AS sessions, SUM(page_views) AS pageViews, SUM(errors) AS errors, SUM(conversions) AS conversions FROM daily_rollups WHERE day > @first AND day < @last${projectClause} GROUP BY day ORDER BY day`, { first: filters.from.slice(0, 10), last: filters.to.slice(0, 10), ...(params.project ? { project: params.project } : {}) });
  const boundaries = await db.query<SeriesPoint>(`SELECT ${part} AS date, COUNT(*) AS events, COUNT(DISTINCT anonymous_id) AS users, COUNT(DISTINCT session_id) AS sessions, SUM(CASE WHEN event_name='page_view' THEN 1 ELSE 0 END) AS pageViews, SUM(CASE WHEN event_name='error' THEN 1 ELSE 0 END) AS errors, SUM(CASE WHEN event_name IN ('conversion','signup') THEN 1 ELSE 0 END) AS conversions FROM events e WHERE ${clause} AND (${part} = @first OR ${part} = @last) GROUP BY ${part}`, { ...params, first: filters.from.slice(0, 10), last: filters.to.slice(0, 10) });
  return [...rows, ...boundaries].sort((a, b) => a.date.localeCompare(b.date));
}
export async function getOverview(filters: Filters): Promise<Overview> {
  const db = await getDb();
  const previous = previousFilters(filters);
  const projects = await db.query<Project>(`SELECT * FROM projects WHERE active = 1${filters.project && filters.project !== 'all' ? ' AND id = @project' : ''} ORDER BY name`, filters.project && filters.project !== 'all' ? { project: filters.project } : {});
  const projectMetrics: ProjectMetrics[] = [];
  for (const p of projects) {
    const [current, prior, active] = await Promise.all([
      metrics(db, { ...filters, project: p.id }), metrics(db, { ...previous, project: p.id }),
      db.query<{ n: number }>('SELECT COUNT(DISTINCT anonymous_id) AS n FROM events WHERE project_id = @project AND timestamp >= @since AND timestamp <= @now', { project: p.id, since: new Date(Date.parse(filters.to) - 300000).toISOString(), now: filters.to }),
    ]);
    const retentionRate = await projectRetention(db, p.id, filters, prior.users);
    const previousRetention = await projectRetention(db, p.id, previous);
    const timings = await db.query<{ timestamp: string; duration_ms: number }>(limitQuery(db, `SELECT timestamp, duration_ms FROM events WHERE project_id = @project AND event_name = 'performance' AND duration_ms IS NOT NULL AND timestamp >= @from AND timestamp <= @to AND ${jsonValue(db, 'properties_json', 'metric')} <> 'CLS' ORDER BY timestamp DESC`, 100000), { project: p.id, from: previous.from, to: filters.to });
    const currentP95 = percentile(timings.filter(e => e.timestamp >= filters.from).map(e => e.duration_ms).sort((a,b) => a-b), .95);
    const previousP95 = percentile(timings.filter(e => e.timestamp < filters.from).map(e => e.duration_ms).sort((a,b) => a-b), .95);
    projectMetrics.push({ ...p, ...current, activeUsers: active[0].n, change: change(current.users, prior.users), previousUsers: prior.users, errorRate: current.events ? current.errors / current.events * 100 : 0,
      retentionRate, retentionChange: change(retentionRate, previousRetention), errorChange: change(current.errors, prior.errors),
      p95Latency: currentP95, performanceChange: change(currentP95, previousP95), engagementChange: change(current.avgDuration, prior.avgDuration),
    });
  }
  projectMetrics.sort((a, b) => b.events - a.events);
  const [current, prior, points, previousSeries, recent] = await Promise.all([metrics(db, filters), metrics(db, previous), series(db, filters), series(db, previous), getEvents(db, filters, 8)]);
  const d = where(filters, 'd', 'deployed_at');
  const deployments = await db.query<Overview['deployments'][number]>(limitQuery(db, `SELECT d.*, p.name AS project_name FROM deployments d JOIN projects p ON p.id = d.project_id WHERE ${d.clause} ORDER BY d.deployed_at DESC`, 30), d.params);
  const insights: Insight[] = projectMetrics.filter(p => p.users || p.previousUsers).map(p => ({
    id: `${p.id}-traffic`, project: p.name, projectId: p.id, title: `${p.name} traffic ${p.change >= 0 ? 'increased' : 'decreased'} ${Math.abs(p.change)}%.`,
    detail: `${p.users.toLocaleString()} visitors, compared with ${p.previousUsers.toLocaleString()} in the previous period.`,
    kind: p.change >= 0 ? 'positive' as const : 'warning' as const, metric: 'users', value: p.change,
  }));
  const risky = projectMetrics.filter(p => p.errors > 0).sort((a, b) => b.errorRate - a.errorRate)[0];
  if (risky) insights.push({ id: `${risky.id}-errors`, project: risky.name, projectId: risky.id, title: `${risky.name} recorded ${risky.errors} errors.`, detail: `${risky.errorRate.toFixed(2)}% of ${risky.events.toLocaleString()} events in the selected period.`, kind: risky.errorRate > 1 ? 'warning' : 'neutral', metric: 'errors', value: risky.errors });
  for (const p of projectMetrics) {
    if (p.p95Latency && Math.abs(p.performanceChange) >= 10) insights.push({ id: `${p.id}-performance`, project: p.name, projectId: p.id, title: `${p.name} P95 timing ${p.performanceChange < 0 ? 'improved' : 'increased'} ${Math.abs(p.performanceChange).toFixed(1)}%.`, detail: `${Math.round(p.p95Latency)}ms across recorded timing samples in this period.`, kind: p.performanceChange < 0 ? 'positive' : 'warning', metric: 'performance', value: p.performanceChange });
    if (p.retentionRate && Math.abs(p.retentionChange) >= 10) insights.push({ id: `${p.id}-retention`, project: p.name, projectId: p.id, title: `${p.name} retained ${p.retentionRate.toFixed(1)}% of previous visitors.`, detail: `${Math.abs(p.retentionChange).toFixed(1)}% ${p.retentionChange > 0 ? 'higher' : 'lower'} retention than the preceding comparison.`, kind: p.retentionChange > 0 ? 'positive' : 'warning', metric: 'retention', value: p.retentionChange });
  }
  insights.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return { current, previous: prior, activeUsers: projectMetrics.reduce((s, p) => s + p.activeUsers, 0), series: points, previousSeries, projects: projectMetrics, recent, insights, deployments, demo: isDemo(), generatedAt: new Date().toISOString() };
}

export function eventFilter(db: Connection, filters: Filters) {
  const w = where(filters);
  if (filters.event) { w.clause += ' AND e.event_name = @event'; w.params.event = filters.event; }
  if (filters.search) { w.clause += " AND (e.event_name LIKE @search OR e.path LIKE @search OR e.session_id LIKE @search OR e.anonymous_id LIKE @search OR e.app_version LIKE @search OR e.referrer LIKE @search)"; w.params.search = `%${filters.search.slice(0, 120)}%`; }
  if (filters.minDuration !== undefined) { w.clause += ' AND e.duration_ms > @minimum'; w.params.minimum = filters.minDuration; }
  if (filters.property && /^[a-zA-Z0-9_]{1,60}$/.test(filters.property) && filters.value !== undefined) {
    const json = db.dialect === 'azure' ? `JSON_VALUE(e.properties_json, '$.${filters.property}')` : `json_extract(e.properties_json, '$.${filters.property}')`;
    w.clause += ` AND ${json} = @propertyValue`; w.params.propertyValue = filters.value;
  }
  return w;
}
export async function getEvents(db: Connection, filters: Filters, limit = 100, offset = 0): Promise<EventRow[]> {
  const { clause, params } = eventFilter(db, filters);
  const query = `SELECT e.id, e.project_id, e.event_name, e.timestamp, e.session_id, e.anonymous_id, e.user_id, e.path, e.referrer, e.properties_json, e.device_type, e.browser, e.operating_system, e.country, e.duration_ms, e.app_version, e.error_fingerprint, e.event_environment, e.country_code, e.country_name, e.region, e.city, e.timezone, e.location_accuracy_level, e.geo_enrichment_status, p.name AS project_name, p.color FROM events e JOIN projects p ON p.id = e.project_id WHERE ${clause} ORDER BY e.timestamp DESC, e.id DESC`;
  if (offset > 0) return db.query(`${query} ${db.dialect === 'azure' ? `OFFSET ${Math.floor(offset)} ROWS FETCH NEXT ${limit} ROWS ONLY` : `LIMIT ${limit} OFFSET ${Math.floor(offset)}`}`, params);
  return db.query(limitQuery(db, query, limit), params);
}
export async function sessionDetail(project: string, session: string, at: string) {
  const db = await getDb();
  return db.query<EventRow>('SELECT e.id, e.project_id, e.event_name, e.timestamp, e.session_id, e.anonymous_id, e.user_id, e.path, e.referrer, e.properties_json, e.device_type, e.browser, e.operating_system, e.country, e.duration_ms, e.app_version, e.error_fingerprint, e.event_environment, e.country_code, e.country_name, e.region, e.city, e.timezone, e.location_accuracy_level, e.geo_enrichment_status, p.name AS project_name, p.color FROM events e JOIN projects p ON p.id = e.project_id WHERE e.project_id = @project AND e.session_id = @session AND e.timestamp <= @at ORDER BY e.timestamp, e.id', { project, session, at });
}
export async function features(db: Connection, f: Filters): Promise<Row[]> {
  const prev = previousFilters(f);
  const params: Params = { from: f.from, to: f.to, prevFrom: prev.from, prevTo: prev.to, ...(f.project && f.project !== 'all' ? { project: f.project } : {}) };
  return db.query<Row>(`SELECT ft.id, ft.name, ft.event_name, ft.project_id, p.name AS project_name, p.color,
    COUNT(DISTINCT CASE WHEN e.timestamp >= @from THEN e.anonymous_id END) AS users,
    COUNT(DISTINCT CASE WHEN e.timestamp <= @prevTo THEN e.anonymous_id END) AS previous_users,
    SUM(CASE WHEN e.timestamp >= @from THEN 1 ELSE 0 END) AS occurrences,
    MAX(e.timestamp) AS last_used
    FROM features ft JOIN projects p ON p.id = ft.project_id LEFT JOIN events e ON e.project_id = ft.project_id AND e.event_name = ft.event_name AND e.timestamp <= @to
    WHERE ft.created_at <= @to${params.project ? ' AND ft.project_id = @project' : ''}
    GROUP BY ft.id, ft.name, ft.event_name, ft.project_id, p.name, p.color`, params).then(async rows => {
      const totals = new Map<string, number>();
      for (const row of rows) if (!totals.has(String(row.project_id))) totals.set(String(row.project_id), (await metrics(db, { ...f, project: String(row.project_id) })).users);
      // Previous comparison is bounded separately to avoid treating all historical usage as the prior period.
      for (const row of rows) {
        const [prior] = await db.query<{ users: number }>('SELECT COUNT(DISTINCT anonymous_id) AS users FROM events WHERE project_id = @project AND event_name = @event AND timestamp >= @from AND timestamp <= @to', { project: String(row.project_id), event: String(row.event_name), from: prev.from, to: prev.to });
        const [repeat] = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM (SELECT anonymous_id FROM events WHERE project_id = @project AND event_name = @event AND timestamp >= @from AND timestamp <= @to GROUP BY anonymous_id HAVING COUNT(*) > 1) returning_users', { project: String(row.project_id), event: String(row.event_name), from: f.from, to: f.to });
        row.previous_users = prior.users; row.change = change(Number(row.users), prior.users);
        row.adoption = totals.get(String(row.project_id)) ? Number(row.users) / totals.get(String(row.project_id))! * 100 : 0;
        row.repeat_usage = Number(row.users) ? repeat.n / Number(row.users) * 100 : 0;
        const [retained] = await db.query<{ n: number }>(`SELECT COUNT(DISTINCT e.anonymous_id) AS n FROM events e WHERE e.project_id = @project AND e.event_name = @event AND e.timestamp >= @from AND e.timestamp <= @to AND EXISTS (SELECT 1 FROM events p WHERE p.project_id = e.project_id AND p.anonymous_id = e.anonymous_id AND p.event_name = e.event_name AND p.timestamp >= @previousFrom AND p.timestamp <= @previousTo)`, { project: String(row.project_id), event: String(row.event_name), from: f.from, to: f.to, previousFrom: prev.from, previousTo: prev.to });
        row.retention = prior.users ? retained.n / prior.users * 100 : 0;
        row.days_inactive = row.last_used ? Math.floor((Date.parse(f.to) - Date.parse(String(row.last_used))) / 86400000) : null;
      }
      return rows.sort((a, b) => Number(b.users) - Number(a.users));
    });
}
export function percentile(sorted: number[], percent: number) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * percent;
  return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i - Math.floor(i));
}

export async function viewData(view: string, f: Filters, options: { offset?: number; interval?: 'daily' | 'weekly' | 'monthly' } = {}): Promise<ViewData> {
  const db = await getDb(); const w = where(f);
  if (view === 'events' || view === 'live') {
    const ew = eventFilter(db, f);
    const [summary] = await db.query<{ occurrences: number; users: number; sessions: number }>(`SELECT COUNT(*) AS occurrences, COUNT(DISTINCT anonymous_id) AS users, COUNT(DISTINCT session_id) AS sessions FROM events e WHERE ${ew.clause}`, ew.params);
    const groups = await db.query<Row>(limitQuery(db, `SELECT e.event_name, COUNT(*) AS count, COUNT(DISTINCT e.anonymous_id) AS users FROM events e WHERE ${ew.clause} GROUP BY e.event_name ORDER BY count DESC`, 30), ew.params);
    return { rows: await getEvents(db, f, 100, options.offset) as unknown as Row[], total: summary.occurrences, summary, extra: groups };
  }
  if (view === 'sessions') {
    const s = where(f, 's', 'first_seen');
    if (f.search) { s.clause += ' AND (s.session_id LIKE @search OR s.anonymous_id LIKE @search OR s.referrer LIKE @search)'; s.params.search = `%${f.search}%`; }
    if (f.minDuration !== undefined) { s.clause += ' AND s.duration_ms > @minimum'; s.params.minimum = f.minDuration; }
    const rows = await db.query<Row>(limitQuery(db, `SELECT s.*, p.name AS project_name, p.color FROM sessions s JOIN projects p ON p.id = s.project_id WHERE ${s.clause} ORDER BY s.first_seen DESC`, 200), s.params);
    return { rows };
  }
  if (view === 'users') return { rows: await db.query<Row>(limitQuery(db, `SELECT e.project_id, e.anonymous_id, MAX(e.user_id) AS identified_user_id, MIN(e.timestamp) AS first_seen, MAX(e.timestamp) AS last_seen, COUNT(DISTINCT e.session_id) AS sessions, COUNT(*) AS events, p.name AS project_name, p.color FROM events e JOIN projects p ON p.id = e.project_id WHERE ${w.clause} GROUP BY e.project_id, e.anonymous_id, p.name, p.color ORDER BY last_seen DESC`, 200), w.params) };
  if (['features', 'graveyard', 'rising'].includes(view)) {
    let rows = (await features(db, f)).map(r => ({ ...r, kind: 'Feature' } as Row));
    if (view !== 'features') rows = [...rows, ...await usageSignals(db, f)];
    if (view === 'graveyard') rows = rows.filter(r => Number(r.users) <= 3 || Number(r.change) <= -50).sort((a, b) => Number(b.days_inactive) - Number(a.days_inactive));
    if (view === 'rising') rows = rows.filter(r => Number(r.change) > 0).sort((a, b) => Number(b.change) - Number(a.change));
    return { rows };
  }
  if (view === 'errors') {
    const rows = await db.query<Row>(`SELECT e.error_fingerprint AS id, e.project_id, p.name AS project_name, p.color, COUNT(*) AS occurrences, COUNT(DISTINCT e.anonymous_id) AS users_affected, COUNT(DISTINCT e.session_id) AS sessions_affected, MIN(e.timestamp) AS first_seen, MAX(e.timestamp) AS last_seen, MAX(e.properties_json) AS properties_json, MAX(e.app_version) AS version, MAX(e.path) AS path FROM events e JOIN projects p ON p.id = e.project_id WHERE ${w.clause} AND e.event_name = 'error' GROUP BY e.error_fingerprint, e.project_id, p.name, p.color ORDER BY occurrences DESC`, w.params);
    return { rows, summary: { issues: rows.length, occurrences: rows.reduce((n, r) => n + Number(r.occurrences), 0), affectedSessions: rows.reduce((n, r) => n + Number(r.sessions_affected), 0) } };
  }
  if (view === 'performance') {
    const perf = await db.query<EventRow>(limitQuery(db, `SELECT e.id, e.project_id, e.event_name, e.timestamp, e.session_id, e.anonymous_id, e.user_id, e.path, e.referrer, e.properties_json, e.device_type, e.browser, e.operating_system, e.country, e.duration_ms, e.app_version, e.error_fingerprint, e.event_environment, e.country_code, e.country_name, e.region, e.city, e.timezone, e.location_accuracy_level, e.geo_enrichment_status, p.name AS project_name, p.color FROM events e JOIN projects p ON p.id = e.project_id WHERE ${w.clause} AND e.duration_ms IS NOT NULL ORDER BY e.timestamp DESC`, 100000), w.params);
    const groups = new Map<string, EventRow[]>();
    for (const e of perf) { const metric = String(JSON.parse(e.properties_json).metric || e.event_name); const key = `${e.project_id}:${metric}:${e.path}:${e.app_version}:${e.browser}:${e.device_type}`; groups.set(key, [...(groups.get(key) || []), e]); }
    const rows = [...groups].map(([id, list]) => { const values = list.map(e => e.duration_ms!).sort((a, b) => a - b); const e = list[0]; return { id, project_name: e.project_name!, color: e.color!, metric: String(JSON.parse(e.properties_json).metric || e.event_name), path: e.path, version: e.app_version, browser: e.browser, device: e.device_type, samples: list.length, p50: percentile(values, .5), p75: percentile(values, .75), p95: percentile(values, .95), p99: percentile(values, .99) }; });
    // CLS is unitless; never mix it into latency summaries.
    const values = perf.filter(e => JSON.parse(e.properties_json).metric !== 'CLS').map(e => e.duration_ms!).sort((a, b) => a - b);
    return { rows: rows.sort((a, b) => b.samples - a.samples), summary: { p50: percentile(values, .5), p75: percentile(values, .75), p95: percentile(values, .95), p99: percentile(values, .99), samples: perf.length }, extra: { capped: perf.length === 100000 } };
  }
  if (view === 'releases') {
    const d = where(f, 'd', 'deployed_at');
    const rows = await db.query<Row>(limitQuery(db, `SELECT d.*, p.name AS project_name, p.color FROM deployments d JOIN projects p ON p.id = d.project_id WHERE ${d.clause} ORDER BY d.deployed_at DESC`, 50), d.params);
    for (const r of rows) {
      const at = Date.parse(String(r.deployed_at)); const span = Math.min(86400000, Date.parse(f.to) - at);
      const [before, after] = await Promise.all([metrics(db, { project: String(r.project_id), from: new Date(at - span).toISOString(), to: new Date(at - 1).toISOString() }), metrics(db, { project: String(r.project_id), from: String(r.deployed_at), to: new Date(at + span).toISOString() })]);
      r.users_before = before.users; r.users_after = after.users; r.traffic_change = change(after.users, before.users);
      r.errors_before = before.errors; r.errors_after = after.errors;
      r.error_rate_before = before.events ? before.errors / before.events * 100 : 0; r.error_rate_after = after.events ? after.errors / after.events * 100 : 0;
      r.conversion_before = before.sessions ? before.conversions / before.sessions * 100 : 0; r.conversion_after = after.sessions ? after.conversions / after.sessions * 100 : 0;
      r.engagement_before = before.avgDuration; r.engagement_after = after.avgDuration; r.window_hours = span / 3600000;
      const [timing] = await db.query<{ before: number | null; after: number | null }>('SELECT AVG(CASE WHEN timestamp < @at THEN duration_ms END) AS before, AVG(CASE WHEN timestamp >= @at THEN duration_ms END) AS after FROM events WHERE project_id = @project AND event_name = \'performance\' AND timestamp >= @from AND timestamp <= @to', { project: String(r.project_id), at: String(r.deployed_at), from: new Date(at - span).toISOString(), to: new Date(at + span).toISOString() });
      r.latency_before = timing.before; r.latency_after = timing.after;
    }
    return { rows };
  }
  if (view === 'retention') return retention(db, f, options.interval || 'weekly');
  if (view === 'funnels') return funnels(db, f);
  if (view === 'journeys' || view === 'relationships' || view === 'ecosystem') return transitions(db, f, view);
  if (view === 'heatmap') return { rows: await series(db, f) as unknown as Row[] };
  if (view === 'anomalies') return anomalies(db, f);
  if (view === 'alerts') return { rows: await db.query<Row>('SELECT a.*, p.name AS project_name FROM alerts a LEFT JOIN projects p ON p.id = a.project_id ORDER BY a.created_at DESC'), extra: await db.query<Row>(limitQuery(db, 'SELECT * FROM alert_incidents ORDER BY created_at DESC', 30)) };
  if (view === 'saved') return { rows: await db.query<Row>('SELECT * FROM saved_views ORDER BY created_at DESC') };
  if (view === 'settings') return { rows: await db.query<Row>(limitQuery(db, 'SELECT * FROM audit_logs ORDER BY created_at DESC', 50)), extra: { provider: db.dialect, retentionDays: Number((await db.query<{ value: string }>("SELECT value FROM settings WHERE setting_key = 'retention_days'"))[0]?.value || process.env.DATA_RETENTION_DAYS || 90), demo: isDemo() } };
  if (view === 'keys') return { rows: await db.query<Row>('SELECT k.id, k.project_id, k.prefix, k.scope, k.created_at, k.revoked_at, p.name AS project_name, p.project_key, p.domain, p.allowed_origins, p.blocked_properties, p.color FROM api_keys k JOIN projects p ON p.id = k.project_id ORDER BY k.created_at DESC') };
  return { rows: [] };
}

async function usageSignals(db: Connection, f: Filters): Promise<Row[]> {
  const previous = previousFilters(f);
  const params = { from: f.from, to: f.to, previousFrom: previous.from, previousTo: previous.to, ...(f.project && f.project !== 'all' ? { project: f.project } : {}) };
  const rows: Row[] = [];
  for (const kind of ['Page', 'Event'] as const) {
    const column = kind === 'Page' ? 'e.path' : 'e.event_name';
    const restriction = kind === 'Page' ? "e.event_name = 'page_view'" : "e.event_name NOT IN ('page_view','performance','error','session_start','session_end','identify') AND NOT EXISTS (SELECT 1 FROM features ft WHERE ft.project_id = e.project_id AND ft.event_name = e.event_name)";
    const signals = await db.query<Row>(`SELECT e.project_id, p.name AS project_name, p.color, ${column} AS name,
      COUNT(DISTINCT CASE WHEN e.timestamp >= @from THEN e.anonymous_id END) AS users,
      COUNT(DISTINCT CASE WHEN e.timestamp >= @previousFrom AND e.timestamp <= @previousTo THEN e.anonymous_id END) AS previous_users,
      SUM(CASE WHEN e.timestamp >= @from THEN 1 ELSE 0 END) AS occurrences, MAX(e.timestamp) AS last_used
      FROM events e JOIN projects p ON p.id = e.project_id WHERE e.timestamp <= @to AND ${restriction}${params.project ? ' AND e.project_id = @project' : ''}
      GROUP BY e.project_id, p.name, p.color, ${column}`, params);
    rows.push(...signals.map(r => ({ ...r, id: `${r.project_id}:${kind}:${r.name}`, kind, event_name: kind === 'Page' ? 'page_view' : r.name, change: change(Number(r.users), Number(r.previous_users)), days_inactive: Math.floor((Date.parse(f.to) - Date.parse(String(r.last_used))) / 86400000) })));
  }
  return rows;
}

export async function retention(db: Connection, f: Filters, interval: 'daily' | 'weekly' | 'monthly') {
  const unit = interval === 'daily' ? 86400000 : interval === 'weekly' ? 7 * 86400000 : 30 * 86400000;
  const w = where(f);
  const users = f.event
    ? await db.query<{ project_id: string; anonymous_id: string; first_seen: string }>(`SELECT project_id, anonymous_id, MIN(timestamp) AS first_seen FROM events WHERE event_name = @event AND timestamp <= @to${w.params.project ? ' AND project_id = @project' : ''} GROUP BY project_id, anonymous_id HAVING MIN(timestamp) >= @from`, { ...w.params, event: f.event })
    : await db.query<{ project_id: string; anonymous_id: string; first_seen: string }>('SELECT project_id, anonymous_id, first_seen FROM analytics_users WHERE first_seen >= @from AND first_seen <= @to' + (w.params.project ? ' AND project_id = @project' : ''), w.params);
  const activity = await db.query<{ project_id: string; anonymous_id: string; day: string }>(`SELECT e.project_id, e.anonymous_id, ${datePart(db, 'e.timestamp')} AS day FROM events e WHERE ${w.clause}${f.event ? ' AND e.event_name = @event' : ''} GROUP BY e.project_id, e.anonymous_id, ${datePart(db, 'e.timestamp')}`, { ...w.params, ...(f.event ? { event: f.event } : {}) });
  const lookup = new Map(users.map(u => [`${u.project_id}:${u.anonymous_id}`, u]));
  const groups = new Map<number, { users: Set<string>; retained: Set<string>[] }>();
  for (const u of users) {
    const bucket = Math.floor((Date.parse(u.first_seen) - Date.parse(f.from)) / unit);
    if (!groups.has(bucket)) groups.set(bucket, { users: new Set(), retained: Array.from({ length: 8 }, () => new Set()) });
    groups.get(bucket)!.users.add(`${u.project_id}:${u.anonymous_id}`);
  }
  for (const a of activity) {
    const id = `${a.project_id}:${a.anonymous_id}`; const u = lookup.get(id); if (!u) continue;
    const bucket = Math.floor((Date.parse(u.first_seen) - Date.parse(f.from)) / unit);
    const age = Math.floor((Date.parse(`${a.day}T23:59:59.999Z`) - Date.parse(u.first_seen)) / unit);
    if (age >= 0 && age < 8) groups.get(bucket)!.retained[age].add(id);
  }
  return { rows: [...groups].sort(([a], [b]) => a - b).map(([bucket, group]) => {
    const start = Date.parse(f.from) + bucket * unit;
    const row: Row = { cohort: new Date(start).toISOString().slice(0, 10), users: group.users.size };
    for (let i = 0; i < 8; i++) row[`period_${i}`] = start + (i + 1) * unit > Date.parse(f.to) && i > 0 ? null : i === 0 ? 100 : Math.round(group.retained[i].size / group.users.size * 100);
    return row;
  }), extra: { interval, definition: 'First-ever user cohort; return activity at each elapsed period. Monthly means 30-day periods. Incomplete periods are hidden.' } };
}
export function orderedFunnel(events: { event_name: string; timestamp: string; session_id: string; project_id: string }[], steps: string[], windowHours: number) {
  const counts = steps.map(() => 0); const durations: number[] = [];
  const sessions = new Map<string, typeof events>();
  for (const e of events) { const key = `${e.project_id}:${e.session_id}`; const list = sessions.get(key) || []; list.push(e); sessions.set(key, list); }
  for (const session of sessions.values()) {
    session.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    let position = 0; let start = 0;
    for (const e of session) {
      const at = Date.parse(e.timestamp);
      if (e.event_name === steps[position] && (!position || at - start <= windowHours * 3600000)) {
        if (!position) start = at;
        counts[position]++; position++;
        if (position === steps.length) { durations.push(at - start); break; }
      }
    }
  }
  return { counts, timeToConvert: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0 };
}
async function funnels(db: Connection, f: Filters): Promise<ViewData> {
  const records = await db.query<{ id: string; name: string; project_id: string | null; steps_json: string; window_hours: number; project_name: string }>('SELECT f.*, p.name AS project_name FROM funnels f LEFT JOIN projects p ON p.id = f.project_id' + (f.project && f.project !== 'all' ? ' WHERE f.project_id = @project' : ''), f.project && f.project !== 'all' ? { project: f.project } : {});
  const results = [];
  for (const record of records) {
    const steps: string[] = JSON.parse(record.steps_json);
    const wf = where({ ...f, project: record.project_id || f.project });
    const wp = where(previousFilters({ ...f, project: record.project_id || f.project }));
    const params = Object.fromEntries(steps.map((s, i) => [`step${i}`, s]));
    const sql = `SELECT e.event_name, e.timestamp, e.session_id, e.project_id FROM events e WHERE CLAUSE AND e.event_name IN (${steps.map((_, i) => `@step${i}`).join(',')}) ORDER BY e.timestamp`;
    const events = await db.query<{ event_name: string; timestamp: string; session_id: string; project_id: string }>(sql.replace('CLAUSE', wf.clause), { ...wf.params, ...params });
    const previous = await db.query<{ event_name: string; timestamp: string; session_id: string; project_id: string }>(sql.replace('CLAUSE', wp.clause), { ...wp.params, ...params });
    const result = orderedFunnel(events, steps, record.window_hours); const prior = orderedFunnel(previous, steps, record.window_hours);
    results.push({ ...record, ...result, steps, previous: prior.counts });
  }
  return { rows: [], extra: results };
}
async function transitions(db: Connection, f: Filters, view: string): Promise<ViewData> {
  const w = where(f);
  const events = await db.query<{ project_id: string; session_id: string; anonymous_id: string; event_name: string; path: string; referrer: string; timestamp: string }>(limitQuery(db, `SELECT e.project_id, e.session_id, e.anonymous_id, e.event_name, e.path, e.referrer, e.timestamp FROM events e WHERE ${w.clause} AND e.event_name NOT IN ('performance', 'session_start', 'session_end') ORDER BY e.timestamp DESC`, 50000), w.params);
  const links = new Map<string, number>(); const nodes = new Map<string, number>();
  if (view === 'ecosystem') {
    const projects = await db.query<Project>('SELECT * FROM projects WHERE active = 1');
    for (const e of events) {
      nodes.set(e.project_id, (nodes.get(e.project_id) || 0) + 1);
      if (!e.referrer || e.event_name !== 'page_view') continue;
      try { const host = new URL(e.referrer).hostname; const source = projects.find(p => p.domain === host); if (source && source.id !== e.project_id) { const key = `${source.id}|${e.project_id}`; links.set(key, (links.get(key) || 0) + 1); } } catch { /* Invalid referrer contributes no edge. */ }
    }
    return { rows: projects.map(p => ({ id: p.id, name: p.name, color: p.color, count: nodes.get(p.id) || 0 })), extra: { links: [...links].map(([key, count]) => ({ source: key.split('|')[0], target: key.split('|')[1], count })), sampled: events.length === 50000, definition: 'Connections count page views referred from another registered project domain.' } };
  }
  const sessions = new Map<string, typeof events>();
  for (const e of events) { const key = `${e.project_id}:${e.session_id}`; const s = sessions.get(key) || []; s.push(e); sessions.set(key, s); }
  for (const session of sessions.values()) {
    session.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    let previous = '';
    for (const e of session) {
      const name = view === 'journeys' && e.event_name === 'page_view' ? `Viewed ${e.path}` : e.event_name;
      nodes.set(name, (nodes.get(name) || 0) + 1);
      if (previous && previous !== name) { const key = `${previous}|${name}`; links.set(key, (links.get(key) || 0) + 1); }
      previous = name;
    }
  }
  return { rows: [...nodes].map(([name, count]) => ({ id: name, name, count })).sort((a, b) => b.count - a.count), extra: { links: [...links].map(([key, count]) => ({ source: key.split('|')[0], target: key.split('|')[1], count })).sort((a, b) => b.count - a.count), sampled: events.length === 50000 } };
}
export async function anomalies(db: Connection, f: Filters): Promise<ViewData> {
  const end = new Date(f.to); const today = end.toISOString().slice(0, 10);
  const start = new Date(end.getTime() - 15 * 86400000).toISOString().slice(0, 10);
  const rows = await db.query<{ project_id: string; day: string; events: number; errors: number; users: number; project_name: string; color: string }>('SELECT r.*, p.name AS project_name, p.color FROM daily_rollups r JOIN projects p ON p.id = r.project_id WHERE r.day >= @start AND r.day < @today' + (f.project && f.project !== 'all' ? ' AND r.project_id = @project' : '') + ' ORDER BY r.day', { start, today, ...(f.project && f.project !== 'all' ? { project: f.project } : {}) });
  const results: Row[] = [];
  const projectIds = new Set(rows.map(r => r.project_id));
  for (const project of projectIds) {
    const list = rows.filter(r => r.project_id === project); const latest = list.at(-1); if (!latest || list.length < 8) continue;
    for (const metric of ['events', 'users', 'errors'] as const) {
      const baseline = list.slice(0, -1).map(r => r[metric]); const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
      const sd = Math.sqrt(baseline.reduce((s, v) => s + (v - mean) ** 2, 0) / baseline.length);
      const z = sd ? (latest[metric] - mean) / sd : latest[metric] === mean ? 0 : 4;
      if (Math.abs(z) >= 2 && Math.abs(latest[metric] - mean) >= 3) results.push({ id: `${project}:${metric}`, project_id: project, project_name: latest.project_name, color: latest.color, metric, value: latest[metric], baseline: mean, z_score: z, change: change(latest[metric], mean), day: latest.day, samples: baseline.length, severity: Math.abs(z) >= 3 ? 'High' : 'Moderate' });
    }
  }
  return { rows: results.sort((a, b) => Math.abs(Number(b.z_score)) - Math.abs(Number(a.z_score))), extra: { definition: 'Last complete UTC day vs. up to 14 preceding complete days; at least 7 baseline days, |z| ≥ 2, and absolute change ≥ 3. Today is excluded to avoid partial-day false alarms.' } };
}

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cleanUrl, sanitizeProperties, type AnalyticsEvent, type Project } from '@house-edge/shared';
import { datePart, type Connection, type Params } from './connection';
import { loginMetadata } from './geolocation';

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
export async function audit(tx: Connection, action: string, target: string, details: object = {}) {
  await tx.execute('INSERT INTO audit_logs (id, action, target, details_json, created_at) VALUES (@id, @action, @target, @details, @now)', {
    id: randomUUID(), action, target, details: JSON.stringify(details), now: new Date().toISOString(),
  });
}
export async function issueKey(tx: Connection, projectId: string, scope: 'ingest' | 'server' = 'ingest') {
  const key = `he_${scope === 'ingest' ? 'pk' : 'sk'}_${randomBytes(24).toString('hex')}`;
  await tx.execute('INSERT INTO api_keys (id, project_id, key_hash, prefix, scope, created_at) VALUES (@id, @project, @hash, @prefix, @scope, @now)', {
    id: randomUUID(), project: projectId, hash: hashKey(key), prefix: key.slice(0, 14), scope, now: new Date().toISOString(),
  });
  return key;
}
export async function createProject(db: Connection, data: { name: string; projectKey: string; domain: string; origins: string[]; environment: string; color?: string }) {
  return db.transaction(async tx => {
    const id = randomUUID();
    await tx.execute('INSERT INTO projects (id, project_key, name, domain, environment, color, active, created_at, allowed_origins, blocked_properties) VALUES (@id, @key, @name, @domain, @environment, @color, 1, @now, @origins, @blocked)', {
      id, key: data.projectKey, name: data.name, domain: data.domain, environment: data.environment,
      color: data.color || '#54c7a1', now: new Date().toISOString(), origins: JSON.stringify(data.origins), blocked: '[]',
    });
    const key = await issueKey(tx, id);
    await audit(tx, 'project.created', id, { name: data.name, domain: data.domain });
    return { id, key, projectKey: data.projectKey };
  });
}
export async function rebuildDay(tx: Connection, project: string, day: string) {
  const params = { project, day, from: `${day}T00:00:00.000Z`, to: `${day}T23:59:59.999Z` };
  await tx.execute('DELETE FROM daily_rollups WHERE project_id = @project AND day = @day', { project, day });
  await tx.execute(`INSERT INTO daily_rollups (project_id, day, users, sessions, page_views, events, conversions, errors, total_duration_ms, performance_count)
    SELECT @project, @day, COUNT(DISTINCT anonymous_id), COUNT(DISTINCT session_id),
    COALESCE(SUM(CASE WHEN event_name = 'page_view' THEN 1 ELSE 0 END), 0), COUNT(*),
    COALESCE(SUM(CASE WHEN event_name IN ('conversion', 'signup') THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_name = 'error' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_name = 'performance' THEN duration_ms ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_name = 'performance' THEN 1 ELSE 0 END), 0)
    FROM events WHERE project_id = @project AND timestamp >= @from AND timestamp <= @to`, params);
  await tx.execute('DELETE FROM daily_users WHERE project_id = @project AND day = @day', { project, day });
  await tx.execute(`INSERT INTO daily_users (project_id, day, anonymous_id) SELECT @project, @day, anonymous_id FROM events WHERE project_id = @project AND timestamp >= @from AND timestamp <= @to GROUP BY anonymous_id`, params);
}

export async function ingest(db: Connection, project: Project, events: AnalyticsEvent[], options: { skipRollups?: boolean } = {}) {
  return db.transaction(async tx => {
    // A project row lock serializes concurrent retries, sessions, and daily projections.
    await tx.execute('UPDATE projects SET active = active WHERE id = @id', { id: project.id });
    let accepted = 0;
    const days = new Set<string>();
    for (const event of events) {
      if ((await tx.query('SELECT id FROM events WHERE id = @id', { id: event.id })).length) continue;
      const props = sanitizeProperties(event.properties, JSON.parse(project.blocked_properties));
      const path = cleanUrl(event.path); const referrer = cleanUrl(event.referrer);
      const fingerprint = event.event === 'error' ? hashKey(`${props.name || 'Error'}:${props.message || ''}:${String(props.stack || '').split('\n').slice(0, 3).join('\n')}`) : null;
      const values: Params = {
        id: event.id, project: project.id, event: event.event, timestamp: event.timestamp,
        session: event.sessionId, anonymous: event.anonymousId, user: event.userId || null,
        path, referrer, properties: JSON.stringify(props), device: event.deviceType || 'desktop',
        browser: event.browser || 'Unknown', os: event.operatingSystem || 'Unknown', country: event.country || '',
        environment: event.environment || event.login?.environment || project.environment, duration: event.durationMs ?? null, version: event.version || '', fingerprint,
      };
      await tx.execute(`INSERT INTO events (id, project_id, event_name, timestamp, session_id, anonymous_id, user_id, path, referrer, properties_json, device_type, browser, operating_system, country, duration_ms, app_version, error_fingerprint, event_environment)
        VALUES (@id, @project, @event, @timestamp, @session, @anonymous, @user, @path, @referrer, @properties, @device, @browser, @os, @country, @duration, @version, @fingerprint, @environment)`, values);
      const login = loginMetadata(event, project);
      if (login) await tx.execute('UPDATE events SET login_success = @success, login_environment = @environment, auth_provider = @provider, correlation_id = @correlation, location_accuracy_level = @accuracy WHERE id = @id', {
        id: event.id, success: Number(login.success), environment: login.environment, provider: login.provider, correlation: login.correlationId, accuracy: 'unknown',
      });
      const [session] = await tx.query<{ first_seen: string; last_seen: string; landing_page: string; exit_page: string }>('SELECT first_seen, last_seen, landing_page, exit_page FROM sessions WHERE project_id = @project AND session_id = @session', { project: project.id, session: event.sessionId });
      if (!session) {
        await tx.execute(`INSERT INTO sessions (project_id, session_id, anonymous_id, user_id, first_seen, last_seen, duration_ms, page_views, event_count, landing_page, exit_page, referrer, browser, device_type)
          VALUES (@project, @session, @anonymous, @user, @timestamp, @timestamp, 0, @pages, 1, @path, @path, @referrer, @browser, @device)`, {
          project: project.id, session: event.sessionId, anonymous: event.anonymousId, user: event.userId || null, timestamp: event.timestamp,
          pages: event.event === 'page_view' ? 1 : 0, path, referrer, browser: event.browser || 'Unknown', device: event.deviceType || 'desktop',
        });
      } else {
        const first = session.first_seen < event.timestamp ? session.first_seen : event.timestamp;
        const last = session.last_seen > event.timestamp ? session.last_seen : event.timestamp;
        await tx.execute(`UPDATE sessions SET first_seen = @first, last_seen = @last, duration_ms = @duration,
          event_count = event_count + 1, page_views = page_views + @pages, user_id = COALESCE(@user, user_id), landing_page = @landing, exit_page = @exit
          WHERE project_id = @project AND session_id = @session`, {
          project: project.id, session: event.sessionId, first, last, duration: Date.parse(last) - Date.parse(first),
          pages: event.event === 'page_view' ? 1 : 0, user: event.userId || null,
          landing: event.timestamp < session.first_seen ? path : session.landing_page,
          exit: event.timestamp >= session.last_seen ? path : session.exit_page,
        });
      }
      const [user] = await tx.query('SELECT anonymous_id FROM analytics_users WHERE project_id = @project AND anonymous_id = @anonymous', { project: project.id, anonymous: event.anonymousId });
      const userParams = { project: project.id, anonymous: event.anonymousId, user: event.userId || null, timestamp: event.timestamp, sessions: session ? 0 : 1 };
      if (!user) await tx.execute(`INSERT INTO analytics_users (project_id, anonymous_id, identified_user_id, first_seen, last_seen, total_sessions, total_events) VALUES (@project, @anonymous, @user, @timestamp, @timestamp, @sessions, 1)`, userParams);
      else await tx.execute(`UPDATE analytics_users SET identified_user_id = COALESCE(@user, identified_user_id), first_seen = CASE WHEN first_seen > @timestamp THEN @timestamp ELSE first_seen END, last_seen = CASE WHEN last_seen < @timestamp THEN @timestamp ELSE last_seen END, total_sessions = total_sessions + @sessions, total_events = total_events + 1 WHERE project_id = @project AND anonymous_id = @anonymous`, userParams);
      days.add(event.timestamp.slice(0, 10)); accepted++;
    }
    if (!options.skipRollups) for (const day of days) await rebuildDay(tx, project.id, day);
    return { accepted, duplicates: events.length - accepted };
  });
}

export async function rebuildAllRollups(db: Connection) {
  const days = await db.query<{ project_id: string; day: string }>(`SELECT project_id, ${datePart(db, 'timestamp')} AS day FROM events GROUP BY project_id, ${datePart(db, 'timestamp')}`);
  await db.transaction(async tx => { for (const d of days) await rebuildDay(tx, d.project_id, d.day); });
}

export async function consumeRateLimit(db: Connection, bucket: string, amount: number, maximum: number, windowMs = 60000) {
  const now = new Date();
  const key = `${bucket}:${Math.floor(now.getTime() / windowMs)}`;
  return db.transaction(async tx => {
    const [row] = await tx.query<{ count: number }>('SELECT count FROM rate_limits WHERE bucket = @bucket', { bucket: key });
    if ((row?.count || 0) + amount > maximum) return false;
    if (row) await tx.execute('UPDATE rate_limits SET count = count + @amount WHERE bucket = @bucket', { bucket: key, amount });
    else await tx.execute('INSERT INTO rate_limits (bucket, count, expires_at) VALUES (@bucket, @amount, @expires)', { bucket: key, amount, expires: new Date(now.getTime() + windowMs).toISOString() });
    return true;
  });
}

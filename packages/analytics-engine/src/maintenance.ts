import { randomUUID } from 'node:crypto';
import { audit, type Connection } from '@house-edge/database';
import { metrics, percentile, jsonValue } from './index';
import { processGeographyJobs } from '@house-edge/database/geolocation';

export interface NotificationProvider { send(incident: { id: string; name: string; message: string; value: number }): Promise<void>; }
export class WebhookProvider implements NotificationProvider {
  constructor(private url: string) {
    if (new URL(url).protocol !== 'https:') throw new Error('Alert webhooks require HTTPS');
  }
  async send(incident: { id: string; name: string; message: string; value: number }) {
    const response = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': incident.id }, body: JSON.stringify(incident), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Notification delivery failed');
  }
}
export async function evaluateAlerts(db: Connection, provider?: NotificationProvider, now = new Date()) {
  const rules = await db.query<{ id: string; name: string; project_id: string | null; metric: string; operator: string; threshold: number }>('SELECT * FROM alerts WHERE enabled = 1');
  let triggered = 0;
  for (const rule of rules) {
    const f = { project: rule.project_id || undefined, from: new Date(now.getTime() - 3600000).toISOString(), to: now.toISOString() };
    const current = await metrics(db, f); let value = 0;
    if (rule.metric === 'error_rate') value = current.events ? current.errors / current.events * 100 : 0;
    if (rule.metric === 'p95_latency') {
      const values = await db.query<{ duration_ms: number }>(`SELECT duration_ms FROM events WHERE event_name = 'performance' AND duration_ms IS NOT NULL AND ${jsonValue(db, 'properties_json', 'metric')} <> 'CLS' AND timestamp >= @from AND timestamp <= @to${rule.project_id ? ' AND project_id = @project' : ''} ORDER BY duration_ms`, { from: f.from, to: f.to, ...(rule.project_id ? { project: rule.project_id } : {}) });
      value = percentile(values.map(v => v.duration_ms), .95);
    }
    if (rule.metric === 'silence_minutes') {
      const [latest] = await db.query<{ at: string | null }>(`SELECT MAX(timestamp) AS at FROM events WHERE timestamp <= @now${rule.project_id ? ' AND project_id = @project' : ''}`, { now: f.to, ...(rule.project_id ? { project: rule.project_id } : {}) });
      if (latest.at) value = (now.getTime() - Date.parse(latest.at)) / 60000;
      else {
        const [created] = await db.query<{ at: string | null }>(`SELECT MIN(created_at) AS at FROM projects${rule.project_id ? ' WHERE id = @project' : ''}`, rule.project_id ? { project: rule.project_id } : {});
        value = created.at ? Math.max(0, (now.getTime() - Date.parse(created.at)) / 60000) : 0;
      }
    }
    if (rule.metric === 'traffic_drop' || rule.metric === 'conversion_drop') {
      const previous = await metrics(db, { ...f, from: new Date(now.getTime() - 7200000).toISOString(), to: new Date(now.getTime() - 3600000 - 1).toISOString() });
      const before = rule.metric === 'traffic_drop' ? previous.events : previous.sessions ? previous.conversions / previous.sessions : 0;
      const after = rule.metric === 'traffic_drop' ? current.events : current.sessions ? current.conversions / current.sessions : 0;
      value = before ? (before - after) / before * 100 : 0;
    }
    if (!(rule.operator === 'gt' ? value > rule.threshold : value < rule.threshold)) continue;
    const incident = { id: randomUUID(), name: rule.name, value, message: `${rule.name}: ${rule.metric} is ${value.toFixed(2)} (threshold ${rule.operator} ${rule.threshold}).` };
    const inserted = await db.transaction(async tx => {
      const [existing] = await tx.query('SELECT id FROM alert_incidents WHERE alert_id = @alert AND created_at >= @since', { alert: rule.id, since: new Date(now.getTime() - 3600000).toISOString() });
      if (existing) return false;
      await tx.execute('INSERT INTO alert_incidents (id, alert_id, value, message, created_at) VALUES (@id, @alert, @value, @message, @now)', { id: incident.id, alert: rule.id, value, message: incident.message, now: now.toISOString() }); return true;
    });
    if (inserted) triggered++;
  }
  if (provider) {
    const pending = await db.query<{ id: string; name: string; message: string; value: number }>('SELECT i.id, a.name, i.message, i.value FROM alert_incidents i JOIN alerts a ON a.id = i.alert_id WHERE i.notified_at IS NULL AND a.enabled = 1');
    for (const incident of pending) {
      try { await provider.send(incident); await db.transaction(tx => tx.execute('UPDATE alert_incidents SET notified_at = @at WHERE id = @id', { id: incident.id, at: now.toISOString() })); }
      catch { /* Keep pending for the next maintenance run. */ }
    }
  }
  return { evaluated: rules.length, triggered };
}
export async function maintain(db: Connection) {
  const now = new Date();
  const [setting] = await db.query<{ value: string }>("SELECT value FROM settings WHERE setting_key = 'retention_days'");
  const days = Math.max(7, Math.min(730, Number(setting?.value || process.env.DATA_RETENTION_DAYS) || 90));
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const deleted = await db.transaction(async tx => {
    const count = await tx.execute('DELETE FROM events WHERE timestamp < @cutoff', { cutoff: `${cutoff}T00:00:00.000Z` });
    await tx.execute('DELETE FROM daily_rollups WHERE day < @cutoff', { cutoff });
    await tx.execute('DELETE FROM daily_users WHERE day < @cutoff', { cutoff });
    await tx.execute('DELETE FROM sessions WHERE last_seen < @cutoff', { cutoff: `${cutoff}T00:00:00.000Z` });
    await tx.execute('DELETE FROM analytics_users WHERE last_seen < @cutoff', { cutoff: `${cutoff}T00:00:00.000Z` });
    await tx.execute('DELETE FROM rate_limits WHERE expires_at < @now', { now: now.toISOString() });
    await audit(tx, 'maintenance.completed', 'database', { retentionDays: days, eventsDeleted: count });
    return count;
  });
  const provider = process.env.ALERT_WEBHOOK_URL ? new WebhookProvider(process.env.ALERT_WEBHOOK_URL) : undefined;
  return { deleted, retentionDays: days, geography: await processGeographyJobs(db, 100), ...await evaluateAlerts(db, provider, now) };
}

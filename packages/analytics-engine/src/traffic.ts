import type { Filters, TrafficData } from '@house-edge/shared';
import { limitQuery, type Connection } from '@house-edge/database';

export async function trafficBreakdowns(db: Connection, f: Filters): Promise<TrafficData> {
  const params = { from: f.from, to: f.to, ...(f.project && f.project !== 'all' ? { project: f.project } : {}) };
  const scope = `e.timestamp >= @from AND e.timestamp <= @to${'project' in params ? ' AND e.project_id = @project' : ''}`;
  const origin =
    db.dialect === 'sqlite'
      ? "CASE WHEN instr(substr(e.referrer, 9), '/') > 0 THEN substr(e.referrer, 1, instr(substr(e.referrer, 9), '/') + 7) ELSE e.referrer END"
      : "CASE WHEN CHARINDEX('/', e.referrer, 9) > 0 THEN LEFT(e.referrer, CHARINDEX('/', e.referrer, 9) - 1) ELSE e.referrer END";
  const breakdown = (column: 'path' | 'referrer' | 'device_type' | 'browser') => {
    const expression = column === 'referrer' ? origin : `e.${column}`;
    return db.query<{ label: string; count: number }>(
      limitQuery(
        db,
        `SELECT ${expression} AS label, COUNT(*) AS count FROM events e WHERE ${scope} AND e.event_name = 'page_view' GROUP BY ${expression} ORDER BY count DESC, label`,
        20,
      ),
      params,
    );
  };
  const [visitors] = await db.query<{ newVisitors: number; returningVisitors: number }>(
    `SELECT
    COALESCE(SUM(CASE WHEN first_seen >= @from THEN 1 ELSE 0 END),0) AS newVisitors,
    COALESCE(SUM(CASE WHEN first_seen < @from THEN 1 ELSE 0 END),0) AS returningVisitors FROM (
      SELECT DISTINCT e.project_id, e.anonymous_id, u.first_seen FROM events e JOIN analytics_users u
      ON u.project_id = e.project_id AND u.anonymous_id = e.anonymous_id WHERE ${scope}
    ) active_visitors`,
    params,
  );
  const [pages, referrers, devices, browsers] = await Promise.all(
    ['path', 'referrer', 'device_type', 'browser'].map((c) =>
      breakdown(c as 'path' | 'referrer' | 'device_type' | 'browser'),
    ),
  );
  return { ...visitors, pages, referrers, devices, browsers };
}

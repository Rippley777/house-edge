import { createHash } from 'node:crypto';
import { z } from 'zod';
import { change } from '@house-edge/shared';
import type { GeographyData, GeographyFilters, GeographyPoint } from '../../shared/src/geography';
import { limitQuery, type Connection, type Params } from '@house-edge/database';
import { countryLocation, geographyEnabled } from '@house-edge/database/geolocation';

export const geographyFilterSchema = z.object({
  environment: z.enum(['production', 'staging', 'development', 'test']).optional(),
  provider: z.string().max(80).optional(),
  scope: z.enum(['events', 'logins']).default('events'),
  event: z.string().trim().min(1).max(120).optional(),
  success: z.enum(['success', 'failure', 'all']).default('all'),
  metric: z.enum(['events', 'users']).default('events'),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  region: z.string().max(120).optional(),
  minEvents: z.coerce.number().int().min(1).max(1000000).default(1),
  granularity: z.enum(['country', 'region', 'city']).default('city'),
});
function scope(f: GeographyFilters, history = false) {
  const params: Params = { to: f.to, ...(history ? {} : { from: f.from }) };
  let clause = `e.timestamp <= @to${history ? '' : ' AND e.timestamp >= @from'}`;
  for (const [key, column, value] of [
    ['project', 'project_id', f.project !== 'all' ? f.project : undefined],
    ['environment', 'event_environment', f.environment],
    ['event', 'event_name', f.event],
    ['provider', 'auth_provider', f.provider],
    ['country', 'country_code', f.country],
    ['region', 'region', f.region],
  ] as const) {
    if (value) {
      clause += ` AND e.${column} = @${key}`;
      params[key] = value;
    }
  }
  if (f.scope === 'logins') clause += ' AND e.login_success IS NOT NULL';
  if (f.success !== 'all') {
    clause += ' AND e.login_success = @success';
    params.success = f.success === 'failure' ? 0 : 1;
  }
  return { clause, params };
}
// Each person remains scoped to their project; opaque IDs are never returned to the browser.
const identity = "e.project_id + ':' + COALESCE(e.user_id, e.anonymous_id)";
const geoValid =
  "e.geo_enrichment_status = 'enriched' AND e.country_code IS NOT NULL AND e.latitude IS NOT NULL AND e.longitude IS NOT NULL";
function grouping(granularity: 'country' | 'region' | 'city') {
  const region = granularity === 'country' ? 'NULL' : 'e.region';
  const city = granularity === 'city' ? 'e.city' : 'NULL';
  const level =
    granularity === 'country'
      ? "'country'"
      : granularity === 'region'
        ? "CASE WHEN e.region IS NULL THEN 'country' ELSE 'region' END"
        : 'e.location_accuracy_level';
  return {
    region,
    city,
    level,
    cols: `e.country_code, e.country_name${granularity !== 'country' ? ', e.region' : ''}${granularity === 'city' ? ', e.city, e.location_accuracy_level' : ''}`,
  };
}
type Aggregate = {
  countryCode: string;
  countryName: string;
  region: string | null;
  city: string | null;
  accuracyLevel: GeographyPoint['accuracyLevel'];
  latitude: number;
  longitude: number;
  accuracyRadius: number | null;
  totalEvents: number;
  uniqueUsers: number;
  firstSeen: string;
  lastSeen: string;
  vpnEvents: number | null;
  proxyEvents: number | null;
  hostingEvents: number | null;
  torEvents: number | null;
};
function locationKey(p: Pick<GeographyPoint, 'countryCode' | 'region' | 'city' | 'accuracyLevel'>) {
  return JSON.stringify([p.countryCode, p.region, p.city, p.accuracyLevel]);
}
export async function eventGeography(db: Connection, filters: GeographyFilters): Promise<GeographyData> {
  const validated = geographyFilterSchema.parse(filters);
  const f = { ...filters, ...validated };
  const map = {
    darkStyle: process.env.NEXT_PUBLIC_GEO_MAP_DARK_STYLE || 'https://tiles.openfreemap.org/styles/dark',
    lightStyle: process.env.NEXT_PUBLIC_GEO_MAP_LIGHT_STYLE || 'https://tiles.openfreemap.org/styles/positron',
  };
  const empty: GeographyData = {
    locations: [],
    summary: {
      totalEvents: 0,
      geolocatedEvents: 0,
      totalLogins: 0,
      uniqueUsers: 0,
      geolocatedLogins: 0,
      coverage: 0,
      countries: 0,
      places: 0,
      cities: 0,
      regions: 0,
      unknownLocations: 0,
      newCountries: [],
      mostActiveLocation: null,
    },
    granularity: f.granularity,
    truncated: false,
    enabled: geographyEnabled(),
    sample: false,
    map,
  };
  if (!empty.enabled) return empty;
  const s = scope(f);
  const visitor = db.dialect === 'sqlite' ? identity.replaceAll(' + ', ' || ') : identity;
  const [summary] = await db.query<{
    total: number;
    users: number;
    located: number;
    countries: number;
    logins: number;
    locatedLogins: number;
  }>(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT ${visitor}) AS users,
    COALESCE(SUM(CASE WHEN e.login_success IS NOT NULL THEN 1 ELSE 0 END),0) AS logins,
    COALESCE(SUM(CASE WHEN e.login_success IS NOT NULL AND ${geoValid} THEN 1 ELSE 0 END),0) AS locatedLogins,
    COALESCE(SUM(CASE WHEN ${geoValid} THEN 1 ELSE 0 END),0) AS located,
    COUNT(DISTINCT CASE WHEN ${geoValid} THEN e.country_code END) AS countries FROM events e WHERE ${s.clause}`,
    s.params,
  );
  const [places] = await db.query<{ cities: number; regions: number }>(
    `SELECT SUM(CASE WHEN city IS NOT NULL THEN 1 ELSE 0 END) AS cities, COUNT(DISTINCT regionKey) AS regions FROM (
      SELECT e.country_code, e.region, e.city, ${db.dialect === 'sqlite' ? "e.country_code || ':' || e.region" : "e.country_code + ':' + e.region"} AS regionKey
      FROM events e WHERE ${s.clause} AND ${geoValid} GROUP BY e.country_code, e.region, e.city
    ) known_places`,
    s.params,
  );
  const query = async (
    filter: GeographyFilters,
    granularity: 'country' | 'region' | 'city',
    threshold = 1,
    targets?: Aggregate[],
  ) => {
    const w = scope(filter);
    const g = grouping(granularity);
    if (targets?.length) {
      // Compare these locations exactly, even if the previous period had >500 other locations.
      const predicates = targets.map((target, i) => {
        w.params[`targetCountry${i}`] = target.countryCode;
        const conditions = [`e.country_code = @targetCountry${i}`];
        if (granularity !== 'country') {
          if (target.region === null) conditions.push('e.region IS NULL');
          else {
            w.params[`targetRegion${i}`] = target.region;
            conditions.push(`e.region = @targetRegion${i}`);
          }
        }
        if (granularity === 'city') {
          if (target.city === null) conditions.push('e.city IS NULL');
          else {
            w.params[`targetCity${i}`] = target.city;
            conditions.push(`e.city = @targetCity${i}`);
          }
          w.params[`targetAccuracy${i}`] = target.accuracyLevel;
          conditions.push(`e.location_accuracy_level = @targetAccuracy${i}`);
        }
        return `(${conditions.join(' AND ')})`;
      });
      w.clause += ` AND (${predicates.join(' OR ')})`;
    }
    return db.query<Aggregate>(
      limitQuery(
        db,
        `SELECT e.country_code AS countryCode, e.country_name AS countryName, ${g.region} AS region, ${g.city} AS city, ${g.level} AS accuracyLevel,
      AVG(e.latitude) AS latitude, AVG(e.longitude) AS longitude, MAX(e.accuracy_radius) AS accuracyRadius,
      COUNT(*) AS totalEvents, COUNT(DISTINCT ${visitor}) AS uniqueUsers, MIN(e.timestamp) AS firstSeen, MAX(e.timestamp) AS lastSeen,
      SUM(e.is_vpn) AS vpnEvents, SUM(e.is_proxy) AS proxyEvents, SUM(e.is_hosting_provider) AS hostingEvents, SUM(e.is_tor) AS torEvents
      FROM events e WHERE ${w.clause} AND ${geoValid} GROUP BY ${g.cols} HAVING COUNT(*) >= @minimum
      ORDER BY ${f.metric === 'users' ? 'uniqueUsers' : 'totalEvents'} DESC, countryCode`,
        501,
      ),
      { ...w.params, minimum: threshold },
    );
  };
  let granularity = f.granularity;
  let rows = await query(f, granularity, f.minEvents);
  // Keep the entire selected distribution when finer geography would exceed the map budget.
  if (rows.length > 500 && granularity === 'city') {
    granularity = 'region';
    rows = await query(f, granularity, f.minEvents);
  }
  if (rows.length > 500 && granularity === 'region') {
    granularity = 'country';
    rows = await query(f, granularity, f.minEvents);
  }
  const span = Date.parse(f.to) - Date.parse(f.from) + 1;
  const previous = {
    ...f,
    from: new Date(Date.parse(f.from) - span).toISOString(),
    to: new Date(Date.parse(f.from) - 1).toISOString(),
  };
  const prev = rows.length ? await query(previous, granularity, 1, rows.slice(0, 500)) : [];
  const prior = new Map(prev.map((p) => [locationKey(p), p]));
  const historical = scope({ ...f, to: new Date(Date.parse(f.from) - 1).toISOString() }, true);
  const seen = await db.query<{ country: string }>(
    `SELECT DISTINCT e.country_code AS country FROM events e WHERE ${historical.clause} AND ${geoValid}`,
    historical.params,
  );
  const currentCountries = await db.query<{ country: string }>(
    `SELECT DISTINCT e.country_code AS country FROM events e WHERE ${s.clause} AND ${geoValid}`,
    s.params,
  );
  const membership = await db.query<{
    countryCode: string;
    countryName: string;
    region: string | null;
    city: string | null;
    accuracyLevel: GeographyPoint['accuracyLevel'];
    application: string;
    provider: string;
  }>(
    limitQuery(
      db,
      `SELECT DISTINCT e.country_code AS countryCode, e.country_name AS countryName, ${grouping(granularity).region} AS region, ${grouping(granularity).city} AS city, ${grouping(granularity).level} AS accuracyLevel,
    p.name AS application, e.auth_provider AS provider FROM events e JOIN projects p ON p.id = e.project_id WHERE ${s.clause} AND ${geoValid} ORDER BY countryCode`,
      10000,
    ),
    s.params,
  );
  const locations: GeographyPoint[] = rows.slice(0, 500).map((r) => {
    const before = prior.get(locationKey(r));
    const country = countryLocation(r.countryCode);
    const members = membership.filter((m) => locationKey(m) === locationKey(r));
    return {
      ...r,
      id: createHash('sha256').update(locationKey(r)).digest('hex').slice(0, 16),
      // Country aggregation always uses a country centroid. Region aggregates use a coarse regional representative.
      latitude: r.accuracyLevel === 'country' ? country.latitude! : Math.round(r.latitude * 10) / 10,
      longitude: r.accuracyLevel === 'country' ? country.longitude! : Math.round(r.longitude * 10) / 10,
      accuracyRadius:
        r.accuracyLevel === 'country'
          ? null
          : granularity === 'region'
            ? Math.max(100, r.accuracyRadius || 100)
            : r.accuracyRadius,
      percentage: (f.metric === 'users' ? summary.users : summary.total)
        ? (f.metric === 'users' ? r.uniqueUsers / summary.users : r.totalEvents / summary.total) * 100
        : 0,
      previousEvents: before?.totalEvents || 0,
      previousUsers: before?.uniqueUsers || 0,
      trend: change(
        f.metric === 'users' ? r.uniqueUsers : r.totalEvents,
        f.metric === 'users' ? before?.uniqueUsers || 0 : before?.totalEvents || 0,
      ),
      applications: [...new Set(members.map((m) => m.application))],
      providers: [...new Set(members.map((m) => m.provider).filter(Boolean))],
    };
  });
  return {
    ...empty,
    locations,
    granularity,
    truncated: rows.length > 500 || membership.length === 10000,
    summary: {
      totalEvents: summary.total,
      geolocatedEvents: summary.located,
      totalLogins: summary.logins,
      uniqueUsers: summary.users,
      geolocatedLogins: summary.locatedLogins,
      coverage: summary.total ? (summary.located / summary.total) * 100 : 0,
      countries: summary.countries,
      places: locations.length,
      cities: places.cities || 0,
      regions: places.regions || 0,
      unknownLocations: summary.total - summary.located,
      newCountries: currentCountries.filter((c) => !seen.some((h) => h.country === c.country)).map((c) => c.country),
      mostActiveLocation: locations[0]
        ? [locations[0].city, locations[0].region, locations[0].countryName].filter(Boolean).join(', ')
        : null,
    },
  };
}

// Existing consumers retain the successful-login default and response fields.
export function loginGeography(db: Connection, filters: GeographyFilters): Promise<GeographyData> {
  return eventGeography(db, { ...filters, scope: 'logins', success: filters.success || 'success' });
}

import countries from 'world-countries';
import { open, type CityResponse } from 'maxmind';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { AnalyticsEvent, Project } from '@house-edge/shared';
import type { GeoLocation } from '../../shared/src/geography';
import { parseCloudflareLocation, type CloudflareLocation } from '../../shared/src/cloudflare-location';
import { publicIp } from './client-ip';
import { limitQuery, type Connection } from './connection';

export const geographyEnabled = () =>
  (process.env.GEOGRAPHY_ENABLED ?? process.env.LOGIN_GEOGRAPHY_ENABLED) !== 'false';
export function unknownLocation(status: GeoLocation['status'] = 'unknown', provider = 'none'): GeoLocation {
  return {
    countryCode: null,
    countryName: null,
    region: null,
    city: null,
    latitude: null,
    longitude: null,
    timezone: null,
    accuracyLevel: 'unknown',
    accuracyRadius: null,
    provider,
    status,
    isVpn: null,
    isProxy: null,
    isHostingProvider: null,
    isTor: null,
  };
}
export function countryLocation(code?: string | null, provider = 'trusted-infrastructure'): GeoLocation {
  const country = countries.find((c) => c.cca2 === code?.toUpperCase());
  if (!country) return unknownLocation();
  return {
    ...unknownLocation('enriched', provider),
    countryCode: country.cca2,
    countryName: country.name.common,
    latitude: country.latlng[0],
    longitude: country.latlng[1],
    accuracyLevel: 'country',
  };
}
const nullableText = (value: unknown, length = 120) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, length) : null;
const indicator = (value: unknown) => (typeof value === 'boolean' ? value : null);
export function normalizeLocation(value: unknown, provider: string): GeoLocation {
  if (!value || typeof value !== 'object') return unknownLocation('failed', provider);
  const v = value as Record<string, unknown>;
  const base = countryLocation(nullableText(v.countryCode), provider);
  if (base.status !== 'enriched') return unknownLocation('failed', provider);
  const region = nullableText(v.region),
    city = nullableText(v.city);
  // The adapter must declare centroid coordinates; arbitrary endpoint coordinates are downgraded to country.
  const valid =
    v.coordinatesAreCentroid === true &&
    typeof v.latitude === 'number' &&
    typeof v.longitude === 'number' &&
    Number.isFinite(v.latitude) &&
    Number.isFinite(v.longitude) &&
    Math.abs(v.latitude) <= 90 &&
    Math.abs(v.longitude) <= 180 &&
    !(v.latitude === 0 && v.longitude === 0);
  const level =
    valid && city && v.accuracyLevel === 'city'
      ? 'city'
      : valid && region && v.accuracyLevel === 'region'
        ? 'region'
        : 'country';
  return {
    ...base,
    region: level === 'country' ? null : region,
    city: level === 'city' ? city : null,
    latitude: level === 'country' ? base.latitude : Math.round(Number(v.latitude) * 10) / 10,
    longitude: level === 'country' ? base.longitude : Math.round(Number(v.longitude) * 10) / 10,
    accuracyLevel: level,
    timezone: nullableText(v.timezone, 80),
    accuracyRadius:
      level === 'country'
        ? null
        : Math.max(
            15,
            typeof v.accuracyRadius === 'number' && Number.isFinite(v.accuracyRadius) && v.accuracyRadius >= 0
              ? v.accuracyRadius
              : 15,
          ),
    isVpn: indicator(v.isVpn),
    isProxy: indicator(v.isProxy),
    isHostingProvider: indicator(v.isHostingProvider),
    isTor: indicator(v.isTor),
  };
}
export function cloudflareGeoLocation(location: CloudflareLocation): GeoLocation {
  const normalized = normalizeLocation(
    {
      ...location,
      countryCode: location.country,
      coordinatesAreCentroid: true,
      accuracyLevel: location.city ? 'city' : location.region ? 'region' : 'country',
    },
    'cloudflare',
  );
  return {
    ...normalized,
    regionCode: location.regionCode || null,
    postalCode: location.postalCode || null,
    colo: location.colo || null,
    asn: location.asn || null,
    networkOrganization: location.networkOrganization || null,
    accuracyRadius: normalized.accuracyLevel === 'region' ? 100 : normalized.accuracyRadius,
  };
}
export interface GeolocationProvider {
  name: string;
  version: string;
  lookup(ip: string, signal: AbortSignal): Promise<GeoLocation>;
}
export class MmdbProvider implements GeolocationProvider {
  name = 'mmdb';
  private reader?: ReturnType<typeof open<CityResponse>>;
  constructor(
    private filename: string,
    public version: string,
  ) {}
  async lookup(ip: string) {
    this.reader ||= open<CityResponse>(this.filename);
    const reader = await this.reader;
    const v = reader.get(ip);
    if (!v) return unknownLocation();
    return normalizeLocation(
      {
        countryCode: v.country?.iso_code,
        region: v.subdivisions?.[0]?.names?.en,
        city: v.city?.names?.en,
        latitude: v.location?.latitude,
        longitude: v.location?.longitude,
        timezone: v.location?.time_zone,
        accuracyRadius: v.location?.accuracy_radius,
        accuracyLevel: v.city ? 'city' : v.subdivisions?.length ? 'region' : 'country',
        coordinatesAreCentroid: true,
      },
      this.name,
    );
  }
}
export class HttpGeolocationProvider implements GeolocationProvider {
  name = 'https-adapter';
  constructor(
    private url: string,
    public version: string,
    private token?: string,
  ) {
    if (new URL(url).protocol !== 'https:') throw new Error('Geolocation adapters require HTTPS');
  }
  async lookup(ip: string, signal: AbortSignal) {
    const response = await fetch(this.url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: JSON.stringify({ ip }),
      signal,
    });
    if (!response.ok) throw new Error('Geolocation provider failed');
    const reader = response.body?.getReader();
    if (!reader) return unknownLocation('failed', this.name);
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          throw new Error('Provider response too large');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return normalizeLocation(JSON.parse(Buffer.concat(chunks).toString('utf8')), this.name);
  }
}
let configured: { key: string; providers: GeolocationProvider[] } | undefined;
export function configuredProviders(): GeolocationProvider[] {
  const key = [
    process.env.GEO_MMDB_PATH,
    process.env.GEO_PROVIDER_URL,
    process.env.GEO_PROVIDER_TOKEN,
    process.env.GEO_PROVIDER_VERSION,
  ].join('|');
  if (configured?.key === key) return configured.providers;
  const providers: GeolocationProvider[] = [];
  if (process.env.GEO_MMDB_PATH)
    providers.push(new MmdbProvider(process.env.GEO_MMDB_PATH, process.env.GEO_PROVIDER_VERSION || '1'));
  if (process.env.GEO_PROVIDER_URL)
    providers.push(
      new HttpGeolocationProvider(
        process.env.GEO_PROVIDER_URL,
        process.env.GEO_PROVIDER_VERSION || '1',
        process.env.GEO_PROVIDER_TOKEN,
      ),
    );
  configured = { key, providers };
  return providers;
}
export async function resolveLocation(
  ip: string | null,
  country: string | null,
  providers: GeolocationProvider[],
  timeoutMs = Number(process.env.GEO_TIMEOUT_MS) || 1500,
): Promise<GeoLocation> {
  let fallback = unknownLocation();
  if (ip)
    for (const provider of providers) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          provider.lookup(ip, controller.signal),
          new Promise<GeoLocation>((resolve) => {
            timer = setTimeout(
              () => {
                controller.abort();
                resolve(unknownLocation('timeout', provider.name));
              },
              Math.max(10, Math.min(timeoutMs, 5000)),
            );
          }),
        ]);
        if (result.status === 'enriched') return result;
        fallback = result;
      } catch {
        fallback = unknownLocation('failed', provider.name);
      } finally {
        clearTimeout(timer);
      }
    }
  return country ? countryLocation(country) : fallback;
}
function encryptionKey(): Buffer | null {
  const key = process.env.GEO_QUEUE_KEY || '';
  return /^[a-f\d]{64}$/i.test(key) ? Buffer.from(key, 'hex') : null;
}
export function ipHash(ip: string): string | null {
  const salt = process.env.GEO_IP_HASH_SALT;
  return salt && salt.length >= 32 ? createHmac('sha256', salt).update(ip).digest('hex') : null;
}
function encrypt(ip: string): string | null {
  const key = encryptionKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  return Buffer.concat([iv, cipher.update(ip), cipher.final(), cipher.getAuthTag()]).toString('base64');
}
function decrypt(value: string): string {
  const key = encryptionKey();
  if (!key) throw new Error('Queue key unavailable');
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString('utf8');
}
export function loginMetadata(event: AnalyticsEvent, project: Project) {
  const match = event.event.match(/^(?:[a-z0-9-]+\.)?auth\.login\.(succeeded|failed)\.v1$/);
  if (!match) return null;
  const success = match[1] === 'succeeded';
  if (event.login && event.login.success !== success) return null;
  return {
    success,
    provider: event.login?.provider || 'unknown',
    environment: event.environment || event.login?.environment || project.environment,
    correlationId: event.login?.correlationId || null,
  };
}
export async function stageGeography(
  db: Connection,
  project: Project,
  events: AnalyticsEvent[],
  network: { ip: string | null; country: string | null },
  server: boolean,
) {
  for (const event of events) {
    const login = loginMetadata(event, project);
    const allowed = geographyEnabled();
    const environment = event.environment || login?.environment || project.environment;
    const excluded = process.env.GEO_PRODUCTION_ONLY === 'true' && environment !== 'production';
    // A server batch's transport address belongs to the application server, not its user.
    const cloudflare = server ? parseCloudflareLocation(event.location) : null;
    const source = server ? cloudflare?.ip || event.sourceIp || event.login?.sourceIp : network.ip;
    const ip = publicIp(source);
    const country = server ? null : network.country;
    const hash = allowed && !excluded && ip ? ipHash(ip) : null;
    // Prelocated Cloudflare events need no raw-IP queue, cache, or vendor lookup.
    const direct = allowed && !excluded && cloudflare ? cloudflareGeoLocation(cloudflare) : null;
    const encrypted = allowed && !excluded && !cloudflare && ip ? encrypt(ip) : null;
    const pending = allowed && !excluded && (encrypted || country);
    const status = !allowed ? 'disabled' : excluded || (source && !ip) ? 'excluded' : pending ? 'pending' : 'unknown';
    await db.transaction(async (tx) => {
      const updated = await tx.execute(
        `UPDATE events SET login_success = @success, auth_provider = @provider, login_environment = @loginEnvironment, event_environment = @environment,
        correlation_id = @correlation, ip_hash = @hash, geo_enrichment_status = @status, location_accuracy_level = 'unknown'
        WHERE id = @id AND project_id = @project AND geo_enrichment_status IS NULL`,
        {
          id: event.id,
          project: project.id,
          success: login ? Number(login.success) : null,
          provider: login?.provider || null,
          environment,
          loginEnvironment: login?.environment || null,
          correlation: login?.correlationId || null,
          hash,
          status,
        },
      );
      if (updated && direct) await writeLocation(tx, event.id, direct);
      if (updated && pending)
        await tx.execute(
          'INSERT INTO geo_jobs (event_id, encrypted_ip, country_code, expires_at) VALUES (@id, @ip, @country, @expiry)',
          {
            id: event.id,
            ip: encrypted,
            country,
            expiry: new Date(Date.now() + 3600000).toISOString(),
          },
        );
    });
  }
}
export async function saveLocation(db: Connection, id: string, location: GeoLocation, leaseToken?: string) {
  await db.transaction(async (tx) => {
    if (
      leaseToken &&
      !(
        await tx.query(
          'SELECT event_id FROM geo_jobs WHERE event_id = @id AND lease_token = @token AND expires_at > @now',
          { id, token: leaseToken, now: new Date().toISOString() },
        )
      ).length
    )
      return;
    await writeLocation(tx, id, location);
  });
}
async function writeLocation(tx: Connection, id: string, location: GeoLocation) {
  await tx.execute(
    `UPDATE events SET country_code = @countryCode, country_name = @countryName, region = @region, city = @city,
      latitude = @latitude, longitude = @longitude, timezone = @timezone, location_accuracy_level = @accuracyLevel, accuracy_radius = @accuracyRadius,
      region_code = @regionCode, postal_code = @postalCode, cloudflare_colo = @colo, network_asn = @asn, network_organization = @networkOrganization,
      geo_provider = @provider, geo_enrichment_status = @status, is_vpn = @vpn, is_proxy = @proxy, is_hosting_provider = @hosting, is_tor = @tor, enriched_at = @now WHERE id = @id`,
    {
      id,
      countryCode: location.countryCode,
      countryName: location.countryName,
      region: location.region,
      city: location.city,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: location.timezone,
      regionCode: location.regionCode || null,
      postalCode: location.postalCode || null,
      colo: location.colo || null,
      asn: location.asn || null,
      networkOrganization: location.networkOrganization || null,
      accuracyLevel: location.accuracyLevel,
      accuracyRadius: location.accuracyRadius,
      provider: location.provider,
      status: location.status,
      vpn: location.isVpn === null ? null : Number(location.isVpn),
      proxy: location.isProxy === null ? null : Number(location.isProxy),
      hosting: location.isHostingProvider === null ? null : Number(location.isHostingProvider),
      tor: location.isTor === null ? null : Number(location.isTor),
      now: new Date().toISOString(),
    },
  );
  await tx.execute('DELETE FROM geo_jobs WHERE event_id = @id', { id });
}
export async function cleanupGeography(db: Connection, now = new Date()) {
  const cutoff = new Date(
    now.getTime() - Math.max(1, Math.min(730, Number(process.env.GEO_RETENTION_DAYS) || 30)) * 86400000,
  ).toISOString();
  await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE events SET geo_enrichment_status = 'unknown' WHERE id IN (SELECT event_id FROM geo_jobs WHERE expires_at <= @now)",
      { now: now.toISOString() },
    );
    await tx.execute('DELETE FROM geo_jobs WHERE expires_at <= @now', { now: now.toISOString() });
    await tx.execute('DELETE FROM geo_cache WHERE expires_at <= @now', { now: now.toISOString() });
    await tx.execute('DELETE FROM geo_jobs WHERE event_id IN (SELECT id FROM events WHERE timestamp < @cutoff)', {
      cutoff,
    });
    await tx.execute(
      `UPDATE events SET ip_hash = NULL, country_code = NULL, country_name = NULL, region = NULL, city = NULL, latitude = NULL, longitude = NULL,
      timezone = NULL, region_code = NULL, postal_code = NULL, cloudflare_colo = NULL, network_asn = NULL, network_organization = NULL,
      accuracy_radius = NULL, is_vpn = NULL, is_proxy = NULL, is_hosting_provider = NULL, is_tor = NULL, geo_provider = NULL, enriched_at = NULL,
      location_accuracy_level = 'unknown', geo_enrichment_status = 'expired' WHERE timestamp < @cutoff AND geo_enrichment_status IS NOT NULL AND geo_enrichment_status <> 'expired'`,
      { cutoff },
    );
    if (!geographyEnabled()) {
      await tx.execute('DELETE FROM geo_jobs');
      await tx.execute('DELETE FROM geo_cache');
      await tx.execute(
        "UPDATE events SET geo_enrichment_status = 'disabled', ip_hash = NULL WHERE geo_enrichment_status = 'pending'",
      );
    }
  });
}
export async function processGeographyJobs(db: Connection, limit = 25, providers?: GeolocationProvider[]) {
  await cleanupGeography(db);
  if (!geographyEnabled()) return { processed: 0, enriched: 0, failed: 0 };
  const now = new Date().toISOString();
  const token = randomUUID();
  const jobs = await db.transaction(async (tx) => {
    const rows = await tx.query<{
      event_id: string;
      encrypted_ip: string | null;
      country_code: string | null;
      expires_at: string;
    }>(
      limitQuery(
        db,
        'SELECT event_id, encrypted_ip, country_code, expires_at FROM geo_jobs WHERE expires_at > @now AND (lease_until IS NULL OR lease_until < @now) ORDER BY expires_at',
        Math.min(100, limit),
      ),
      { now },
    );
    for (const row of rows)
      await tx.execute('UPDATE geo_jobs SET lease_token = @token, lease_until = @lease WHERE event_id = @id', {
        id: row.event_id,
        token,
        lease: new Date(Date.now() + Math.max(120000, Math.min(100, limit) * 15000 + 30000)).toISOString(),
      });
    return rows;
  });
  let enriched = 0,
    failed = 0;
  let chain: GeolocationProvider[] = [];
  try {
    chain = providers || configuredProviders();
  } catch {
    /* Bad configuration still allows country fallback. */
  }
  const cacheVersion = chain.map((p) => `${p.name}:${p.version}`).join('|');
  for (const job of jobs) {
    if (Date.parse(job.expires_at) <= Date.now()) {
      failed++;
      continue;
    }
    let location: GeoLocation;
    try {
      const ip = job.encrypted_ip ? publicIp(decrypt(job.encrypted_ip)) : null;
      const hash = ip ? ipHash(ip) : null;
      const cacheKey = hash ? createHmac('sha256', hash).update(cacheVersion).digest('hex') : null;
      const [cached] = cacheKey
        ? await db.query<{ location_json: string }>(
            'SELECT location_json FROM geo_cache WHERE cache_key = @key AND expires_at > @now',
            { key: cacheKey, now },
          )
        : [];
      location = cached ? JSON.parse(cached.location_json) : await resolveLocation(ip, job.country_code, chain);
      if (location.status !== 'enriched' && job.country_code) location = countryLocation(job.country_code);
      // Header-derived country must not be reused for other requests sharing this IP.
      if (!cached && cacheKey && location.provider !== 'trusted-infrastructure')
        await db.transaction(async (tx) => {
          await tx.execute('DELETE FROM geo_cache WHERE cache_key = @key', { key: cacheKey });
          await tx.execute(
            'INSERT INTO geo_cache (cache_key, location_json, expires_at) VALUES (@key, @location, @expiry)',
            {
              key: cacheKey,
              location: JSON.stringify(location),
              expiry: new Date(
                Date.now() +
                  (location.status === 'enriched'
                    ? Math.max(1, Math.min(30, Number(process.env.GEO_CACHE_DAYS) || 7)) * 86400000
                    : 60000),
              ).toISOString(),
            },
          );
        });
    } catch {
      location = unknownLocation('failed');
    }
    await saveLocation(db, job.event_id, location, token);
    if (location.status === 'enriched') enriched++;
    else failed++;
    const delay = Math.max(0, Math.min(5000, Number(process.env.GEO_LOOKUP_INTERVAL_MS) || 0));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return { processed: jobs.length, enriched, failed };
}

/** Additive server-ingestion contract. Invalid optional geography never rejects an event. */
export interface CloudflareLocation {
  version: 1;
  source: 'cloudflare';
  ip?: string;
  country?: string;
  city?: string;
  region?: string;
  regionCode?: string;
  latitude?: number;
  longitude?: number;
  postalCode?: string;
  timezone?: string;
  colo?: string;
  asn?: number;
  networkOrganization?: string;
}
export function parseCloudflareLocation(value: unknown): CloudflareLocation | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || v.source !== 'cloudflare') return null;
  const text = (name: string, length = 120) =>
    typeof v[name] === 'string' && v[name].trim() ? v[name].trim().slice(0, length) : undefined;
  const coordinate = (name: string, limit: number) =>
    typeof v[name] === 'number' && Number.isFinite(v[name]) && Math.abs(v[name]) <= limit ? v[name] : undefined;
  return {
    version: 1,
    source: 'cloudflare',
    ip: text('ip', 64),
    country:
      typeof v.country === 'string' && /^[a-z]{2}$/i.test(v.country.trim())
        ? v.country.trim().toUpperCase()
        : undefined,
    city: text('city'),
    region: text('region'),
    regionCode: text('regionCode', 16),
    latitude: coordinate('latitude', 90),
    longitude: coordinate('longitude', 180),
    postalCode: text('postalCode', 24),
    timezone: text('timezone', 80),
    colo: text('colo', 16),
    asn: typeof v.asn === 'number' && Number.isInteger(v.asn) && v.asn > 0 && v.asn <= 4294967295 ? v.asn : undefined,
    networkOrganization: text('networkOrganization', 200),
  };
}

export type LocationAccuracy = 'city' | 'region' | 'country' | 'unknown';
export interface GeoLocation {
  countryCode: string | null;
  countryName: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  regionCode?: string | null;
  postalCode?: string | null;
  colo?: string | null;
  asn?: number | null;
  networkOrganization?: string | null;
  accuracyLevel: LocationAccuracy;
  accuracyRadius: number | null;
  provider: string;
  status: 'enriched' | 'unknown' | 'failed' | 'timeout' | 'excluded' | 'disabled';
  isVpn: boolean | null;
  isProxy: boolean | null;
  isHostingProvider: boolean | null;
  isTor: boolean | null;
}
export interface GeographyFilters {
  from: string;
  to: string;
  project?: string;
  environment?: string;
  provider?: string;
  scope?: 'events' | 'logins' | 'visits';
  event?: string;
  success?: 'success' | 'failure' | 'all';
  metric?: 'events' | 'users' | 'visits';
  country?: string;
  region?: string;
  device?: 'desktop' | 'mobile' | 'tablet' | 'server';
  minEvents?: number;
  granularity?: 'country' | 'region' | 'city';
}
export interface GeographyPoint {
  id: string;
  countryCode: string;
  countryName: string;
  region: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  accuracyLevel: LocationAccuracy;
  accuracyRadius: number | null;
  totalEvents: number;
  totalVisits: number;
  uniqueUsers: number;
  percentage: number;
  firstSeen: string;
  lastSeen: string;
  previousEvents: number;
  previousVisits: number;
  previousUsers: number;
  trend: number;
  previousSuppressed?: boolean;
  applications: string[];
  providers: string[];
  vpnEvents: number | null;
  proxyEvents: number | null;
  hostingEvents: number | null;
  torEvents: number | null;
}
export interface GeographyData {
  locations: GeographyPoint[];
  summary: {
    totalEvents: number;
    totalVisits: number;
    geolocatedEvents: number;
    knownVisitors?: number;
    totalLogins: number;
    uniqueUsers: number;
    geolocatedLogins: number;
    coverage: number;
    countries: number;
    places: number;
    cities: number;
    regions: number;
    unknownLocations: number;
    newCountries: string[];
    mostActiveLocation: string | null;
  };
  granularity: 'country' | 'region' | 'city';
  truncated: boolean;
  enabled: boolean;
  sample: boolean;
  map: { darkStyle: string; lightStyle: string };
}

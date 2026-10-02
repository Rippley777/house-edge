export type LocationAccuracy = 'city' | 'region' | 'country' | 'unknown';
export interface GeoLocation {
  countryCode: string | null;
  countryName: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
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
  success?: 'success' | 'failure' | 'all';
  metric?: 'events' | 'users';
  country?: string;
  region?: string;
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
  uniqueUsers: number;
  percentage: number;
  firstSeen: string;
  lastSeen: string;
  previousEvents: number;
  previousUsers: number;
  trend: number;
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

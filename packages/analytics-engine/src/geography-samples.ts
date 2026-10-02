import type { GeographyData, GeographyFilters, GeographyPoint } from '../../shared/src/geography';
import { change } from '@house-edge/shared';
import { geographyEnabled } from '@house-edge/database/geolocation';

// Separate in-memory fixtures; never inserted into the event database.
export function geographySamples(f: GeographyFilters): GeographyData {
  const samples = [
    {
      countryCode: 'US',
      countryName: 'United States',
      region: 'Illinois',
      city: 'Chicago',
      latitude: 41.9,
      longitude: -87.6,
      accuracyLevel: 'city' as const,
    },
    {
      countryCode: 'GB',
      countryName: 'United Kingdom',
      region: 'England',
      city: 'London',
      latitude: 51.5,
      longitude: -0.1,
      accuracyLevel: 'city' as const,
    },
    {
      countryCode: 'JP',
      countryName: 'Japan',
      region: null,
      city: null,
      latitude: 36,
      longitude: 138,
      accuracyLevel: 'country' as const,
    },
    {
      countryCode: 'DE',
      countryName: 'Germany',
      region: 'Berlin',
      city: null,
      latitude: 52.5,
      longitude: 13.4,
      accuracyLevel: 'region' as const,
    },
  ];
  const locations: GeographyPoint[] = samples
    .filter((s) => (!f.country || f.country === s.countryCode) && (!f.region || f.region === s.region))
    .map((s, i) => ({
      ...s,
      id: `sample-${s.countryCode}`,
      accuracyRadius: s.accuracyLevel === 'country' ? null : 30,
      totalEvents: 60 - i * 10,
      uniqueUsers: 20 - i * 3,
      percentage: 0,
      firstSeen: f.from,
      lastSeen: f.to,
      previousEvents: 25,
      previousUsers: 10,
      trend: change(60 - i * 10, 25),
      applications: ['Development sample'],
      providers: ['Sample provider'],
      vpnEvents: null,
      proxyEvents: null,
      hostingEvents: null,
      torEvents: null,
    }));
  const total = locations.reduce((n, l) => n + l.totalEvents, 0);
  for (const l of locations) l.percentage = (l.totalEvents / total) * 100;
  return {
    locations: geographyEnabled() ? locations : [],
    sample: true,
    enabled: geographyEnabled(),
    granularity: 'city',
    truncated: false,
    summary: {
      totalEvents: total,
      geolocatedEvents: total,
      totalLogins: total,
      uniqueUsers: locations.reduce((n, l) => n + l.uniqueUsers, 0),
      geolocatedLogins: total,
      coverage: 100,
      countries: locations.length,
      places: locations.length,
      cities: locations.filter((l) => l.accuracyLevel === 'city').length,
      regions: locations.filter((l) => l.region).length,
      unknownLocations: 0,
      newCountries: [],
      mostActiveLocation: locations[0]?.city || null,
    },
    map: {
      darkStyle: process.env.NEXT_PUBLIC_GEO_MAP_DARK_STYLE || 'https://tiles.openfreemap.org/styles/dark',
      lightStyle: process.env.NEXT_PUBLIC_GEO_MAP_LIGHT_STYLE || 'https://tiles.openfreemap.org/styles/positron',
    },
  };
}

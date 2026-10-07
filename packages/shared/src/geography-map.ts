import type { GeographyPoint } from './geography';

/** Aggregate-only GeoJSON consumed by the map; never carries IPs or identities. */
export function geographyFeatures(points: GeographyPoint[], metric: 'events' | 'users' | 'visits') {
  return {
    type: 'FeatureCollection' as const,
    features: points
      .filter(
        (p) =>
          Number.isFinite(p.latitude) &&
          Number.isFinite(p.longitude) &&
          Math.abs(p.latitude) <= 90 &&
          Math.abs(p.longitude) <= 180 &&
          !(p.latitude === 0 && p.longitude === 0),
      )
      .map((p) => ({
        type: 'Feature' as const,
        properties: {
          id: p.id,
          weight: metric === 'users' ? p.uniqueUsers : metric === 'visits' ? p.totalVisits : p.totalEvents,
          accuracy: p.accuracyLevel,
        },
        geometry: { type: 'Point' as const, coordinates: [p.longitude, p.latitude] },
      })),
  };
}

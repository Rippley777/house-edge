'use client';
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { geographyFeatures as features } from '../../../packages/shared/src/geography-map';
import type { GeographyPoint } from '../../../packages/shared/src/geography';

interface Props {
  locations: GeographyPoint[];
  metric: 'events' | 'users' | 'visits';
  mode: 'clusters' | 'heatmap';
  theme: 'light' | 'dark';
  styleUrl: string;
  selected: string | null;
  onSelect: (id: string) => void;
  reset: number;
  fitKey: string;
  onZoom: (zoom: number) => void;
}
export default function GeographyMap(props: Props) {
  const element = useRef<HTMLDivElement>(null),
    mapRef = useRef<MapLibreMap | null>(null),
    latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const fitted = useRef('');
  const [center, setCenter] = useState('');
  useEffect(() => {
    if (!element.current) return;
    let map: MapLibreMap;
    let stopped = false;
    setReady(false);
    setError('');
    try {
      maplibregl.setWorkerUrl('/maplibre-worker.mjs');
      map = new maplibregl.Map({
        container: element.current,
        style: props.styleUrl,
        center: [0, 25],
        zoom: 1.3,
        maxZoom: 9,
        attributionControl: { compact: true },
        renderWorldCopies: false,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.on('error', () => {
        if (!stopped) setError('Map tiles are unavailable. You can still explore the locations in the table.');
      });
      map.on('load', () => {
        if (stopped) return;
        const p = latest.current,
          data = features(p.locations, p.metric);
        map.addSource('logins', {
          type: 'geojson',
          data,
          cluster: true,
          clusterRadius: 55,
          clusterMaxZoom: 7,
          clusterProperties: { weight: ['+', ['get', 'weight']] },
        });
        map.addSource('density', { type: 'geojson', data });
        const color = p.theme === 'dark' ? '#9aca83' : '#3c6730';
        map.addLayer({
          id: 'login-density',
          type: 'heatmap',
          source: 'density',
          paint: {
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 100, 1],
            'heatmap-radius': 38,
            'heatmap-opacity': 0.7,
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0,
              'rgba(100,140,80,0)',
              0.3,
              '#466843',
              0.65,
              '#8cba73',
              1,
              '#d8d9ad',
            ],
          },
        });
        map.addLayer({
          id: 'login-clusters',
          type: 'circle',
          source: 'logins',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': color,
            'circle-opacity': 0.75,
            'circle-stroke-color': '#dbe7ca',
            'circle-stroke-width': 1,
            'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 1, 12, 100, 22, 1000, 36],
          },
        });
        map.addLayer({
          id: 'login-points',
          type: 'circle',
          source: 'logins',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['match', ['get', 'accuracy'], 'city', color, 'region', '#c4b984', '#8b9d92'],
            'circle-opacity': 0.85,
            'circle-stroke-color': '#e1e5d4',
            'circle-stroke-width': 1.5,
            'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 1, 6, 100, 16, 1000, 26],
          },
        });
        map.on('click', 'login-points', (e) => {
          const id = e.features?.[0]?.properties?.id;
          if (id) latest.current.onSelect(String(id));
        });
        map.on('click', (e) => {
          if (latest.current.mode !== 'heatmap') return;
          // Heatmap layers are not queryable points; choose a nearby aggregate in screen space.
          const point = latest.current.locations
            .map((p) => ({ p, screen: map.project([p.longitude, p.latitude]) }))
            .sort((a, b) => a.screen.dist(e.point) - b.screen.dist(e.point))[0];
          if (point && point.screen.dist(e.point) < 45) latest.current.onSelect(point.p.id);
        });
        map.on('click', 'login-clusters', async (e) => {
          const feature = e.features?.[0];
          if (!feature || feature.geometry.type !== 'Point') return;
          try {
            const zoom = await (map.getSource('logins') as GeoJSONSource).getClusterExpansionZoom(
              Number(feature.properties?.cluster_id),
            );
            map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom: Math.min(zoom, 9) });
          } catch {
            /* A changed source can invalidate the selected cluster. */
          }
        });
        for (const layer of ['login-clusters', 'login-points']) {
          map.on('mouseenter', layer, () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', layer, () => {
            map.getCanvas().style.cursor = '';
          });
        }
        setReady(true);
        setError('');
      });
      map.on('moveend', () => {
        const c = map.getCenter();
        setCenter(`${c.lng.toFixed(1)},${c.lat.toFixed(1)}`);
      });
      map.on('zoomend', () => latest.current.onZoom(map.getZoom()));
    } catch {
      setError('Your browser could not initialize the map. The location table remains available.');
      return;
    }
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(element.current);
    return () => {
      stopped = true;
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [props.styleUrl, retry]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const data = features(props.locations, props.metric);
    (map.getSource('logins') as GeoJSONSource).setData(data);
    (map.getSource('density') as GeoJSONSource).setData(data);
    for (const layer of ['login-clusters', 'login-points'])
      map.setLayoutProperty(layer, 'visibility', props.mode === 'clusters' ? 'visible' : 'none');
    map.setLayoutProperty('login-density', 'visibility', props.mode === 'heatmap' ? 'visible' : 'none');
  }, [props.locations, props.metric, props.mode, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !props.locations.length) return;
    const key = `${props.fitKey}|${props.reset}|${props.styleUrl}|${retry}`;
    if (key === fitted.current) return;
    fitted.current = key;
    const bounds = new maplibregl.LngLatBounds();
    props.locations.forEach((p) => bounds.extend([p.longitude, p.latitude]));
    map.fitBounds(bounds, { padding: 55, maxZoom: 4, duration: 0 });
  }, [props.locations, props.fitKey, props.reset, ready]);
  useEffect(() => {
    const map = mapRef.current;
    const point = props.locations.find((p) => p.id === props.selected);
    if (map && ready && point)
      map.easeTo({
        center: [point.longitude, point.latitude],
        zoom: point.accuracyLevel === 'country' ? 3 : point.accuracyLevel === 'region' ? 5 : 7,
        duration: 500,
      });
  }, [props.selected, ready]);
  return (
    <div
      className={`geo-map-wrap geo-map-${props.theme}`}
      data-testid="login-map"
      data-selected-location={props.selected || ''}
      data-map-ready={ready}
      data-camera-center={center}
    >
      <div ref={element} className="geo-map" aria-label="Aggregated login location map" />
      {!ready && !error && (
        <div className="geo-map-overlay" role="status">
          Loading map…
        </div>
      )}
      {error && (
        <div className="geo-map-warning" role="alert">
          <span>{error}</span>
          <button className="button small" onClick={() => setRetry((n) => n + 1)}>
            Retry map
          </button>
        </div>
      )}
    </div>
  );
}

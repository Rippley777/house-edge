'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Globe2, Info, LocateFixed, ShieldCheck } from 'lucide-react';
import type { GeographyData, GeographyPoint } from '../../../packages/shared/src/geography';
import { useFetch, type ViewProps } from './dashboard';
import { Empty, Panel, number, date } from './ui';

const GeographyMap = dynamic(() => import('./login-geography-map'), {
  ssr: false,
  loading: () => <GeographyLoading />,
});
const explanation =
  'Locations are estimated from network information and may represent a city, region, VPN endpoint, mobile carrier gateway, or corporate network rather than the user’s exact physical location.';
export function GeographyLoading({ legacy = false }: { legacy?: boolean }) {
  return (
    <div
      className="geo-skeleton"
      role="status"
      aria-label={legacy ? 'Loading Login Geography' : 'Loading Event Geography'}
    >
      <div />
      <div />
      <div />
      <span>{legacy ? 'Loading login locations…' : 'Loading event locations…'}</span>
    </div>
  );
}
export function LoginGeography({ view, query, refresh, setGeographyDetail }: ViewProps) {
  const router = useRouter(),
    params = useSearchParams();
  const legacy = view === 'login-geography';
  const title = legacy ? 'Login Geography' : 'Event Geography';
  const visits = !legacy && params.get('scope') === 'visits';
  const eventLabel = legacy ? 'Login events' : visits ? 'Page views' : 'Events';
  const resultFilter =
    params.get('success') === 'success' || params.get('success') === 'failure'
      ? params.get('success')!
      : params.get('scope') === 'visits'
        ? 'visits'
        : params.get('scope') === 'logins'
          ? 'logins'
          : 'all';
  const [automatic, setAutomatic] = useState('country');
  const [selected, setSelected] = useState<string | null>(null),
    [reset, setReset] = useState(0);
  const [sort, setSort] = useState<keyof GeographyPoint>('totalEvents'),
    [ascending, setAscending] = useState(false);
  const [mapTheme, setMapTheme] = useState<'dark' | 'light'>('dark');
  const mode = params.get('mode') === 'heatmap' ? 'heatmap' : 'clusters';
  const metric = params.get('metric') === 'users' ? 'users' : params.get('metric') === 'visits' ? 'visits' : 'events';
  const granularity = params.get('granularity') || 'auto';
  const q = new URLSearchParams(query);
  for (const key of [
    'event',
    'scope',
    'environment',
    'provider',
    'country',
    'region',
    'success',
    'metric',
    'minEvents',
    'sample',
  ]) {
    const value = params.get(key);
    if (value) q.set(key, value);
  }
  q.set('granularity', granularity === 'auto' ? automatic : granularity);
  const result = useFetch<GeographyData>(`/api/${view}?${q}`, Number(params.get('geoRevision') || 0));
  const updateMany = (values: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value) p.set(key, value);
      else p.delete(key);
    }
    router.push(`/${view}?${p}`);
    setSelected(null);
  };
  const update = (key: string, value: string) => updateMany({ [key]: value });
  const data = result.data;
  useEffect(() => {
    if (data) setGeographyDetail(data.granularity);
  }, [data, setGeographyDetail]);
  const rows = useMemo(
    () =>
      [...(data?.locations || [])].sort((a, b) => {
        const av = a[sort],
          bv = b[sort];
        const comparison =
          typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av || '').localeCompare(String(bv || ''));
        return ascending ? comparison : -comparison;
      }),
    [data, sort, ascending],
  );
  const point = data?.locations.find((p) => p.id === selected);
  const fitKey = [
    q.get('from'),
    q.get('to'),
    q.get('project'),
    q.get('environment'),
    q.get('scope'),
    q.get('event'),
    q.get('success'),
    q.get('provider'),
    q.get('country'),
    q.get('region'),
  ].join('|');
  const stableFitKey = useRef(fitKey);
  if (!result.loading) stableFitKey.current = fitKey;
  const retry = () => {
    refresh();
    update('geoRevision', String(Date.now()));
  };
  const sortBy = (key: keyof GeographyPoint) => {
    if (sort === key) setAscending(!ascending);
    else {
      setSort(key);
      setAscending(false);
    }
  };
  return (
    <div className="geography-view" aria-busy={result.loading}>
      <div className="geo-controls">
        {!legacy && (
          <label>
            Event name
            <input
              aria-label="Event name"
              key={`event-${params.get('event')}`}
              defaultValue={params.get('event') || ''}
              placeholder="All event names"
              maxLength={120}
              onBlur={(e) => update('event', e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </label>
        )}
        <label>
          Environment
          <select
            aria-label={legacy ? 'Login environment' : 'Event environment'}
            value={params.get('environment') || ''}
            onChange={(e) => update('environment', e.target.value)}
          >
            <option value="">All environments</option>
            {['production', 'staging', 'development', 'test'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          {legacy ? 'Login result' : 'Event scope'}
          <select
            aria-label={legacy ? 'Login result' : 'Event scope'}
            value={legacy ? params.get('success') || 'success' : resultFilter}
            onChange={(e) =>
              legacy
                ? update('success', e.target.value)
                : updateMany({
                    scope: e.target.value === 'visits' ? 'visits' : e.target.value === 'all' ? 'events' : 'logins',
                    ...(e.target.value === 'visits' ? { event: '', metric: 'visits' } : {}),
                    success: ['success', 'failure'].includes(e.target.value) ? e.target.value : 'all',
                  })
            }
          >
            <option value="success">Successful logins</option>
            <option value="failure">Failed logins</option>
            <option value="all">{legacy ? 'All login events' : 'All events'}</option>
            {!legacy && <option value="logins">All login events</option>}
            {!legacy && <option value="visits">Website visits</option>}
          </select>
        </label>
        <label>
          Measure
          <select
            aria-label={legacy ? 'Login measure' : 'Event measure'}
            value={metric}
            onChange={(e) => update('metric', e.target.value)}
          >
            <option value="events">{legacy ? 'Total login events' : 'Total events'}</option>
            <option value="users">{visits ? 'Unique visitors' : 'Unique users'}</option>
            <option value="visits">Total visits (sessions)</option>
          </select>
        </label>
        <label>
          Detail
          <select
            aria-label="Map granularity"
            value={granularity}
            onChange={(e) => update('granularity', e.target.value)}
          >
            <option value="auto">Automatic by zoom</option>
            <option value="country">Country</option>
            <option value="region">Region</option>
            <option value="city">City</option>
          </select>
        </label>
        <label>
          Auth provider
          <input
            aria-label="Authentication provider"
            key={`provider-${params.get('provider')}`}
            defaultValue={params.get('provider') || ''}
            placeholder="All providers"
            onBlur={(e) => update('provider', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>
        <label>
          Country
          <input
            aria-label={legacy ? 'Login country' : 'Event country'}
            key={`country-${params.get('country')}`}
            defaultValue={params.get('country') || ''}
            placeholder="e.g. US"
            maxLength={2}
            onBlur={(e) => update('country', e.target.value.toUpperCase())}
          />
        </label>
        <label>
          Region
          <input
            aria-label={legacy ? 'Login region' : 'Event region'}
            key={`region-${params.get('region')}`}
            defaultValue={params.get('region') || ''}
            placeholder="All regions"
            onBlur={(e) => update('region', e.target.value)}
          />
        </label>
        <label>
          {legacy ? 'Minimum logins' : 'Minimum events'}
          <input
            aria-label={legacy ? 'Minimum login events' : 'Minimum events'}
            key={`minimum-${params.get('minEvents')}`}
            type="number"
            min={1}
            max={1000000}
            defaultValue={params.get('minEvents') || '1'}
            onBlur={(e) => update('minEvents', e.target.value)}
          />
        </label>
      </div>
      <div className="geo-accuracy-note">
        <Globe2 size={16} />
        <span>Approximate network locations · GPS is never collected</span>
        <button className="icon-button" aria-label={explanation} title={explanation}>
          <Info size={15} />
        </button>
      </div>
      {result.error ? (
        <div className="error-banner" role="alert">
          <ShieldCheck size={20} />
          <div>
            <strong>{title} is unavailable.</strong>
            <p>{result.error}</p>
          </div>
          <button className="button" onClick={retry}>
            Try again
          </button>
        </div>
      ) : !data ? (
        <GeographyLoading legacy={legacy} />
      ) : !data.enabled ? (
        <Panel>
          <Empty
            title={`${title} is disabled`}
            description="Geographic collection is disabled in the server configuration."
          />
        </Panel>
      ) : (
        <>
          {result.loading && (
            <p className="geo-footnote" role="status">
              {legacy ? 'Updating login locations…' : 'Updating event locations…'}
            </p>
          )}
          {data.sample && (
            <div className="info-banner geo-sample" role="note">
              Development samples · these locations are synthetic and are isolated from production analytics.
            </div>
          )}
          <div className="geo-summary summary-grid">
            {[
              ['Countries', number(data.summary.countries), 'In the selected period'],
              ['Total visits', number(data.summary.totalVisits), 'Distinct sessions in this selection'],
              [
                visits ? 'Unique visitors' : 'Unique users',
                number(data.summary.uniqueUsers),
                'Project-scoped identities',
              ],
              [
                legacy ? 'Geolocated Logins' : 'Geolocated Events',
                number(legacy ? data.summary.geolocatedLogins : data.summary.geolocatedEvents),
                `${number(legacy ? data.summary.totalLogins : data.summary.totalEvents)} total ${legacy ? 'login ' : ''}events`,
              ],
              ['Geolocation Coverage', `${data.summary.coverage.toFixed(1)}%`, 'Events with a usable location'],
              [
                'Most Active Location',
                data.summary.mostActiveLocation || '—',
                metric === 'users'
                  ? 'By project-scoped unique users'
                  : metric === 'visits'
                    ? 'By distinct sessions'
                    : 'By total events',
              ],
              ['New Countries', number(data.summary.newCountries.length), 'First seen in retained history'],
              [
                'Unknown Locations',
                number(data.summary.unknownLocations),
                'Includes unavailable and excluded locations',
              ],
            ].map(([label, value, detail]) => (
              <div className="summary-card panel" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{detail}</small>
              </div>
            ))}
          </div>
          <Panel
            title={legacy ? 'Login locations' : 'Event locations'}
            subtitle={`${data.granularity}-level aggregation · ${number(data.summary.uniqueUsers)} project-scoped users · ${number(data.summary.cities || 0)} cities / ${number(data.summary.regions || 0)} regions`}
            action={
              <div className="geo-map-actions">
                <div className="segmented">
                  {(['clusters', 'heatmap'] as const).map((v) => (
                    <button
                      key={v}
                      aria-pressed={mode === v}
                      className={mode === v ? 'selected' : ''}
                      onClick={() => update('mode', v)}
                    >
                      {v === 'clusters' ? 'Clustered locations' : legacy ? 'Login density' : 'Event density'}
                    </button>
                  ))}
                </div>
                <button
                  className="button small"
                  aria-label="Toggle map theme"
                  onClick={() => setMapTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                >
                  {mapTheme === 'dark' ? 'Light map' : 'Dark map'}
                </button>
                <button className="icon-button" aria-label="Reset map view" onClick={() => setReset((n) => n + 1)}>
                  <LocateFixed size={17} />
                </button>
              </div>
            }
          >
            {data.locations.length ? (
              <GeographyMap
                locations={data.locations}
                metric={metric}
                mode={mode}
                theme={mapTheme}
                styleUrl={mapTheme === 'dark' ? data.map.darkStyle : data.map.lightStyle}
                selected={selected}
                onSelect={setSelected}
                reset={reset}
                fitKey={stableFitKey.current}
                onZoom={(zoom) => setAutomatic(zoom < 3 ? 'country' : zoom < 5 ? 'region' : 'city')}
              />
            ) : (
              <Empty
                title={legacy ? 'No geolocated logins in this range' : 'No geolocated events in this range'}
                description={
                  data.summary.totalEvents
                    ? 'Events are present, but their network location is unavailable, excluded, pending, or below the selected threshold.'
                    : 'Send events from a connected application or choose another date range.'
                }
              />
            )}
            <div className="geo-legend">
              <span>
                <i className="city" />
                City-level estimate
              </span>
              <span>
                <i className="region" />
                Region-level estimate
              </span>
              <span>
                <i className="country" />
                Country-level estimate
              </span>
              <span>
                <i />
                Unknown · never plotted
              </span>
            </div>
            {data.truncated && (
              <p className="geo-footnote">
                The result is capped. Narrow the date range or select a project for more detail.
              </p>
            )}
          </Panel>
          {point && <LocationDetails point={point} eventLabel={eventLabel} />}
          <Panel
            title="Top Locations"
            subtitle="Select a location to focus the map. Comparisons use the preceding period of equal duration."
          >
            {rows.length ? (
              <div className="table-scroll">
                <table className="data-table geo-table">
                  <thead>
                    <tr>
                      {(
                        [
                          ['city', 'Location'],
                          ['countryName', 'Country'],
                          ['totalEvents', eventLabel],
                          ['totalVisits', 'Visits (sessions)'],
                          ['uniqueUsers', 'Unique users'],
                          ['percentage', 'Share'],
                          ['firstSeen', 'First seen (UTC)'],
                          ['lastSeen', 'Last seen (UTC)'],
                          ['trend', 'Trend'],
                        ] as [keyof GeographyPoint, string][]
                      ).map(([key, label]) => (
                        <th key={key} aria-sort={sort === key ? (ascending ? 'ascending' : 'descending') : 'none'}>
                          <button onClick={() => sortBy(key)}>
                            {label}
                            {sort === key ? (ascending ? ' ↑' : ' ↓') : ''}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr
                        key={p.id}
                        className="clickable"
                        aria-selected={selected === p.id}
                        tabIndex={0}
                        onClick={() => setSelected(p.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelected(p.id);
                          }
                        }}
                      >
                        <td>
                          <strong>{p.city || p.region || p.countryName}</strong>
                          <small className="cell-sub">{p.accuracyLevel}-level estimate</small>
                        </td>
                        <td>{p.countryName}</td>
                        <td>{number(p.totalEvents)}</td>
                        <td>{number(p.totalVisits)}</td>
                        <td>{number(p.uniqueUsers)}</td>
                        <td>{p.percentage.toFixed(1)}%</td>
                        <td>{date(p.firstSeen)}</td>
                        <td>{date(p.lastSeen)}</td>
                        <td>
                          {(metric === 'users'
                            ? p.previousUsers
                            : metric === 'visits'
                              ? p.previousVisits
                              : p.previousEvents) === 0
                            ? 'First activity'
                            : `${p.trend > 0 ? '+' : ''}${p.trend.toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No locations to compare" />
            )}
            <p className="geo-footnote">
              Visits count distinct sessions; Website visits includes only page views. Visitors and sessions can appear
              in more than one location and are scoped to each project. Unknown locations remain in the share
              denominator.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
function LocationDetails({ point: p, eventLabel }: { point: GeographyPoint; eventLabel: string }) {
  return (
    <Panel
      title={[p.city, p.region, p.countryName].filter(Boolean).join(', ')}
      subtitle={`${p.accuracyLevel}-level estimate${p.accuracyRadius ? ` · approximate radius ≥ ${p.accuracyRadius} km` : ''}`}
      className="geo-details"
    >
      <dl>
        {[
          [eventLabel, number(p.totalEvents)],
          ['Visits (sessions)', number(p.totalVisits)],
          ['Unique users', number(p.uniqueUsers)],
          ['Share of selection', `${p.percentage.toFixed(1)}%`],
          ['First seen (UTC)', new Date(p.firstSeen).toISOString()],
          ['Last seen (UTC)', new Date(p.lastSeen).toISOString()],
          ['Applications', p.applications.join(', ')],
          ['Authentication providers', p.providers.join(', ')],
          ['VPN events', p.vpnEvents ?? 'Unavailable'],
          ['Proxy events', p.proxyEvents ?? 'Unavailable'],
          ['Hosting events', p.hostingEvents ?? 'Unavailable'],
          ['Tor events', p.torEvents ?? 'Unavailable'],
        ].map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

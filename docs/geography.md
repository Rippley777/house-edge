# Event Geography

Event Geography aggregates approximate network locations from **all event types**: page views, custom events, errors, timings, sessions, conversions, and authentication. Open `/geography`; the existing date and project filters apply to the map, summary, and table. Exact event name, event scope (all events, all logins, successful or failed logins), environment, authentication provider, country, region, minimum event count, and event/user measure are additional filters. Automatic detail selects country below zoom 3, region below zoom 5, and city at higher zoom. Requests exceeding 500 locations fall back to coarser aggregation. A location row focuses the map and opens aggregate details. Both cluster and density views use the same counts.

This is IP-based analytics, not GPS. Locations can represent a VPN endpoint, carrier gateway, or corporate network. City estimates use provider representative coordinates rounded to 0.1 degrees with a displayed accuracy radius of at least 15 km. Region aggregates are rounded representatives with a radius of at least 100 km. Country-only records always use the packaged country centroid and never claim city accuracy. Records without usable coordinates are included in unknown counts and never plotted at 0,0. VPN/proxy/hosting/Tor counts are unavailable unless a provider reports them; they are not confirmed attack indicators. No individual users or IP addresses appear in geography responses. No browser GPS permission is requested.

## Connected application contract

### Cloudflare locations from a connected website

Rippley Labs uses a same-origin analytics Worker to enrich its existing SDK events from `request.cf` and `CF-Connecting-IP`. It sends `location: { version: 1, source: 'cloudflare', country: 'US', region: 'Texas', regionCode: 'TX', city: 'Fort Worth', latitude: 32.8, longitude: -97.3, postalCode: '76102', timezone: 'America/Chicago', colo: 'DFW', asn: 64500, networkOrganization: 'Example network', ip: trustedClientIp }` with a **server ingestion key**. The collector rejects browser-key location assertions. Events and sessions keep their existing IDs and names. This is an additive optional contract; old clients continue to work.

Cloudflare locations are normalized and stored on the existing event row in the staging transaction, without IP lookup jobs or external provider calls. Invalid/missing geography cannot block event ingestion. Coordinates are rounded to 0.1 degrees; city estimates have a minimum 15 km radius, region estimates 100 km, and country fallback uses the packaged country centroid. No raw IP is persisted or cached by this path: an optional HMAC uses `GEO_IP_HASH_SALT`, otherwise the address is discarded. Region code, postal code, colo, ASN and network organization use nullable structured columns and are cleared by geographic retention. Public aggregate responses exclude them, IP hashes, session IDs and visitor IDs.

Apply **004_cloudflare_geography** before deploying this collector to Azure SQL. The migration adds nullable columns and a project/page-view/time/location index without rewriting existing analytics. SQLite applies it on first access. Migration 004 is backward-compatible with old collectors and preserves prior geo records. Deploy the House Edge consumer before the Rippley Labs Worker producer. See Rippley Labs `docs/ANALYTICS_GEOGRAPHY.md` for the route and environment configuration; this change does not provision cloud resources.

Select **Website visits** (`scope=visits`) to include only `page_view` events, excluding `session_start`, timings and errors. `summary.totalEvents` is then the page-view count; `summary.totalVisits` and each location's `totalVisits` count distinct project/session pairs in the selected window, and `uniqueUsers` counts project-scoped visitor identities. `metric=visits` weights the map and trends by sessions; `metric=users` uses visitors. Country/region/city detail and existing date controls apply to each metric. A session visiting multiple places can appear in multiple location aggregates, so sums can exceed the overall distinct count. Cluster weights sum location counts, not globally deduplicated visitors.

Run `npm run geo:verify -- /path/to/rippley-labs` for an isolated, persistent SQLite trace through the actual Rippley relay, loopback HTTP collector, storage, authenticated map API and the same GeoJSON function used by MapLibre. The script creates fresh synthetic data in `.data/cloudflare-verification-*` and reports the JSON trace/database paths. It never uses the configured production database. The fixture includes Dallas/Fort Worth, New York, Los Angeles, London, Sydney and Tokyo, repeat visits, multiple pages and exact duplicate batches. `tests/e2e/cloudflare-geography.spec.ts` checks real ingestion/persistence/API/rendering and all three aggregation levels.

Every accepted event is eligible for enrichment; browser SDK auto-tracked events need no changes. Event names remain unchanged. Optional `environment` defaults to the project environment. Server events may include top-level `sourceIp`, accepted only with a server ingestion key. The Node SDK supports both in its third `track` argument. These additive fields do not change existing clients.

```ts
analytics.track(
  'checkout_completed',
  { amount: 42 },
  {
    sessionId,
    anonymousId,
    sourceIp: trustedClientIp,
    environment: 'production',
  },
);
await analytics.flush();
```

The browser SDK accepts an optional `environment` in `init`; its requests use trusted collector transport/ingress context for geography, never browser-supplied IP fields.

Login events use `<application>.auth.login.succeeded.v1` or `<application>.auth.login.failed.v1` (also accepted without the application prefix). Login metadata is optional; names determine success. If metadata is supplied its success value must agree with the name. Environment defaults to the project's environment; use a separate development/staging project or set the event environment explicitly.

Report from the application's authentication server with a **server ingestion key**, after the authentication result is known. Determine the originating IP using that application's actual socket peer and trusted proxy configuration. Never copy an arbitrary request header into `sourceIp`. An application server's transport IP is not attributed to its users. Browser keys cannot supply `sourceIp`; browser login analytics have weaker provenance and should not be treated as security proof.

```json
{
  "projectKey": "deck",
  "key": "YOUR_PRIVATE_SERVER_INGESTION_KEY",
  "events": [
    {
      "id": "6bdafbd8-fd9d-4cbe-a157-f5f8280a576f",
      "event": "deck.auth.login.succeeded.v1",
      "sessionId": "opaque-session-id",
      "anonymousId": "opaque-project-scoped-visitor-id",
      "userId": "opaque-project-scoped-user-id",
      "timestamp": "2026-10-01T12:00:00.000Z",
      "properties": {},
      "login": {
        "success": true,
        "provider": "github",
        "environment": "production",
        "correlationId": "opaque-request-id",
        "sourceIp": "PUBLIC_CLIENT_IP_FROM_TRUSTED_SERVER_CONTEXT"
      }
    }
  ]
}
```

Use the current UTC timestamp and a new event UUID for each occurrence. POST to `/api/collect`. The Node SDK also accepts `login` in the third `track` argument:

```ts
analytics.track(
  'deck.auth.login.succeeded.v1',
  {},
  {
    sessionId,
    anonymousId,
    userId,
    login: { success: true, provider: 'github', environment: 'production', sourceIp: trustedClientIp },
  },
);
// Flush after responding to the login, or in the host's background lifecycle.
await analytics.flush();
```

The event and standard projections commit first. Optional geography staging errors cannot reject the accepted batch. No provider calls occur in the collector response path. A dedicated short-lived work table records encrypted enrichment inputs. Next.js `after()` drains a bounded batch after the response. Scheduled maintenance and `npm run geo:enrich` recover unprocessed work after crashes. Transactional leases prevent concurrent workers claiming the same job; results require the lease token. A provider timeout/failure is terminal for that job, recorded as timeout/failed, and does not affect the event. Repeated failures are briefly negatively cached; retry historical records with an authorized source export.

## Privacy, secrets and retention

- `GEO_QUEUE_KEY`: independent 32-byte key as 64 hexadecimal characters; encrypts temporary IPs with AES-256-GCM. Generate with `openssl rand -hex 32`. Keep it server-only and outside the database. Rotating it makes pending jobs unreadable; they safely become failed/unknown. No IP-based work is queued without it.
- `GEO_IP_HASH_SALT`: separate server secret of at least 32 characters. HMAC-SHA256 creates one-way IP hashes for deduplication/cache keys. Without it enrichment still works but persistent IP caching is disabled. Rotation invalidates cache matches.
- `GEO_RETENTION_DAYS`: 1–730, default 30. Maintenance removes location fields, indicators, and hashes from older events while keeping the ordinary analytics event until normal event retention expires.
- Temporary encrypted jobs expire after **one hour**, and completion immediately deletes them. Expired jobs are not enriched. Database maintenance removes expired inputs/caches. Schedule it at least every five minutes; without a running maintenance schedule expired ciphertext remains in storage although workers will not use it. Backups must follow the same retention policy; deleting live rows does not erase backups.
- `GEO_CACHE_DAYS`: 1–30, default 7. Cache keys combine an HMAC IP hash with provider/version. No raw IP is stored. Failure entries last one minute. Trusted country-header fallback is not cached as an IP/provider result.
- Exact fields named IP/source-IP/forwarded headers are recursively scrubbed in both SDKs and the collector. `sourceIp` and legacy `login.sourceIp` are consumed separately (conflicting values are rejected), never included in event properties. All event listing/session/export queries use an explicit field projection including approximate geography and status to prevent exposing IP hashes or staging fields.
- Requests to an optional external adapter send the IP to that configured service. Ensure its data handling matches your policy. Public basemap requests reveal the **dashboard viewer's** IP and viewport to the tile host; they never send event IPs or identities. Self-host a compatible map style for private deployments.

All environments are eligible by default. Set `GEO_PRODUCTION_ONLY=true` to exclude non-production events from enrichment (they remain in the coverage denominator). Localhost, private, loopback, link-local, documentation, multicast, carrier NAT, malformed addresses, and server-to-server traffic without an explicit client source are excluded/unknown. IPv4, IPv6, and IPv4-mapped IPv6 are normalized. An event can be recorded even when geography is completely unavailable.

`GEOGRAPHY_ENABLED=false` (or legacy `LOGIN_GEOGRAPHY_ENABLED=false` when the new variable is unset) disables collection/enrichment and the API returns an empty disabled result. Maintenance discards pending jobs and caches. Existing geographic records age out under retention; disabling does not delete historical event records. Privacy-sensitive deployments should set the minimum event count control to an appropriate aggregation threshold.

## Provider setup

Resolution order is local MMDB, optional HTTPS adapter, trusted infrastructure country, unknown. There was no preexisting IP provider in this repository. No default request is sent to a geolocation vendor and no paid service is required.

1. Mount a licensed GeoLite-compatible City/Country `.mmdb` file read-only and set `GEO_MMDB_PATH`. The file is not bundled or downloaded automatically. Check its license and update it regularly. Restart the process after replacing the file and bump `GEO_PROVIDER_VERSION` to invalidate cached results.
2. Optionally set `GEO_PROVIDER_URL` to an HTTPS adapter endpoint, `GEO_PROVIDER_TOKEN` to its bearer token, and `GEO_PROVIDER_VERSION` to a dataset/adapter version. This is a vendor-neutral adapter: configure a service returning the normalized contract below, rather than a vendor endpoint with different fields. URLs are configuration only, never supplied by events. Redirects are rejected and responses are bounded to 16 KB.
3. `GEO_TIMEOUT_MS`: default 1500, bounded to 10–5000 milliseconds **per provider**. `GEO_LOOKUP_INTERVAL_MS`: default 0, max 5000, minimum spacing between queued lookups for rate-limited adapters. Production collectors also retain their existing per-project ingestion limits. Set `GEO_AFTER_RESPONSE_ENABLED=false` and run a single scheduled worker when a provider enforces a global rate quota across replicas.

An adapter receives `POST {"ip":"..."}` and should return:

```json
{
  "countryCode": "US",
  "region": "Illinois",
  "city": "Chicago",
  "latitude": 41.9,
  "longitude": -87.6,
  "coordinatesAreCentroid": true,
  "accuracyLevel": "city",
  "accuracyRadius": 25,
  "timezone": "America/Chicago",
  "isVpn": false,
  "isProxy": false,
  "isHostingProvider": false,
  "isTor": false
}
```

Country name is normalized using packaged country data. Coordinates must be representative city/region centroids and explicitly labeled `coordinatesAreCentroid`; otherwise House Edge downgrades to country. Optional risk indicators must be booleans; absent is unknown. Invalid country codes produce failed enrichment. Never claim a street coordinate as a centroid.

## Trusted proxy deployment

Next.js Fetch requests do not expose the socket remote address. House Edge therefore **does not trust forwarded headers by default**, even if a familiar Cloudflare/Azure header is present.

Preferred server integrations supply an already verified `sourceIp` (`login.sourceIp` remains supported for login events) with a server key. For browser collection through a controlled ingress, configure a separate `GEO_INGRESS_SECRET` of at least 32 characters. The ingress must strip inbound `x-house-edge-ingress-token` and set that header itself, normalize `X-Forwarded-For`, and prevent direct origin access. Never distribute this secret to browsers or other applications. Configure any trusted intermediate hop networks in `GEO_TRUSTED_PROXY_CIDRS`; peeling proceeds from the right until the first untrusted hop, rejecting malformed chains. This avoids trusting an attacker-controlled first XFF entry. Do not configure `0.0.0.0/0` or `::/0`.

For a socket-aware standalone collector adapter, pass the actual `remoteAddress` as the second `collect` argument. Only peers in `GEO_TRUSTED_PROXY_CIDRS` or `GEO_CLOUDFLARE_CIDRS` can supply proxy headers. The direct public peer is otherwise the fallback. Keep Cloudflare network ranges current in deployment configuration. `CF-Connecting-IP` and `CF-IPCountry` are used only for trusted Cloudflare peers, or when `GEO_CLOUDFLARE_INGRESS=true` and the authenticated ingress admits only Cloudflare and preserves its sanitized headers. Azure ingress chains use XFF with authenticated ingress/explicit trusted peer networks. No Azure-specific header is blindly trusted. Internal trusted hops are skipped; a private untrusted client is excluded, never substituted with a proxy's public address.

## Database migration and operation

Run `npm run db:migrate` with migration credentials before deploying to Azure SQL. Apply migrations 002 and 003 before the expanded collector. The migrator writes reviewable SQL artifacts and records versions transactionally through `schema_migrations`. Migration 003 adds `event_environment`, initializes historical environments from login metadata or the project, and adds a project/environment/event/time index. It preserves existing login enrichment. Azure migration 003 includes `GO` batch separators for SQL tooling; the programmatic migrator executes each statement separately. SQLite applies migrations automatically at first access. Version 2 adds nullable geographic/login columns to the existing events table, a short-lived job table with cascading deletion, a privacy-safe cache table, and indexes for time/project/environment/country/location/enrichment. It preserves existing records and projections. Azure uses NVARCHAR/VARCHAR, FLOAT and integer nullable indicators.

Schedule `npm run db:maintain` or authenticated `POST /api/maintenance` every five minutes. `npm run geo:enrich` processes up to 100 jobs without alert evaluation. Queue writes are durable; provider calls are outside database transactions. A large Azure installation should profile aggregates and retention with representative volumes and configure a suitable maintenance frequency; no separate managed queue is introduced. SQLite remains a single-instance development database.

## Backfill

House Edge previously did not store IP addresses. It cannot reconstruct historical city locations from event IDs, anonymous IDs, or a bare reported country. Do not invent them. If you have an authorized source export from the source application's logs, prepare a private NDJSON file containing:

```json
{
  "eventId": "6bdafbd8-fd9d-4cbe-a157-f5f8280a576f",
  "projectId": "a9699f8f-e9ac-4981-a24b-c2a779dd8b76",
  "sourceIp": "PUBLIC_CLIENT_IP"
}
```

Run `npm run geo:backfill -- /private/source.ndjson .data/backfill-state.json` with queue/provider configuration. It streams input, checks the event and project pair, accepts all event names, skips already enriched records, processes batches of 100, reuses provider caching/rate spacing, records invalid lines without printing their contents, and atomically writes a restart checkpoint with counts. Run again with exactly the same file/checkpoint to resume; changed files require a new checkpoint. It drains already queued work before final completion. Stop/restart at any time: stable event IDs, existing enriched data, and queue leases avoid duplicate analytics rows. Keep exports private and delete them under the source application's retention policy. Records older than geographic retention expire without enrichment. Provider errors remain in event status; retry with a new checkpoint after fixing the source/provider. There is no automatic attempt to obtain lost historical IPs.

## API and metrics

Authenticated `GET /api/geography` defaults to all events and accepts `event` (exact event name), `scope=events|logins`, `from`, `to`, `project` (project UUID or `all`), `environment`, `provider`, `success=success|failure|all` (default `all`; success/failure restrict to login outcomes), `metric=events|users`, `country` (ISO two-letter uppercase), `region`, `minEvents`, and `granularity=country|region|city`. Date ranges follow the dashboard's 366-day cap. Responses include `summary.totalEvents` and `summary.geolocatedEvents`; legacy login count fields count actual login events only. Responses contain aggregate locations, counts, selected-period first/last time, equivalent previous-period trend, application/provider sets, optional risk counts, and summary coverage/new countries/unknown counts. CSV exports and saved views support this screen. SQL parameters cover all values; only validated enum choices select query shapes. Administrative authentication and the existing single-owner workspace apply. Ingestion keys are project-scoped and cannot read analytics. This application has no organizations/RBAC; a project filter is not a multi-tenant authorization system.

Unique visitors use project-scoped anonymous IDs, consistently with traffic analytics. They are not deduplicated across projects. A person can be present in multiple locations, so unique-user location shares may sum above 100%. Unknown events stay in the selected denominator. New countries mean first observed within retained geographic history under the current filters, not first ever. Security/travel detection is intentionally omitted because incomplete coverage and device identities are not reliable enough to support it.

## Local development and validation

Real localhost traffic never turns into a location. To inspect UI interactions, set `GEO_DEVELOPMENT_SAMPLES=true`, keep demo mode enabled, run the development server, and open `/geography?sample=true`. These in-memory locations are visibly labeled **Development samples**, never inserted into analytics tables, cannot be saved or exported, require a non-production Node environment, and are rejected outside demo mode. They illustrate city/region/country accuracy. Disable sample mode before inspecting real filters; fixtures are demonstration data, not real event metrics.

MapLibre loads only on the client. Default OpenFreeMap dark/positron styles require network access; configure `NEXT_PUBLIC_GEO_MAP_DARK_STYLE` and `NEXT_PUBLIC_GEO_MAP_LIGHT_STYLE` for your own compatible tile source. Style/renderer failures show a retry message while the table remains usable. The map offers its own light/dark toggle and works independently of the dashboard's current dark-only design.

`npm test` covers proxy trust/spoofing, IPv4/IPv6 exclusions, providers/timeouts/malformed data, asynchronous failure, caching/deduplication, aggregation/filtering/isolation, authorization/privacy, migrations and retention. `npm run test:e2e` covers loading/empty/error states, table-to-map focus, map modes, filters and narrow viewports using deterministic aggregate fixtures. External providers are mocked; no paid/live API is required.

## Fine geography privacy

Region/city aggregate rows require at least three distinct anonymous visitors, regardless of `minEvents`. This applies independently to current and previous periods and to CSV export. A region filter with fewer than three visitors returns no summary. Country aggregation still shows smaller groups; choose country detail when finer rows are suppressed. Previous fine-period counts that fail the threshold are marked `previousSuppressed` and displayed as unavailable/private, not evidence of new traffic. This is basic bucket suppression, not differential privacy or protection against all overlapping-query inference by the authorized workspace owner.

`device=desktop|mobile|tablet|server` filters SQL aggregates. `summary.knownVisitors` counts distinct anonymous visitors with known geography. Visits are distinct sessions; page views are event counts under `scope=visits`. Neither is labeled as the other. Legacy browser `country` is ignored at collection. Trusted server geography continues through the existing versioned envelope; no additional geographic data is collected by the SDK.

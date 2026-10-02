# Login Geography

Login Geography aggregates approximate network locations from versioned authentication events. Open `/login-geography`; the existing date and project filters apply to the map, summary, and table. Environment, authentication provider, outcome, country, region, minimum login count, and event/user measure are additional filters. Automatic detail selects country below zoom 3, region below zoom 5, and city at higher zoom. Requests exceeding 500 locations fall back to coarser aggregation. A location row focuses the map and opens aggregate details. Both cluster and density views use the same counts.

This is IP-based analytics, not GPS. Locations can represent a VPN endpoint, carrier gateway, or corporate network. City estimates use provider representative coordinates rounded to 0.1 degrees with a displayed accuracy radius of at least 15 km. Region aggregates are rounded representatives with a radius of at least 100 km. Country-only records always use the packaged country centroid and never claim city accuracy. Records without usable coordinates are included in unknown counts and never plotted at 0,0. VPN/proxy/hosting/Tor counts are unavailable unless a provider reports them; they are not confirmed attack indicators. No individual users or IP addresses appear in geography responses. No browser GPS permission is requested.

## Connected application contract

Existing events and clients continue to work. New login events use `<application>.auth.login.succeeded.v1` or `<application>.auth.login.failed.v1` (also accepted without the application prefix). Login metadata is optional; names determine success. If metadata is supplied its success value must agree with the name. Environment defaults to the project's environment; use a separate development/staging project or set the event environment explicitly.

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

The event and standard projections commit first. Optional geography staging errors cannot reject the accepted batch. No provider calls occur in the collector response path. A dedicated short-lived work table records encrypted enrichment inputs. Next.js `after()` drains a bounded batch after the response. Scheduled maintenance and `npm run geo:enrich` recover unprocessed work after crashes. Transactional leases prevent concurrent workers claiming the same job; results require the lease token. A provider timeout/failure is terminal for that job, recorded as timeout/failed, and does not affect the login. Repeated failures are briefly negatively cached; retry historical records with an authorized source export.

## Privacy, secrets and retention

- `GEO_QUEUE_KEY`: independent 32-byte key as 64 hexadecimal characters; encrypts temporary IPs with AES-256-GCM. Generate with `openssl rand -hex 32`. Keep it server-only and outside the database. Rotating it makes pending jobs unreadable; they safely become failed/unknown. No IP-based work is queued without it.
- `GEO_IP_HASH_SALT`: separate server secret of at least 32 characters. HMAC-SHA256 creates one-way IP hashes for deduplication/cache keys. Without it enrichment still works but persistent IP caching is disabled. Rotation invalidates cache matches.
- `GEO_RETENTION_DAYS`: 1–730, default 30. Maintenance removes location fields, indicators, and hashes from older events while keeping the ordinary analytics event until normal event retention expires.
- Temporary encrypted jobs expire after **one hour**, and completion immediately deletes them. Expired jobs are not enriched. Database maintenance removes expired inputs/caches. Schedule it at least every five minutes; without a running maintenance schedule expired ciphertext remains in storage although workers will not use it. Backups must follow the same retention policy; deleting live rows does not erase backups.
- `GEO_CACHE_DAYS`: 1–30, default 7. Cache keys combine an HMAC IP hash with provider/version. No raw IP is stored. Failure entries last one minute. Trusted country-header fallback is not cached as an IP/provider result.
- Exact fields named IP/source-IP/forwarded headers are recursively scrubbed in both SDKs and the collector. `login.sourceIp` is consumed separately, never included in event properties. All event listing/session/export queries use an explicit preexisting field projection to prevent exposing IP hashes or staging fields.
- Requests to an optional external adapter send the IP to that configured service. Ensure its data handling matches your policy. Public basemap requests reveal the **dashboard viewer's** IP and viewport to the tile host; they never send login IPs or identities. Self-host a compatible map style for private/offline deployments.

Only production login environments are enriched. Localhost, private, loopback, link-local, documentation, multicast, carrier NAT, malformed addresses, and server-to-server traffic without an explicit client source are excluded/unknown. IPv4, IPv6, and IPv4-mapped IPv6 are normalized. A successful login can be recorded even when geography is completely unavailable.

`LOGIN_GEOGRAPHY_ENABLED=false` disables collection/enrichment and the API returns an empty disabled result. Maintenance discards pending jobs and caches. Existing geographic records age out under retention; disabling does not delete historical event records. Privacy-sensitive deployments should set the minimum event count control to an appropriate aggregation threshold.

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

Preferred server-authentication integrations supply an already verified `login.sourceIp` with a server key. For browser collection through a controlled ingress, configure a separate `GEO_INGRESS_SECRET` of at least 32 characters. The ingress must strip inbound `x-house-edge-ingress-token` and set that header itself, normalize `X-Forwarded-For`, and prevent direct origin access. Never distribute this secret to browsers or other applications. Configure any trusted intermediate hop networks in `GEO_TRUSTED_PROXY_CIDRS`; peeling proceeds from the right until the first untrusted hop, rejecting malformed chains. This avoids trusting an attacker-controlled first XFF entry. Do not configure `0.0.0.0/0` or `::/0`.

For a socket-aware standalone collector adapter, pass the actual `remoteAddress` as the second `collect` argument. Only peers in `GEO_TRUSTED_PROXY_CIDRS` or `GEO_CLOUDFLARE_CIDRS` can supply proxy headers. The direct public peer is otherwise the fallback. Keep Cloudflare network ranges current in deployment configuration. `CF-Connecting-IP` and `CF-IPCountry` are used only for trusted Cloudflare peers, or when `GEO_CLOUDFLARE_INGRESS=true` and the authenticated ingress admits only Cloudflare and preserves its sanitized headers. Azure ingress chains use XFF with authenticated ingress/explicit trusted peer networks. No Azure-specific header is blindly trusted. Internal trusted hops are skipped; a private untrusted client is excluded, never substituted with a proxy's public address.

## Database migration and operation

Run `npm run db:migrate` with migration credentials before deploying to Azure SQL. It writes reviewable `migrations/002_login_geography.{azure,sqlite}.sql` and applies version 2 transactionally through `schema_migrations`. SQLite applies migrations automatically at first access. Version 2 adds nullable geographic/login columns to the existing events table, a short-lived job table with cascading deletion, a privacy-safe cache table, and indexes for time/project/environment/country/location/enrichment. It preserves existing records and projections. Azure uses NVARCHAR/VARCHAR, FLOAT and integer nullable indicators.

Schedule `npm run db:maintain` or authenticated `POST /api/maintenance` every five minutes. `npm run geo:enrich` processes up to 100 jobs without alert evaluation. Queue writes are durable; provider calls are outside database transactions. A large Azure installation should profile aggregates and retention with representative volumes and configure a suitable maintenance frequency; no separate managed queue is introduced. SQLite remains a single-instance development database.

## Backfill

House Edge previously did not store IP addresses. It cannot reconstruct historical city locations from event IDs, anonymous IDs, or a bare reported country. Do not invent them. If you have an authorized source export from the authentication application's logs, prepare a private NDJSON file containing:

```json
{
  "eventId": "6bdafbd8-fd9d-4cbe-a157-f5f8280a576f",
  "projectId": "a9699f8f-e9ac-4981-a24b-c2a779dd8b76",
  "sourceIp": "PUBLIC_CLIENT_IP"
}
```

Run `npm run geo:backfill -- /private/source.ndjson .data/backfill-state.json` with queue/provider configuration. It streams input, checks the event and project pair, accepts only versioned login events, skips already enriched records, processes batches of 100, reuses provider caching/rate spacing, records invalid lines without printing their contents, and atomically writes a restart checkpoint with counts. Run again with exactly the same file/checkpoint to resume; changed files require a new checkpoint. It drains already queued work before final completion. Stop/restart at any time: stable event IDs, existing enriched data, and queue leases avoid duplicate analytics rows. Keep exports private and delete them under the source application's retention policy. Records older than geographic retention expire without enrichment. Provider errors remain in event status; retry with a new checkpoint after fixing the source/provider. There is no automatic attempt to obtain lost historical IPs.

## API and metrics

Authenticated `GET /api/login-geography` accepts `from`, `to`, `project` (project UUID or `all`), `environment`, `provider`, `success=success|failure|all`, `metric=events|users`, `country` (ISO two-letter uppercase), `region`, `minEvents`, and `granularity=country|region|city`. Date ranges follow the dashboard's 366-day cap. Responses contain aggregate locations, counts, selected-period first/last time, equivalent previous-period trend, application/provider sets, optional risk counts, and summary coverage/new countries/unknown counts. CSV exports and saved views support this screen. SQL parameters cover all values; only validated enum choices select query shapes. Administrative authentication and the existing single-owner workspace apply. Ingestion keys are project-scoped and cannot read analytics. This application has no organizations/RBAC; a project filter is not a multi-tenant authorization system.

Unique users use a project-scoped opaque identified ID when present and the anonymous ID otherwise. They are not deduplicated across projects. A person can be present in multiple locations, so unique-user location shares may sum above 100%. Unknown events stay in the selected denominator. New countries mean first observed within retained geographic history under the current filters, not first ever. Security/travel detection is intentionally omitted because incomplete coverage and device identities are not reliable enough to support it.

## Local development and validation

Real localhost traffic never turns into a location. To inspect UI interactions, set `GEO_DEVELOPMENT_SAMPLES=true`, keep demo mode enabled, run the development server, and open `/login-geography?sample=true`. These in-memory locations are visibly labeled **Development samples**, never inserted into analytics tables, cannot be saved or exported, require a non-production Node environment, and are rejected outside demo mode. They illustrate city/region/country accuracy. Disable sample mode before inspecting real filters; fixtures are demonstration data, not real login metrics.

MapLibre loads only on the client. Default OpenFreeMap dark/positron styles require network access; configure `NEXT_PUBLIC_GEO_MAP_DARK_STYLE` and `NEXT_PUBLIC_GEO_MAP_LIGHT_STYLE` for your own compatible tile source. Style/renderer failures show a retry message while the table remains usable. The map offers its own light/dark toggle and works independently of the dashboard's current dark-only design.

`npm test` covers proxy trust/spoofing, IPv4/IPv6 exclusions, providers/timeouts/malformed data, asynchronous failure, caching/deduplication, aggregation/filtering/isolation, authorization/privacy, migrations and retention. `npm run test:e2e` covers loading/empty/error states, table-to-map focus, map modes, filters and narrow viewports using deterministic aggregate fixtures. External providers are mocked; no paid/live API is required.

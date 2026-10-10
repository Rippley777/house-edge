# REST API

The dashboard and collector share one base URL, for example `https://analytics.example.com`.

## Authentication

- `/api/collect` authenticates with a scoped project key in the JSON body. This supports browser beacons without custom authorization headers.
- Other analytics and administrative routes require `Authorization: Bearer YOUR_ADMIN_KEY` or the dashboard's signed session cookie when demo mode is disabled.
- Cookie mutations require an Origin matching PUBLIC_URL. Bearer-authenticated server requests do not require an Origin.
- `/api/health` is an unauthenticated database readiness check and exposes no credentials or analytics.

## Collect events

`POST /api/collect`, with `application/json` or `text/plain` containing JSON:

```json
{
  "projectKey": "repo-reaper",
  "key": "he_pk_REPLACE_WITH_YOUR_KEY",
  "events": [
    {
      "id": "8045f284-bd69-443b-b555-663436ec71c2",
      "event": "repository_analyzed",
      "sessionId": "session-123",
      "anonymousId": "visitor-456",
      "userId": "optional-opaque-user-id",
      "timestamp": "2026-09-30T04:32:00.000Z",
      "path": "/dashboard",
      "properties": { "language": "Rust" },
      "durationMs": 1421,
      "version": "1.4.2",
      "deviceType": "desktop",
      "browser": "Chrome",
      "operatingSystem": "macOS"
    }
  ]
}
```

Use the actual current UTC timestamp in your request. The `timestamp` must be within the past seven days and no more than five minutes ahead. Optional fields include referrer, country (legacy server-only two-letter code; browser claims are ignored), and structured JSON properties.

Response: `202 { "accepted": 1, "duplicates": 0 }`. Use the same event ID for retries. Different UUIDs represent different events, even if their other fields match.

| Status | Meaning                                                                                |
| ------ | -------------------------------------------------------------------------------------- |
| 400    | Malformed JSON, event validation, invalid timestamp                                    |
| 401    | Invalid, revoked, inactive, or mismatched project key                                  |
| 403    | Origin not allowed, missing origin for a browser key, or a server key used with Origin |
| 413    | Body larger than 65,536 bytes                                                          |
| 429    | Per-project rate limit; honor Retry-After                                              |
| 503    | Temporary collector/database outage; retry with backoff                                |

The default per-project allowance is 6,000 submitted events per minute, controlled by INGESTION_EVENTS_PER_MINUTE. Retries consume allowance too. `OPTIONS /api/collect` responds only to allowed origins.

## Read analytics

### Shared query parameters

| Parameter           | Meaning                                                                          |
| ------------------- | -------------------------------------------------------------------------------- |
| `from`, `to`        | Inclusive ISO datetime bounds; defaults to the last seven days; maximum 366 days |
| `project`           | Project UUID or `all`                                                            |
| `search`            | Event name, path, session, anonymous visitor, version, or referrer substring     |
| `event`             | Exact event name                                                                 |
| `property`, `value` | Top-level JSON property equality; property uses letters, digits, underscore      |
| `minDuration`       | Strictly greater than this many milliseconds                                     |
| `offset`            | Event pagination offset; pages have 100 rows                                     |
| `interval`          | Retention interval: daily, weekly, monthly                                       |

`GET /api/projects` returns project configuration, never raw keys.

`GET /api/overview` returns current and previous metrics, chart series, project metrics, recent events, deployments, and computed Pulse statements.

`GET /api/data?view=events` returns `{ rows, total?, summary?, extra? }`. Supported views: events, live, sessions, users, features, graveyard, rising, errors, performance, releases, retention, funnels, journeys, relationships, ecosystem, heatmap, anomalies, alerts, saved, settings, keys.

`GET /api/session?project=PROJECT_UUID&session=SESSION_ID&to=ISO_DATE` returns ordered raw events for one project-scoped session.

`GET /api/export?view=events&...` exports the selected page as CSV. Cells are escaped and potential spreadsheet formulas are prefixed safely. This is a page export, not a complete database dump.

## Administrative writes

Use JSON bodies and POST. All UUID references must identify existing records.

| Endpoint                | Body                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `/api/projects`         | `{name, projectKey, domain, origins: ["https://example.com"], environment}`            |
| `/api/project-settings` | `{id, origins: [...], blockedProperties: [...]}`                                       |
| `/api/keys`             | `{projectId, scope: "ingest" \| "server", revokeId?, revokeOnly?}`                     |
| `/api/deployments`      | `{projectId, version, commitSha, environment}`                                         |
| `/api/features`         | `{projectId, name, event}`                                                             |
| `/api/funnels`          | `{name, projectId: UUID \| null, steps: ["page_view", "conversion"], windowHours: 24}` |
| `/api/saved`            | `{name, viewType, filters: {project, from, to, event, ...}}`                           |
| `/api/alerts`           | `{name, projectId: UUID \| null, metric, operator: "gt" \| "lt", threshold, enabled}`  |
| `/api/alert-toggle`     | `{id, enabled: boolean}`                                                               |
| `/api/settings`         | `{retentionDays: 90}` (7–730)                                                          |
| `/api/delete`           | `{id, type: "saved_views" \| "alerts" \| "funnels" \| "features"}`                     |
| `/api/maintenance`      | `{}`; executes retention and alert maintenance                                         |
| `/api/login`            | `{key: ADMIN_KEY}`; sets an HttpOnly session cookie                                    |
| `/api/logout`           | `{}`; clears the session cookie                                                        |

Project creation returns `{ id, projectKey, key }`. Key creation/rotation returns `{ key }`. The raw key is returned once and never stored. Revocation without replacement returns `{ key: null }`. Environments are production, staging, or development. Origins must be exact origins without paths or a trailing slash.

Alert metrics: `error_rate` (%), `p95_latency` (milliseconds), `silence_minutes`, `traffic_drop` (% vs. previous hour), `conversion_drop` (% vs. previous hour). Thresholds are numeric. Alerts need the maintenance job to evaluate them.

### Deployment marker from CI

```sh
curl --fail-with-body -X POST "$HOUSE_EDGE_URL/api/deployments" \
  -H "Authorization: Bearer $HOUSE_EDGE_ADMIN_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"YOUR_PROJECT_UUID","version":"1.4.2","commitSha":"a1b2c3d","environment":"production"}'
```

The request records the current server time. Dashboard comparisons use that marker, not untrusted client claims about the deployment date.

## Login Geography

See [Login Geography](login-geography.md) for the additive versioned login ingestion contract and authenticated `/api/login-geography` aggregate API, filters, privacy and deployment requirements.

## Event Geography

`GET /api/geography` reports all event types by default. `event` matches an exact event name; `scope=logins` limits to canonical login events and `success=success|failure` selects their outcome. Date, project, environment, country/region, measure, threshold, and granularity filters apply to aggregates, summaries, previous-period trends, CSV export (`view=geography`), and saved views. Summary fields include `totalEvents` and `geolocatedEvents`. Read access requires administrator authentication.

All ingestion events accept optional `environment` and server-key-only `sourceIp` outside properties. Browser geography uses trusted transport/ingress; browser IP claims are rejected. Raw IPs never appear in analytics responses. See [Event Geography](geography.md). The legacy login API and contract remain supported.

# Cloudflare visitor geography addition

`POST /api/collect` accepts optional server-only `events[].location` with `version: 1`, `source: "cloudflare"`, ISO `country`, `region`, `regionCode`, `city`, numeric `latitude`/`longitude`, `postalCode`, `timezone`, `colo`, integer `asn`, `networkOrganization`, and transient `ip`. Invalid optional fields are discarded; browser ingestion keys cannot assert this envelope. See [geography](geography.md) for privacy and migration 004.

`GET /api/geography?scope=visits&metric=visits&granularity=city` uses the existing authentication/project/from/to filters. `scope=visits` limits events to page views. `totalEvents` counts those views, `totalVisits` counts distinct sessions and `uniqueUsers` counts unique visitors. Locations include `previousVisits` for comparison. `metric=users` selects unique visitors; existing `events`/`logins` scopes and metrics remain compatible.

`accepted` counts events successfully committed with their projections, not merely parsed payloads. Database failures return 503. Event queries include nullable `received_at`; client-supplied receive times are ignored. `/api/projects` includes `last_event_at`, effective `retention_days`, `retention_scope: "workspace"` and `authorization_scope: "workspace-owner"`. These reflect the existing single-owner/global-retention model.

Overview responses add `traffic` with bounded page/referrer/device/browser page-view breakdowns and new/returning anonymous visitor counts. Errors add active/affected session totals and rate, previous-period metrics, deterministic spike flag, and `extra.series`, `extra.versions`, `extra.browsers`. Error groups are capped at 200; aggregate totals are not capped.

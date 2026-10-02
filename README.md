# HOUSE EDGE ♠

**Know exactly how your software is performing.**

A private analytics and observability command center for your applications. Built with Next.js, React, TypeScript, Tailwind CSS, and Azure SQL. One deployable web service handles both the dashboard and the event collector. SQLite makes local development work without cloud credentials.

## Run locally

Use Node.js 22 (see `.nvmrc`) and npm. The local SQLite path also works on Node.js 20.15; the current Azure SQL driver requires Node.js 22.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open the address printed by Next.js, normally `http://localhost:3000`. If that port is occupied, choose one explicitly:

```sh
npm run dev -- --port 4317
```

Set `PUBLIC_URL` to that exact origin if you change the port. Local development without `.env` also works: the app derives the origin from the request.

For a production server, run `npm run build` once, then `npm start`. The development command above does not require a production build or Azure credentials.

The first database access creates `.data/house-edge.db` and seeds approximately 150,000 events over 90 days for nine projects. Seed data is labeled **Demo workspace** in the UI. Demo mode adds a few synthetic events when the Overview or Live Activity endpoints are read, at most once every 10 seconds. All charts and observations are calculated from the stored events; no observations come from an AI model.

To start an empty, authenticated workspace, set `DEMO_MODE=false`, configure `ADMIN_KEY` and `SESSION_SECRET` with separate random values of at least 32 characters, and choose a new `SQLITE_PATH`. Demo mode is a public local demonstration, not an authorization boundary for private data.

## What works

- Project creation; origin allowlists; browser/server ingestion keys; rotation and revocation; audit logs.
- Validated, batched event collection with deduplication, shared database rate limits, and transactional session/user/rollup projections.
- Browser SDK and script embed: page views, SPA navigation, sessions, identification, custom events, timings, errors, Web Vitals, privacy scrubbing, bounded queues, retries, and exit beacons.
- Node SDK with explicit `flush()` for serverless functions.
- Login Geography with aggregate MapLibre clusters/density, project/date filters, privacy-safe enrichment, retention, and resumable authorized backfill.
- Overview and individual project analytics with date/project filters and previous-period comparisons.
- Event Explorer with event, property equality, duration, route, visitor, and version filters; paginated events; CSV export.
- Live Activity, session timelines, anonymous users, ordered funnels, retention cohorts, and named feature adoption.
- Grouped errors, latency percentiles, deployment markers, and comparisons around releases.
- Data-derived Pulse, feature Graveyard, Rising Features, anomaly baselines, project comparisons, activity heatmaps, historical event snapshots, and interactive project/event relationship maps.
- Saved views, configurable alert rules, incident history, an optional webhook provider, and retention maintenance.
- Keyboard command palette (`⌘K` / `Ctrl+K`), responsive navigation, and an in-app integration guide.

## Connect an application

Create a project from the dashboard and copy its one-time ingestion key. The dashboard generates an integration snippet using the actual project key and collector URL.

```ts
import { houseEdge } from '@house-edge/analytics';

houseEdge.init({
  projectKey: 'repo-reaper',
  key: 'YOUR_BROWSER_INGESTION_KEY',
  endpoint: 'https://analytics.example.com/api/collect',
  version: '1.4.2',
});

houseEdge.track('repository_analyzed', { language: 'Rust', durationMs: 1421 });
houseEdge.identify('opaque-user-id');
houseEdge.timing('github_analysis', 1421);
```

The packages are built locally, not published to npm by this project. Install them from this monorepo, pack them for another application, publish to your own registry, or use the hosted `/house-edge.js` script. See [SDK integration](docs/sdk.md).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build SDK assets and start the dashboard/collector |
| `npm run build` | Build both SDKs and the production Next.js application |
| `npm start` | Run the production build |
| `npm run lint` | Lint TypeScript (existing unused declarations are reported as warnings) |
| `npm run format -- <files>` | Format selected changed files with Prettier |
| `npm run geo:enrich` | Drain a bounded login geography enrichment batch |
| `npm run geo:backfill -- <source.ndjson> [checkpoint.json]` | Resume an authorized historical login/IP export |
| `npm run typecheck` | Check the entire monorepo |
| `npm test` | Backend, privacy, authentication, and analytics regression tests |
| `npm run test:e2e` | Chromium integration tests using a separate SQLite database and port 4318 |
| `npm run db:migrate` | Generate SQL migration artifacts and apply idempotent schema migration |
| `npm run db:seed` | Seed an empty local database; never overwrites existing projects |
| `npm run db:maintain` | Enforce retention, evaluate alerts, retry pending webhook notifications |
| `npm run build:sdk` | Build browser ESM, hosted script, Node ESM, and TypeScript declarations |

Install Chromium once with `npx playwright install chromium` before browser tests.

## Repository

```text
apps/dashboard/          Next.js dashboard and REST route adapters
apps/collector/          Independent collector service logic
packages/sdk-browser/   @house-edge/analytics and script embed
packages/sdk-node/      @house-edge/node
packages/shared/        Event contracts, validation, privacy helpers
packages/database/      Azure SQL/SQLite adapters, repositories, schema, seed
packages/analytics-engine/  Queries, projections, funnels, alerts
migrations/             Reviewable Azure SQL and SQLite migration scripts
scripts/                Migration, seed, SDK build, and maintenance commands
tests/                  Unit/integration tests and Chromium workflows
docs/                   API, SDK, architecture, and deployment guides
```

The dashboard UI components live alongside the application. A separate shared UI package is unnecessary until a second application uses them. The collector is a separate module mounted at `/api/collect`; it does not require a second service to deploy.

## Production

See [Azure deployment](docs/deployment.md), [architecture and metric definitions](docs/architecture.md), [REST API](docs/api.md), and [SDK integration](docs/sdk.md).

The Dockerfile uses a non-root Node.js 22 runtime and Next.js standalone output. No Kubernetes, queue service, search cluster, or separate worker is required. Schedule the maintenance command or its authenticated HTTP equivalent every five minutes.

Azure credentials are server-only. Azure migrations and connection code are included, but a live Azure SQL instance is required to validate your own firewall, identity, database permissions, and deployment. No cloud resources are provisioned automatically.

## Deliberate limits

This is a single-owner initial release. It does not include organizations/RBAC, SSO, session video recording, source-map symbolication, cross-device identity merging, or causal release attribution. Exact scope and query limits are documented in [architecture](docs/architecture.md). Sampled or capped views are labeled in the product. Successful/failed versioned login events can be enriched with approximate network geography; see [Login Geography](docs/login-geography.md) for privacy, proxy trust, providers, and retention.

# Integrating the SDK

The browser SDK is built as dependency-free ESM and a single script bundle. Web Vitals is included in the bundle; the client has no dependency on React, Next.js, the dashboard, Zod, or SQL packages.

## Install from this repository

```sh
npm run build:sdk
npm pack ./packages/sdk-browser
npm pack ./packages/sdk-node
```

Install the resulting tarball in another project, use an npm workspace link, or publish the packages to your own registry. The name `@house-edge/analytics` is an intended package name, not a claim that this implementation has been published publicly.

## Connected workspace projects

The following projects now include the browser SDK, initialization, and `.env.example` settings. Tracking becomes active only after their browser ingestion keys and collector endpoints are configured. Native desktop and CLI sessions are excluded; the browser versions of Tauri projects have an explicit native-runtime guard.

| Application directory | Default House Edge project key | Public environment prefix |
| --- | --- | --- |
| `algebra-game` | `algebra-quest` | `NEXT_PUBLIC_` |
| `readme-roulette` | `readme-roulette` | `NEXT_PUBLIC_` |
| `rippley-labs` | `rippley-labs` | `NEXT_PUBLIC_` |
| `shipwreck` | `shipwreck` | `NEXT_PUBLIC_` |
| `right-to-repair` | `right-to-repair` | `VITE_` |
| `shelf-life` | `shelf-life` | `VITE_` |
| `stacked-deck` | `stacked-deck` | `VITE_` |
| `save-scum/website` | `save-scum-website` | `PUBLIC_` |
| `deck` (browser) | `deck` | `VITE_` |
| `env-reaper` (browser) | `env-reaper` | `VITE_` |
| `pit-boss` (browser demo) | `pit-boss` | `VITE_` |
| `port-authority` (browser preview) | `port-authority` | `VITE_` |
| `sudo-survive` (browser) | `sudo-survive` | `VITE_` |
| `save-scum` (browser demo) | `save-scum` | `VITE_` |
| `repo-reaper` (Django) | `repo-reaper` | None; runtime configuration |
| `plant-journal` (Rust) | `plant-journal` | None; runtime configuration |

For each application, create a project in a non-demo House Edge workspace and configure exact allowed origins (for example `https://your-app.example` and, for a separate development project, `http://localhost:5173`). Set the prefixed `HOUSE_EDGE_KEY` to its one-time **browser** ingestion key and `HOUSE_EDGE_ENDPOINT` to the full `https://your-house-edge.example/api/collect` URL. `HOUSE_EDGE_PROJECT` overrides the default key. Demo project keys are hashed and cannot be recovered; issue a new browser key if connecting an existing project.

For the Next.js, Vite, and Astro applications, these settings are build-time values. Set them in the build/CI environment, rebuild, and redeploy each application. Runtime-only hosting settings do not update an already-built client. Stacked Deck additionally needs `VITE_HOUSE_EDGE_ENDPOINT` at server runtime to configure its CSP. Save Scum's website derives its CSP from the endpoint rendered during the build.

Repo Reaper and Plant Journal instead serve the versioned script from `static/vendor/` and read unprefixed `HOUSE_EDGE_PROJECT`, `HOUSE_EDGE_KEY`, and `HOUSE_EDGE_ENDPOINT` at runtime. They also require `HOUSE_EDGE_ENABLED=true`. Restart their servers after configuring these values; their CSP includes only the configured collector origin. Plant Journal requires exporting environment variables explicitly, as it does not load `.env` automatically.

Missing/invalid endpoints or missing keys leave tracking disabled. Development also requires the prefixed `HOUSE_EDGE_TRACK_DEVELOPMENT=true`; production builds enable tracking when configured. All integrations respect Do Not Track. Verify `session_start` and `page_view` in Live Activity after opening a configured site and waiting approximately five seconds, then navigate to another page to verify its path. Pages show aggregate visits, not recordings or arbitrary click capture. Add explicit `houseEdge.track('event_name', { ... })` calls for product-specific actions.

Each JavaScript app uses its checked-in `vendor/house-edge-analytics-0.1.1.tgz`, with no dependency on a sibling checkout. To update the SDK, bump `packages/sdk-browser/package.json`, rebuild and pack it, copy the new tarball into each consumer's `vendor/`, then install that local tarball with the application's package manager and commit its manifest/lockfile. Do not replace an existing version's tarball in place: lockfiles pin its integrity. For Django/Rust, copy the rebuilt `apps/dashboard/public/house-edge.js` into a versioned `static/vendor/` file alongside the SDK license, update the template/asset route, and rebuild or collect static files as appropriate.

## Browser

```ts
import { houseEdge } from '@house-edge/analytics';

houseEdge.init({
  projectKey: 'repo-reaper',
  key: 'YOUR_BROWSER_INGESTION_KEY',
  endpoint: 'https://analytics.example.com/api/collect',
  version: '1.4.2',
  autoTrack: true,
  respectDoNotTrack: true,
  blockedProperties: ['customer_name', 'internal_secret'],
  flushIntervalMs: 5000,
});

houseEdge.track('repository_analyzed', { language: 'Rust', durationMs: 1421 });
houseEdge.identify('opaque-account-id');
houseEdge.timing('github_analysis', 1421);
houseEdge.error(new Error('Repository unavailable'));
houseEdge.page(); // Optional manual page view; avoid duplicating automatic tracking.
await houseEdge.flush();
houseEdge.reset(); // On logout: clear identity and start a fresh anonymous session.
houseEdge.destroy(); // Remove SDK-installed listeners, cancel timers, and discard the queue.
```

`init()` is safe to import during SSR and does nothing without a browser. Initialize it once in the client entry point. `createHouseEdge()` creates a separate client if an application intentionally needs more than one project.

The SDK stores a random project-scoped anonymous ID in localStorage and session metadata in sessionStorage. A session expires after 30 minutes without a tracked event. Blocked browser storage falls back to in-memory IDs. It records session_start/session_end events and infers session length from event timestamps; it does not use a continuous activity heartbeat.

Automatic context: sanitized path and referrer, hostname, explicitly allowlisted UTM parameters, screen dimensions, browser, OS, device type, version, Web Vitals (LCP, CLS, INP, TTFB), and page-load timing. SPA pushState/replaceState/popstate navigation is tracked when the pathname changes. Hash-only navigation and query-only changes do not produce duplicate page views.

For hash routers or named views, supply `getPath: () => '/canonical-view'`. The SDK then observes hash changes as well as history navigation and uses the canonical path on every event. Return only known route names; queries and fragments are stripped from the result. Shelf Life uses this option to map its known hash views to paths such as `/collection`. Back/forward navigation and paired `popstate`/`hashchange` events count each path transition once.

CLS is a unitless measurement. Other timing metrics use milliseconds. Some Web Vitals are finalized when the page is hidden; a new page may not immediately have samples for every metric. INP needs a user interaction.

### Next.js client initialization

```tsx
'use client';

import { useEffect } from 'react';
import { houseEdge } from '@house-edge/analytics';

export function Analytics() {
  useEffect(() => {
    // Let React finish its development Strict Mode effect replay before starting.
    const timer = setTimeout(() => {
      houseEdge.init({
        projectKey: 'repo-reaper',
        key: process.env.NEXT_PUBLIC_HOUSE_EDGE_KEY!,
        endpoint: 'https://analytics.example.com/api/collect',
        version: process.env.NEXT_PUBLIC_APP_VERSION,
      });
    }, 0);
    return () => { clearTimeout(timer); houseEdge.destroy(); };
  }, []);
  return null;
}
```

Add this component once to the root layout. Browser ingestion keys are public by design and are restricted to configured project origins. ADMIN_KEY, server ingestion keys, and SQL credentials must never use NEXT_PUBLIC variables.

## Script installation

```html
<script async
  src="https://analytics.example.com/house-edge.js"
  data-project="repo-reaper"
  data-key="YOUR_BROWSER_INGESTION_KEY"
  data-version="1.4.2">
</script>
```

The collector defaults to `/api/collect` on the script host. Override it with `data-endpoint` when needed. Both project and key attributes are required. The script exports `window.houseEdge`; use optional chaining before the async script finishes loading.

```js
window.houseEdge?.track('export_completed', { format: 'markdown' });
```

Calls made before the script loads are not buffered by a separate global stub. Initialize the ESM client first when a critical application event must be queued reliably.

## Node.js

Create a **server** ingestion key in Projects & API Keys. Node requests omit Origin; a browser-scoped key will be rejected.

```ts
import { createHouseEdge } from '@house-edge/node';

const analytics = createHouseEdge({
  projectKey: 'repo-reaper',
  key: process.env.HOUSE_EDGE_SERVER_KEY!,
  endpoint: 'https://analytics.example.com/api/collect',
  version: '1.4.2',
});

analytics.track('api_request', { route: '/api/analyze' }, {
  sessionId: 'opaque-session-id',
  anonymousId: 'opaque-visitor-id',
  userId: 'optional-opaque-user-id',
});
analytics.timing('github_analysis', 1421);
await analytics.flush();
```

The Node client buffers up to 200 events and does not install process-wide listeners or background timers. Call `flush()` at the end of each request/serverless invocation, or from a timer in a long-running server. Failed batches stay queued until a subsequent flush. Without explicit context, events use the SDK instance ID for the anonymous visitor and session; supply context for per-user analytics.

## Privacy and consent

Sensitive property names are removed recursively from objects and arrays in both SDK and collector, including casing/underscore variants. Defaults cover passwords, tokens, authorization, secrets, cookies, email, phone, credit card, and SSN. Additional blocked names can be configured on each project and in the SDK. Browser URL query strings and fragments are stripped; only the named UTM parameters are retained explicitly.

The SDK does not read form controls, keystrokes, authorization headers, browser cookies, or DOM content. Application-provided custom values and exception messages are still application data: use opaque IDs and keep personal information out of free-text values and stack traces. Property-name redaction is not a general-purpose PII detector.

`respectDoNotTrack` defaults to true. If your application needs a consent flow, delay initialization until consent is granted or initialize with `enabled: false` and reinitialize after consent. Call `destroy()` when consent is withdrawn; delete `he_anon_PROJECT_KEY` and `he_session_PROJECT_KEY` storage if your application's deletion policy requires it.

## Delivery guarantees

The browser client uses asynchronous fetch, a memory-only bounded queue, 8-second request timeouts, and exponential retry up to a 60-second delay. A permanent 4xx response drops the invalid batch; 429, server errors, and network outages retry. Retried events retain their UUIDs. Beacon delivery is best effort and cannot confirm ingestion.

Analytics must not throw into or block the host application. This is intentionally not a financial transaction ledger: bounded queues and tab shutdown can lose events. Use a durable server-side transactional outbox if a future application needs guaranteed business-event delivery.

## Server login events

The Node SDK accepts optional `login` context for versioned authentication events. Source IP must come from verified server transport/proxy context and is accepted only with a server ingestion key. See [the complete contract and privacy behavior](login-geography.md).

## Geography on every event

Browser auto-tracking and custom events are eligible automatically when collector ingress and providers are configured. Optional `environment` in browser `init` applies to all its events; otherwise House Edge uses the project environment.

The Node SDK accepts top-level `sourceIp` and `environment` in each event context, including `track`, `timing`, and `error`. Use only a verified originating client IP and a server ingestion key. Without an explicit client source, server transport is never attributed to users.

```ts
analytics.track('checkout_completed', { amount: 42 }, { sessionId, anonymousId, sourceIp: trustedClientIp, environment: 'production' });
await analytics.flush();
```

See [Event Geography](geography.md) for migration 003, proxy trust, providers, and privacy. Legacy login context is unchanged.

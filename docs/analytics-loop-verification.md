# Analytics loop verification — 2026-10-08

## Production outcome: blocked, not accepted

The primary acceptance criterion is **not met**. House Edge cannot persist production visits while its existing Azure SQL database is paused after exhausting its October free allowance. A read-only authenticated SQL connection returned `ELOGIN` explicitly stating that the free allowance renews **2026-11-01 00:00 UTC**. Enabling immediate access would incur additional charges; no billing setting, capacity, credentials, production code, or infrastructure was changed.

The live House Edge `/api/health` returned HTTP 503. Authenticated `/api/projects` returned an analytics/database error. Consequently registered project UUIDs, live event IDs, accepted/persisted counts, migrations and dashboard confirmation are unavailable. No duplicate production project was created and no key was rotated.

## Real browser and deployed asset inspection

- Opened `https://rippleylabs.com/` in the in-app browser and followed the Downloads link to `/downloads`. These are actual production visit attempts, **not confirmed ingested visits**.
- Attempted Stacked Deck in the same browser. Navigation timed out; no successful browser/dashboard assertion is claimed.
- Public HTTP/JavaScript inspection at **2026-10-08T20:50:23.011Z** returned 200 for both websites. Both loaded bundles contained House Edge anonymous/session tracking, public ingestion keys and the expected collector hostname. No server ingestion key pattern was found in the loaded bundles. This is a targeted check, not a proof that every possible secret is absent.
- Stacked Deck's response had Cloudflare headers and a CSP that permits House Edge. The website response had no Cloudflare proxy indication. Neither proves the account-side Worker/transform configuration.
- Local saved public configuration uses `stacked-deck` and the existing website identifier `rippley-labs`, both targeting the Azure House Edge `/api/collect`. Values of credentials were neither printed nor copied into this report.
- The website's existing Cloudflare Worker and origin fallback are implemented in its checkout, but several files are pre-existing staged work. Saved production settings still select the direct collector. Deployment/route activation and trusted production geographic enrichment remain unverified. Missing geography must remain unknown.

## Isolated verification

`tests/e2e/analytics-loop.spec.ts` uses a real Chromium browser and built SDK against the actual HTTP collector, SQLite repository, aggregation APIs and project dashboards. Only the minimal host page is a harness; it is **not the production website or Stacked Deck UI**. It creates two fresh development projects and checks:

- Initial visit, SPA navigation, query-only navigation and refresh: three page views in one session per project.
- Server receive timestamps and absence of a synthetic secret query value.
- Two marked synthetic errors grouped into one issue and one affected session.
- Retry of a persisted UUID returns zero new accepts and one duplicate.
- A mismatched project/key returns 401.
- Event IDs never appear in the other project's query.
- Each project's dashboard shows its own routes and traffic breakdowns.

The test writes `verification.json` and dashboard PNGs under its `test-results/analytics-loop-…` directory. The report contains UTC timestamps, development project IDs, event IDs, receive timestamps, paths, collector responses and dashboard checks. It excludes keys, raw IPs and visitor/session identifiers. Geography in localhost browser traffic is unknown; no synthetic country is attributed to these visits.

Separate existing Cloudflare tests send explicitly synthetic server-trusted metadata and verify storage, origin spoofing rejection, country fallback, three-distinct-visitor thresholds, filters, deduplication and rendered map markers. Those fixtures prove code paths, not real visitor geolocation.

## Deployment and remaining production work

1. Restore database availability through its existing free-allowance reset or an explicitly approved billing decision. Retain the current project records/keys.
2. Apply additive migration 005 after 001–004 using migration credentials; historical receive timestamps remain null. Deploy House Edge using its existing Azure workflow. The revised health check requires all five schema versions and required columns.
3. Review and deploy the consumer SDK 0.1.2 changes through their existing workflows. Both consumers now emit a non-secret diagnostic for missing public configuration, reject server keys in the browser, and receive the build commit as version metadata. Local consumer builds use synthetic keys/endpoints for verification.
4. Inspect the actual Cloudflare route/zone before activating the existing website relay. Keep server credentials only at the edge/origin. Direct Azure requests must not acquire geography from arbitrary CF/XFF headers.
5. Repeat both real production browser visits and inspect collector requests/responses. Confirm persistence and project dashboards with exact event IDs, paths, timestamps, known/unknown geography, synthetic error grouping and cross-project absence. This remains necessary even after all local tests pass.

Authorization and retention remain the application's existing **single-owner workspace** model. The owner can access all its projects; browser/server ingestion keys cannot read dashboards. `/api/projects` now reports last event time and explicit inherited workspace retention/authorization scope. This change does not add multi-user RBAC or independently configurable project retention.

## Validation results

- House Edge: 66 backend tests passed; complete 19-test Chromium suite passed, plus the final evidence-capture test passed after its response-body workaround. Type checking and production build passed. ESLint has zero errors and 67 existing unused-declaration warnings.
- Stacked Deck: type check and production build passed; 157 tests passed, with its Azure SQL integration test skipped because it requires an explicitly configured live test database.
- Rippley Labs: type check and production build passed; all 7 unit tests and both existing analytics browser tests passed. The website browser tests use an intercepted collector response; they verify consumer behavior, not persistence.
- Migration 005 was generated and applied to an isolated SQLite database. Azure SQL migration execution remains blocked by the production quota; SQLite does not prove SQL Server execution.
- The final local loop evidence captures HTTP 202 from the browser's keepalive requests. Playwright cannot finish reading their bodies in this environment, so that limitation is explicit in the JSON. Separate API duplicate retries record the exact `{accepted: 0, duplicates: 1}` response; authenticated event reads and dashboard assertions independently establish persistence.

Older stored free-text errors are scrubbed again on error/event/session reads and exports. Historical error fingerprints are preserved; new normalized groups can therefore appear separately from pre-upgrade groups until old data expires. No historical events were rewritten.

## Saved evidence

- [Local event IDs, receive timestamps, HTTP status and isolation evidence](../artifacts/analytics-loop/2026-10-08/verification.json)
- [Stacked Deck project browser harness dashboard](../artifacts/analytics-loop/2026-10-08/stacked-deck-local.png)
- [Rippley Labs project browser harness dashboard](../artifacts/analytics-loop/2026-10-08/rippley-labs-local.png)
- [Read-only production bundle inspection](../artifacts/analytics-loop/2026-10-08/production-bundle-inspection.json)

# Login Geography compatibility

Geography now covers **all events**. Use [Event Geography](geography.md) for setup, trusted ingress, server source IPs, providers, retention, migrations, and backfill. Open `/geography` for the full map, with optional event-name and login-outcome filters.

Existing `/login-geography` URLs, saved views, exports, and `GET /api/login-geography` continue to work. This endpoint retains its successful-login default; `success=failure` selects failed logins and `success=all` includes both. It always restricts to canonical login events, even if a different `scope` is supplied. `totalLogins` and `geolocatedLogins` remain available.

Existing versioned login names and optional `login` metadata remain supported. The legacy `login.sourceIp` field is server-key-only. New server events can use top-level `sourceIp` on any event type. If both IP fields are present, they must agree.

Apply migration 003 after 002 before deploying the expanded collector. `GEOGRAPHY_ENABLED` takes precedence over the legacy `LOGIN_GEOGRAPHY_ENABLED` setting. Non-production events can now be enriched too; set `GEO_PRODUCTION_ONLY=true` to preserve a production-only policy. Local/private addresses remain excluded.

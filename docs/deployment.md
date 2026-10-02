# Deploying House Edge to Azure

Use one Azure App Service for Linux or Azure Container Apps service and one Azure SQL database. A single low-volume instance is sufficient initially. Choose pricing and compute tiers based on your region, traffic, and acceptable cold-start behavior; no paid resources are created by the repository.

## 1. Prepare Azure SQL

Create an Azure SQL logical server and database, enable TLS, and configure the firewall/private endpoint for the actual application and migration runner. Prefer a managed identity for the web application; use separate migration credentials with DDL permissions.

The `mssql` connection adapter supports SQL authentication and `azure-active-directory-default` managed identity. The current driver requires Node.js 22. Follow Microsoft's [Node.js/mssql Azure SQL connection guide](https://learn.microsoft.com/en-us/azure/azure-sql/database/azure-sql-javascript-mssql-quickstart) when configuring identity and database access.

For SQL authentication, configure server-side environment variables:

```dotenv
DATABASE_PROVIDER=azure
AZURE_SQL_SERVER=YOUR_SERVER.database.windows.net
AZURE_SQL_DATABASE=house-edge
AZURE_SQL_AUTH=password
AZURE_SQL_USER=YOUR_DATABASE_USER
AZURE_SQL_PASSWORD=YOUR_DATABASE_PASSWORD
DEMO_MODE=false
```

For managed identity:

```dotenv
DATABASE_PROVIDER=azure
AZURE_SQL_SERVER=YOUR_SERVER.database.windows.net
AZURE_SQL_DATABASE=house-edge
AZURE_SQL_AUTH=managed-identity
# Leave empty for a system-assigned identity.
AZURE_SQL_CLIENT_ID=YOUR_USER_ASSIGNED_IDENTITY_CLIENT_ID
DEMO_MODE=false
```

Give the runtime principal SELECT, INSERT, UPDATE, and DELETE access to the House Edge schema. Do not grant schema changes or SQL server administration to the running collector. Configure App Service's identity in the database with an Entra administrator using your organization's documented identity provisioning process.

## 2. Apply the schema

From a Node.js 22 environment with the migration credentials and an allowed SQL network route:

```sh
npm ci
npm run db:migrate
```

Alternatively, review and execute `migrations/001_initial.azure.sql` through your Azure SQL migration process. The script is idempotent and transactional. The application does not create Azure tables on startup; missing migrations fail the readiness check.

Do not seed your production database. Seeding Azure is intentionally blocked unless `ALLOW_DEMO_SEED=true`, and the seed command only works on an empty project table.

## 3. Configure administrative access

Generate two independent secrets and store them in App Service settings or Key Vault references:

```sh
openssl rand -hex 32
openssl rand -hex 32
```

```dotenv
ADMIN_KEY=FIRST_GENERATED_SECRET
SESSION_SECRET=SECOND_GENERATED_SECRET
PUBLIC_URL=https://analytics.example.com
DATA_RETENTION_DAYS=90
INGESTION_EVENTS_PER_MINUTE=6000
```

PUBLIC_URL must exactly match the browser-facing HTTPS origin. It controls mutation origin validation and Secure session cookies. Configure the custom domain and TLS certificate on the host before using that URL. Rotate both administrative secrets to invalidate existing API access and sessions.

Optional notifications:

```dotenv
ALERT_WEBHOOK_URL=https://YOUR_NOTIFICATION_ADAPTER.example/house-edge
```

The provider receives JSON containing an incident ID, name, message, and measured value. If your notification service expects its own schema, implement the small `NotificationProvider` interface or run an adapter. House Edge does not assume Slack/Teams/email payload compatibility.

## 4. Build and run

### Container

```sh
docker build -t house-edge:latest .
docker run --rm -p 8080:8080 --env-file .env.production.local house-edge:latest
```

The image runs as an unprivileged user on port 8080. Point Azure's container port setting at 8080. `/api/health` returns 200 only when a database query succeeds. Secrets are injected at runtime, not copied into the image. `.dockerignore` excludes local data and environment secrets.

Push the image to your chosen registry and deploy it to Azure App Service or Container Apps using your existing deployment process. Set a single minimum/maximum instance initially; increase only when measured load calls for it. Azure SQL-backed rate limits work across application instances.

### Direct Node hosting

```sh
npm ci
npm run build
npm start
```

For a smaller artifact, deploy Next.js standalone output from `apps/dashboard/.next/standalone`. Copy `apps/dashboard/public` and `.next/static` to the corresponding dashboard directories in that artifact, then run `node apps/dashboard/server.js` from the artifact root. This is the approach in the Dockerfile. See [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

## 5. Schedule maintenance

Every five minutes, execute one of:

```sh
npm run db:maintain
```

or from a trusted server-side scheduler:

```sh
curl --fail-with-body -X POST "$HOUSE_EDGE_URL/api/maintenance" \
  -H "Authorization: Bearer $HOUSE_EDGE_ADMIN_KEY" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

The CLI needs database credentials; the HTTP endpoint needs only the admin key. Do not embed the administrative key in a browser or public cron URL. Run one scheduler initially. Alerts and retention do not evaluate automatically without this job. The Alerts page includes a manual maintenance action for testing.

## 6. Connect a real application

1. Sign in to House Edge using ADMIN_KEY.
2. Create the project and set its exact allowed origin(s).
3. Copy the one-time browser ingestion key.
4. Install the SDK or paste the generated script tag.
5. Visit the application and verify its page_view/session_start events in Live Activity.
6. Add named features, funnels, alert thresholds, and CI deployment markers.

## Operations

- Set up SQL backups and verify a restore before depending on this service.
- Monitor the readiness endpoint and Azure SQL storage/compute consumption.
- Keep application instances and database region close together.
- Keep an App Service instance warm if initial SQL connection latency or an auto-paused SQL tier affects your requirements.
- For larger event volume, move daily recomputation to a background job or incremental counter updates, and consider retention delete batches. The current initial version optimizes simplicity and dashboard reads for low-volume personal projects.
- Large percentile/network reads have documented caps. Aggregate or partition raw data before relying on them for very high volume.
- SQL credentials, identity tokens, and administrative secrets never belong in NEXT_PUBLIC variables.

The local test suite verifies the shared repository and queries against SQLite, plus authentication, collection, privacy, SDK behavior, and Chromium workflows. Live Azure SQL connectivity, SQL Server query execution, managed identity, Docker image runtime, and actual Azure deployment must be verified in your environment; they cannot be proven by SQLite tests alone.

## Login Geography

Apply migration 002 before deploying the new collector. Configure dedicated `GEO_QUEUE_KEY` and `GEO_IP_HASH_SALT` secrets for optional IP enrichment, mount a local MMDB or use an HTTPS adapter, and schedule maintenance to enforce the one-hour temporary-input lifetime and geographic retention. Forwarded headers stay untrusted until ingress is explicitly configured. See [Login Geography operations](login-geography.md).

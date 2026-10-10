import 'dotenv/config';
import { ingestionSchemaStatements } from '../packages/database/src/ingestion-schema';
import { connect, migrate, schemaStatements } from '@house-edge/database';
import fs from 'node:fs/promises';
import {
  geographySchemaStatements,
  eventGeographySchemaStatements,
  cloudflareGeographySchemaStatements,
} from '@house-edge/database/geography-schema';
await fs.mkdir('migrations', { recursive: true });
await fs.writeFile(
  'migrations/001_initial.azure.sql',
  '-- House Edge initial Azure SQL schema. Timestamps are canonical UTC ISO-8601 strings.\nSET XACT_ABORT ON;\nBEGIN TRANSACTION;\n' +
    schemaStatements('azure').join('\n\n') +
    '\nCOMMIT TRANSACTION;\n',
);
await fs.writeFile('migrations/001_initial.sqlite.sql', schemaStatements('sqlite').join('\n\n') + '\n');
for (const dialect of ['sqlite', 'azure'] as const)
  await fs.writeFile(
    `migrations/002_login_geography.${dialect}.sql`,
    '-- Apply after migration 001. SQLite DDL is applied once; Azure DDL is idempotent.\n' +
      (dialect === 'azure' ? 'SET XACT_ABORT ON;\nBEGIN TRANSACTION;\n' : 'BEGIN IMMEDIATE;\n') +
      geographySchemaStatements(dialect).join('\n\n') +
      `\nINSERT INTO schema_migrations (version, applied_at) SELECT 2, ${dialect === 'azure' ? "CONVERT(VARCHAR(23), SYSUTCDATETIME(), 126) + 'Z'" : "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"} WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 2);\nCOMMIT;\n`,
  );
for (const dialect of ['sqlite', 'azure'] as const)
  await fs.writeFile(
    `migrations/003_event_geography.${dialect}.sql`,
    '-- Apply after migration 002. SQLite applies once; Azure DDL is idempotent.\n' +
      (dialect === 'azure' ? 'SET XACT_ABORT ON;\nBEGIN TRANSACTION;\n' : 'BEGIN IMMEDIATE;\n') +
      eventGeographySchemaStatements(dialect).join(dialect === 'azure' ? '\nGO\n' : '\n\n') +
      `\nINSERT INTO schema_migrations (version, applied_at) SELECT 3, ${dialect === 'azure' ? "CONVERT(VARCHAR(23), SYSUTCDATETIME(), 126) + 'Z'" : "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"} WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 3);\nCOMMIT;\n`,
  );
for (const dialect of ['sqlite', 'azure'] as const)
  await fs.writeFile(
    `migrations/004_cloudflare_geography.${dialect}.sql`,
    '-- Apply after migration 003. Additive nullable columns; no event rewrite.\n' +
      (dialect === 'azure' ? 'SET XACT_ABORT ON;\nBEGIN TRANSACTION;\n' : 'BEGIN IMMEDIATE;\n') +
      cloudflareGeographySchemaStatements(dialect).join(dialect === 'azure' ? '\nGO\n' : '\n\n') +
      `\nINSERT INTO schema_migrations (version, applied_at) SELECT 4, ${dialect === 'azure' ? "CONVERT(VARCHAR(23), SYSUTCDATETIME(), 126) + 'Z'" : "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"} WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 4);\nCOMMIT;\n`,
  );
for (const dialect of ['sqlite', 'azure'] as const)
  await fs.writeFile(
    `migrations/005_ingestion_received.${dialect}.sql`,
    '-- Apply after migration 004. Historical receive time is unknown.\n' +
      (dialect === 'azure' ? 'SET XACT_ABORT ON;\nBEGIN TRANSACTION;\n' : 'BEGIN IMMEDIATE;\n') +
      ingestionSchemaStatements(dialect).join('\n') +
      `\nINSERT INTO schema_migrations (version, applied_at) SELECT 5, ${dialect === 'azure' ? "CONVERT(VARCHAR(23), SYSUTCDATETIME(), 126) + 'Z'" : "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"} WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 5);\nCOMMIT;\n`,
  );
const db = await connect();
try {
  await migrate(db);
  console.log(`Migrations applied (${db.dialect}).`);
} finally {
  await db.close();
}

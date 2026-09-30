import 'dotenv/config';
import { connect, migrate, schemaStatements } from '@house-edge/database';
import fs from 'node:fs/promises';
await fs.mkdir('migrations', { recursive: true });
await fs.writeFile('migrations/001_initial.azure.sql', '-- House Edge initial Azure SQL schema. Timestamps are canonical UTC ISO-8601 strings.\nSET XACT_ABORT ON;\nBEGIN TRANSACTION;\n' + schemaStatements('azure').join('\n\n') + '\nCOMMIT TRANSACTION;\n');
await fs.writeFile('migrations/001_initial.sqlite.sql', schemaStatements('sqlite').join('\n\n') + '\n');
const db = await connect();
try { await migrate(db); console.log(`Migrations applied (${db.dialect}).`); } finally { await db.close(); }

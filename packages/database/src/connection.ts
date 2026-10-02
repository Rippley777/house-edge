import path from 'node:path';
import fs from 'node:fs';
import { config as loadEnv } from 'dotenv';
import type Sqlite from 'better-sqlite3';
import type * as MSSQL from 'mssql';
import { schemaStatements } from './schema';
import { geographySchemaStatements, eventGeographySchemaStatements } from './geography-schema';

export type Params = Record<string, string | number | null>;
export interface Connection {
  dialect: 'sqlite' | 'azure';
  query<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T[]>;
  execute(sql: string, params?: Params): Promise<number>;
  transaction<T>(fn: (tx: Connection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function rootPath() {
  let p = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(p, 'packages/database'))) return p;
    p = path.dirname(p);
  }
  return process.cwd();
}
export function limitQuery(db: Connection, sql: string, limit: number) {
  const n = Math.max(1, Math.min(100000, Math.floor(limit)));
  return db.dialect === 'sqlite'
    ? `${sql} LIMIT ${n}`
    : sql.replace(/^SELECT (DISTINCT )?/i, (_, distinct: string | undefined) => `SELECT ${distinct || ''}TOP (${n}) `);
}
loadEnv({ path: path.join(rootPath(), '.env'), quiet: true });
export function datePart(db: Connection, column: string, length = 10) {
  return db.dialect === 'sqlite' ? `SUBSTR(${column}, 1, ${length})` : `LEFT(${column}, ${length})`;
}

export async function connect(options?: { provider?: 'sqlite' | 'azure'; filename?: string }): Promise<Connection> {
  loadEnv({ path: path.join(rootPath(), '.env'), quiet: true });
  const provider = options?.provider || (process.env.DATABASE_PROVIDER === 'azure' ? 'azure' : 'sqlite');
  if (provider === 'sqlite') {
    const { default: Database } = await import('better-sqlite3');
    const file = options?.filename || path.resolve(rootPath(), process.env.SQLITE_PATH || '.data/house-edge.db');
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    const raw: Sqlite.Database = new Database(file);
    raw.pragma('journal_mode = WAL');
    raw.pragma('foreign_keys = ON');
    raw.pragma('busy_timeout = 5000');
    let queue: Promise<unknown> = Promise.resolve();
    const connection: Connection = {
      dialect: 'sqlite',
      async query<T>(sql: string, params: Params = {}) { return raw.prepare(sql).all(params) as T[]; },
      async execute(sql, params = {}) { return raw.prepare(sql).run(params).changes; },
      transaction<T>(fn: (tx: Connection) => Promise<T>): Promise<T> {
        const run = queue.then(async () => {
          raw.exec('BEGIN IMMEDIATE');
          try { const result = await fn(connection); raw.exec('COMMIT'); return result; }
          catch (e) { raw.exec('ROLLBACK'); throw e; }
        });
        queue = run.catch(() => {});
        return run;
      },
      async close() { await queue; raw.close(); },
    };
    return connection;
  }
  const sqlModule = await import('mssql');
  const sql = sqlModule.default ?? sqlModule;
  if (!process.env.AZURE_SQL_SERVER || !process.env.AZURE_SQL_DATABASE) throw new Error('Azure SQL server and database must be configured.');
  const config: MSSQL.config = {
    server: process.env.AZURE_SQL_SERVER,
    database: process.env.AZURE_SQL_DATABASE,
    options: { encrypt: true, trustServerCertificate: false, enableArithAbort: true },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 30000,
    ...(process.env.AZURE_SQL_AUTH === 'managed-identity'
      ? { authentication: { type: 'azure-active-directory-default' as const, options: { clientId: process.env.AZURE_SQL_CLIENT_ID || undefined } } }
      : { user: process.env.AZURE_SQL_USER, password: process.env.AZURE_SQL_PASSWORD }),
  };
  const pool = await new sql.ConnectionPool(config).connect();
  const adapt = (tx?: MSSQL.Transaction): Connection => {
    const request = (params: Params) => {
      const req = tx ? new sql.Request(tx) : pool.request();
      for (const [key, value] of Object.entries(params)) {
        req.input(key, typeof value === 'number' ? sql.Float : sql.NVarChar(sql.MAX), value);
      }
      return req;
    };
    return {
      dialect: 'azure',
      async query<T>(statement: string, params = {}) { return (await request(params).query<T>(statement)).recordset; },
      async execute(statement, params = {}) { return (await request(params).query(statement)).rowsAffected.reduce((a, b) => a + b, 0); },
      async transaction<T>(fn: (tx: Connection) => Promise<T>) {
        const transaction = new sql.Transaction(pool);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try { const result = await fn(adapt(transaction)); await transaction.commit(); return result; }
        catch (e) { await transaction.rollback().catch(() => {}); throw e; }
      },
      async close() { await pool.close(); },
    };
  };
  return adapt();
}

export async function migrate(db: Connection) {
  await db.transaction(async tx => {
    for (const statement of schemaStatements(db.dialect)) await tx.execute(statement);
    const applied = await tx.query('SELECT version FROM schema_migrations WHERE version = 1');
    if (!applied.length) await tx.execute('INSERT INTO schema_migrations (version, applied_at) VALUES (1, @now)', { now: new Date().toISOString() });
    if (!(await tx.query('SELECT version FROM schema_migrations WHERE version = 2')).length) {
      for (const statement of geographySchemaStatements(db.dialect)) await tx.execute(statement);
      await tx.execute('INSERT INTO schema_migrations (version, applied_at) VALUES (2, @now)', { now: new Date().toISOString() });
    }
    if (!(await tx.query('SELECT version FROM schema_migrations WHERE version = 3')).length) {
      for (const statement of eventGeographySchemaStatements(db.dialect)) await tx.execute(statement);
      await tx.execute('INSERT INTO schema_migrations (version, applied_at) VALUES (3, @now)', { now: new Date().toISOString() });
    }
  });
}

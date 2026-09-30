import { connect, migrate, type Connection } from './connection';
export * from './connection';
export * from './repository';
export * from './schema';

const globalDb = globalThis as unknown as { houseEdgeDb?: Promise<Connection> };
export const isDemo = () => process.env.DEMO_MODE !== 'false' && process.env.DATABASE_PROVIDER !== 'azure' && !process.env.ADMIN_KEY;
export async function getDb(): Promise<Connection> {
  if (!globalDb.houseEdgeDb) {
    globalDb.houseEdgeDb = (async () => {
      const db = await connect();
      if (db.dialect === 'sqlite') {
        await migrate(db);
        if (isDemo()) {
          const [{ n }] = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM projects');
          if (!n) { const { seed } = await import('./seed'); await seed(db); }
        }
      }
      return db;
    })().catch(e => { globalDb.houseEdgeDb = undefined; throw e; });
  }
  return globalDb.houseEdgeDb;
}

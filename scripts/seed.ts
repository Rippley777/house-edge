import 'dotenv/config';
import { connect, migrate } from '@house-edge/database';
import { seed } from '../packages/database/src/seed';
if (process.env.DATABASE_PROVIDER === 'azure' && process.env.ALLOW_DEMO_SEED !== 'true') throw new Error('Set ALLOW_DEMO_SEED=true to seed an empty Azure demo database intentionally.');
const db = await connect();
try { await migrate(db); console.log(await seed(db)); console.log(await db.query('SELECT COUNT(*) AS events FROM events')); } finally { await db.close(); }

import 'dotenv/config';
import { connect } from '@house-edge/database';
import { maintain } from '../packages/analytics-engine/src/maintenance';
const db = await connect();
try { console.log(await maintain(db)); } finally { await db.close(); }

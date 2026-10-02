import 'dotenv/config';
import { connect } from '@house-edge/database';
import { processGeographyJobs } from '@house-edge/database/geolocation';
const db = await connect();
try {
  console.log(await processGeographyJobs(db, 100));
} finally {
  await db.close();
}

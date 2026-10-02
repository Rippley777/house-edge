import { collect, collectorOptions } from '@house-edge/collector';
import { after } from 'next/server';
import { getDb } from '@house-edge/database';
import { processGeographyJobs } from '@house-edge/database/geolocation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const response = await collect(request);
    if (response.status === 202 && process.env.GEO_AFTER_RESPONSE_ENABLED !== 'false') after(async () => { try { await processGeographyJobs(await getDb()); } catch { console.warn('Login geography worker unavailable; maintenance will retry'); } });
    return response;
  }
  catch (error) { console.error('Collector unavailable', error instanceof Error ? error.name : 'Error'); return Response.json({ error: 'Collector temporarily unavailable; retry later' }, { status: 503, headers: { 'Retry-After': '10' } }); }
}
export async function OPTIONS(request: Request) {
  try { return await collectorOptions(request); }
  catch { return new Response(null, { status: 503 }); }
}

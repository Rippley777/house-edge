import { collect, collectorOptions } from '@house-edge/collector';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return await collect(request); }
  catch (error) { console.error('Collector unavailable', error instanceof Error ? error.name : 'Error'); return Response.json({ error: 'Collector temporarily unavailable; retry later' }, { status: 503, headers: { 'Retry-After': '10' } }); }
}
export async function OPTIONS(request: Request) {
  try { return await collectorOptions(request); }
  catch { return new Response(null, { status: 503 }); }
}

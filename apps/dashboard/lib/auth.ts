import { createHmac, timingSafeEqual } from 'node:crypto';
import { isDemo } from '@house-edge/database';

const COOKIE = 'house_edge_session';
export { COOKIE };
export function safeEqual(a: string, b: string) { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
function sign(payload: string) { return createHmac('sha256', process.env.SESSION_SECRET || '').update(payload).digest('hex'); }
export function createSession() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  const payload = Buffer.from(JSON.stringify({ expires: Date.now() + 12 * 3600000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
export function verifySession(token?: string) {
  if (!token || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) return false;
  const [payload, signature, extra] = token.split('.');
  if (extra || !signature || !safeEqual(sign(payload), signature)) return false;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString()); return typeof data.expires === 'number' && data.expires > Date.now(); } catch { return false; }
}
export function authorized(request: Request) {
  if (isDemo()) return true;
  if (!process.env.ADMIN_KEY || process.env.ADMIN_KEY.length < 32) return false;
  const bearer = request.headers.get('authorization');
  if (bearer?.startsWith('Bearer ') && safeEqual(bearer.slice(7), process.env.ADMIN_KEY)) return true;
  const token = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return verifySession(token);
}
export function trustedMutation(request: Request) {
  const bearer = request.headers.get('authorization');
  if (bearer?.startsWith('Bearer ') && process.env.ADMIN_KEY && safeEqual(bearer.slice(7), process.env.ADMIN_KEY)) return true;
  const origin = request.headers.get('origin');
  const configured = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).origin : new URL(request.url).origin;
  return origin === configured;
}

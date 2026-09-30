import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorized, createSession, trustedMutation, verifySession } from '../apps/dashboard/lib/auth';
test('production requires an admin key or an untampered signed session', () => {
  process.env.DEMO_MODE = 'false'; process.env.ADMIN_KEY = 'a'.repeat(64); process.env.SESSION_SECRET = 's'.repeat(64);
  const session = createSession(); assert.equal(verifySession(session), true); assert.equal(verifySession(session + 'x'), false);
  assert.equal(authorized(new Request('https://analytics.example/api/overview')), false);
  assert.equal(authorized(new Request('https://analytics.example/api/overview', { headers: { authorization: `Bearer ${process.env.ADMIN_KEY}` } })), true);
  assert.equal(authorized(new Request('https://analytics.example/api/overview', { headers: { cookie: `house_edge_session=${session}` } })), true);
});
test('mutations reject cross-site and origin-less cookie requests', () => {
  process.env.PUBLIC_URL = 'https://analytics.example';
  assert.equal(trustedMutation(new Request('https://analytics.example/api/projects', { headers: { origin: 'https://evil.example' } })), false);
  assert.equal(trustedMutation(new Request('https://analytics.example/api/projects')), false);
  assert.equal(trustedMutation(new Request('https://analytics.example/api/projects', { headers: { origin: 'https://analytics.example' } })), true);
});

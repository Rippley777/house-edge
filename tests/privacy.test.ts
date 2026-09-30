import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchSchema, cleanUrl, sanitizeProperties } from '@house-edge/shared';
import { redact } from '../packages/sdk-browser/src/index';

test('SDK and collector remove nested secrets, including arrays and key variants', () => {
  const input = { language: 'Rust', Password: 'secret', accessToken: 'secret', nested: { authorization: 'Bearer secret', safe: 42 }, items: [{ token: 'secret', count: 2 }], customer_name: 'private' };
  const expected = { language: 'Rust', nested: { safe: 42 }, items: [{ count: 2 }] };
  assert.deepEqual(sanitizeProperties(input, ['customer_name']), expected);
  assert.deepEqual(redact(input, ['customer_name']), expected);
});
test('URL sanitization removes queries and fragments without inventing direct referrers', () => {
  assert.equal(cleanUrl('https://example.com/path?token=private#secret'), 'https://example.com/path');
  assert.equal(cleanUrl('/dashboard?password=private#secret'), '/dashboard');
  assert.equal(cleanUrl(''), '');
});
test('privacy scrubber bounds depth and text size and handles circular objects', () => {
  const value: Record<string, unknown> = { text: 'a'.repeat(5000) }; value.self = value;
  const cleaned = sanitizeProperties(value);
  assert.equal((cleaned.text as string).length, 2048);
  assert.doesNotThrow(() => JSON.stringify(cleaned));
  assert.doesNotThrow(() => JSON.stringify(redact(value)));
});
test('collector rejects invalid payloads, event IDs, and oversized batches', () => {
  assert.equal(batchSchema.safeParse({ projectKey: 'p', key: 'x'.repeat(25), events: [] }).success, false);
  assert.equal(batchSchema.safeParse({ projectKey: 'p', key: 'x'.repeat(25), events: Array.from({ length: 101 }, () => ({})) }).success, false);
});

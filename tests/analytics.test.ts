import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderedFunnel, percentile, previousFilters } from '@house-edge/engine';

function event(name: string, seconds: number, session = 's1', project = 'p1') { return { event_name: name, timestamp: new Date(Date.UTC(2026, 8, 29, 12, 0, seconds)).toISOString(), session_id: session, project_id: project }; }
test('funnels count ordered sessions and ignore reverse-order events', () => {
  const result = orderedFunnel([event('finish', 0), event('start', 1), event('middle', 4), event('finish', 10), event('start', 15), event('start', 1, 's2'), event('finish', 2, 's2')], ['start', 'middle', 'finish'], 1);
  assert.deepEqual(result.counts, [2, 1, 1]); assert.equal(result.timeToConvert, 9000);
});
test('funnels do not merge sessions across projects or count steps outside the window', () => {
  const result = orderedFunnel([event('start', 0), event('finish', 5000), event('finish', 10, 's1', 'other')], ['start', 'finish'], 1);
  assert.deepEqual(result.counts, [1, 0]);
});
test('repeated event steps require separate occurrences', () => {
  assert.deepEqual(orderedFunnel([event('page_view', 0)], ['page_view', 'page_view'], 1).counts, [1, 0]);
});
test('percentiles interpolate correctly and handle empty distributions', () => {
  assert.equal(percentile([], .95), 0); assert.equal(percentile([100], .95), 100); assert.equal(percentile([100, 200, 300, 400], .5), 250); assert.equal(percentile([100, 200, 300, 400], .95), 385);
});
test('comparison window has the same duration and no overlap', () => {
  const range = { from: '2026-09-20T00:00:00.000Z', to: '2026-09-26T23:59:59.999Z' };
  const previous = previousFilters(range);
  assert.equal(previous.from, '2026-09-13T00:00:00.000Z'); assert.equal(previous.to, '2026-09-19T23:59:59.999Z');
});

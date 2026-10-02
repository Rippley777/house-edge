import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitQuery, type Connection } from '@house-edge/database';

test('Azure limits distinct geography results with DISTINCT before TOP', () => {
  const db = { dialect: 'azure' } as Connection;
  assert.equal(
    limitQuery(db, 'SELECT DISTINCT country_code FROM events ORDER BY country_code', 10000),
    'SELECT DISTINCT TOP (10000) country_code FROM events ORDER BY country_code',
  );
  assert.equal(limitQuery(db, 'SELECT id FROM events', 10), 'SELECT TOP (10) id FROM events');
});

test('SQLite retains its trailing limit for distinct results', () => {
  const db = { dialect: 'sqlite' } as Connection;
  assert.equal(
    limitQuery(db, 'SELECT DISTINCT country_code FROM events', 10),
    'SELECT DISTINCT country_code FROM events LIMIT 10',
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRICE_HEADER, parsePriceCsv, serializePriceCsv } from '../src/core/priceCsv.js';

function csv(rows) {
  return [PRICE_HEADER, ...rows].join('\n') + '\n';
}

test('rejects a wrong header', () => {
  assert.throws(() => parsePriceCsv('foo,bar\n1,2\n'), /kopregel/i);
});

test('rejects an empty file', () => {
  assert.throws(() => parsePriceCsv(''), /leeg/i);
});

test('requires an ISO 8601 timestamp with explicit offset', () => {
  assert.throws(() => parsePriceCsv(csv(['2025-06-01T00:00:00,0.20'])), /iso 8601 met offset/i);
});

test('rejects a non-numeric price', () => {
  assert.throws(() => parsePriceCsv(csv(['2025-06-01T00:00:00+02:00,abc'])), /numeriek/i);
});

test('parses valid rows, including negative prices (never rejected or clamped)', () => {
  const prices = parsePriceCsv(
    csv(['2025-06-01T00:00:00+02:00,0.245', '2025-06-01T01:00:00+02:00,-0.032'])
  );
  assert.deepEqual(prices, [
    { timestamp: '2025-06-01T00:00:00+02:00', priceEurKwh: 0.245 },
    { timestamp: '2025-06-01T01:00:00+02:00', priceEurKwh: -0.032 }
  ]);
});

test('serializePriceCsv round-trips through parsePriceCsv', () => {
  const original = [
    { timestamp: '2025-06-01T00:00:00+02:00', priceEurKwh: 0.245 },
    { timestamp: '2025-06-01T01:00:00+02:00', priceEurKwh: -0.032 }
  ];
  assert.deepEqual(parsePriceCsv(serializePriceCsv(original)), original);
});

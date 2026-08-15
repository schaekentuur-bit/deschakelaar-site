import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPriceDataAvailability } from '../src/core/priceDataAvailability.js';

function summary(first, last) {
  return { firstTimestamp: first, lastTimestamp: last };
}

test('fully available when all needed months are published', () => {
  const result = checkPriceDataAvailability(
    summary('2026-07-20T00:15:00+02:00', '2026-07-26T23:45:00+02:00'),
    { months: ['2026-06', '2026-07', '2026-08'] }
  );
  assert.deepEqual(result.neededMonths, ['2026-07']);
  assert.deepEqual(result.missingMonths, []);
  assert.equal(result.isFullyAvailable, true);
});

test('lists all needed months when the period spans multiple months', () => {
  const result = checkPriceDataAvailability(
    summary('2026-06-25T00:00:00+02:00', '2026-08-05T00:00:00+02:00'),
    { months: ['2026-06', '2026-07', '2026-08'] }
  );
  assert.deepEqual(result.neededMonths, ['2026-06', '2026-07', '2026-08']);
  assert.equal(result.isFullyAvailable, true);
});

test('spans a year boundary correctly (december -> january)', () => {
  const result = checkPriceDataAvailability(
    summary('2025-12-20T00:00:00+01:00', '2026-01-10T00:00:00+01:00'),
    { months: ['2025-12', '2026-01'] }
  );
  assert.deepEqual(result.neededMonths, ['2025-12', '2026-01']);
  assert.equal(result.isFullyAvailable, true);
});

test('reports the period as entirely before the available data', () => {
  const result = checkPriceDataAvailability(
    summary('2024-01-01T00:00:00+01:00', '2024-01-07T00:00:00+01:00'),
    { months: ['2026-06', '2026-07', '2026-08'] }
  );
  assert.equal(result.isFullyAvailable, false);
  assert.deepEqual(result.missingMonths, ['2024-01']);
  assert.equal(result.earliestAvailable, '2026-06');
});

test('reports the period as entirely after the available data', () => {
  const result = checkPriceDataAvailability(
    summary('2030-01-01T00:00:00+01:00', '2030-01-07T00:00:00+01:00'),
    { months: ['2026-06', '2026-07', '2026-08'] }
  );
  assert.equal(result.isFullyAvailable, false);
  assert.deepEqual(result.missingMonths, ['2030-01']);
  assert.equal(result.latestAvailable, '2026-08');
});

test('reports a partial gap inside the period (e.g. a missing month file)', () => {
  const result = checkPriceDataAvailability(
    summary('2026-06-25T00:00:00+02:00', '2026-08-05T00:00:00+02:00'),
    { months: ['2026-06', '2026-08'] } // 2026-07 ontbreekt
  );
  assert.equal(result.isFullyAvailable, false);
  assert.deepEqual(result.missingMonths, ['2026-07']);
});

test('handles an empty manifest (no data published yet)', () => {
  const result = checkPriceDataAvailability(summary('2026-07-20T00:00:00+02:00', '2026-07-21T00:00:00+02:00'), {
    months: []
  });
  assert.equal(result.isFullyAvailable, false);
  assert.equal(result.earliestAvailable, null);
  assert.equal(result.latestAvailable, null);
});

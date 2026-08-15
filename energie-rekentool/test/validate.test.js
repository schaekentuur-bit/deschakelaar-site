import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCoverageSummary } from '../src/core/validate.js';

function iv(timestamp, importKwh, exportKwh) {
  return { timestamp, importKwh, exportKwh };
}

test('throws on an empty dataset', () => {
  assert.throws(() => computeCoverageSummary([]), /geen intervallen/i);
});

test('computes totals, counts and coverage with no gaps', () => {
  const intervals = [
    iv('2025-06-01T00:15:00+02:00', 1, 0),
    iv('2025-06-01T00:30:00+02:00', 0, 0.5),
    iv('2025-06-01T00:45:00+02:00', 2, 0)
  ];
  const summary = computeCoverageSummary(intervals);
  assert.equal(summary.intervalMinutes, 15);
  assert.equal(summary.actualCount, 3);
  assert.equal(summary.expectedCount, 3);
  assert.equal(summary.missingCount, 0);
  assert.equal(summary.missingPercentage, 0);
  assert.equal(summary.totalImportKwh, 3);
  assert.equal(summary.totalExportKwh, 0.5);
  assert.equal(summary.firstTimestamp, '2025-06-01T00:15:00+02:00');
  assert.equal(summary.lastTimestamp, '2025-06-01T00:45:00+02:00');
});

test('counts a gap in the middle of the period', () => {
  // Kwartierraster (duidelijke modus), maar het interval om 00:45 ontbreekt.
  const intervals = [
    iv('2025-06-01T00:15:00+02:00', 1, 0),
    iv('2025-06-01T00:30:00+02:00', 1, 0),
    iv('2025-06-01T01:00:00+02:00', 1, 0),
    iv('2025-06-01T01:15:00+02:00', 1, 0),
    iv('2025-06-01T01:30:00+02:00', 1, 0)
  ];
  const summary = computeCoverageSummary(intervals);
  assert.equal(summary.intervalMinutes, 15);
  assert.equal(summary.expectedCount, 6);
  assert.equal(summary.actualCount, 5);
  assert.equal(summary.missingCount, 1);
  assert.ok(Math.abs(summary.missingPercentage - (1 / 6) * 100) < 1e-9);
});

test('sorts unordered input before computing coverage', () => {
  const intervals = [
    iv('2025-06-01T00:45:00+02:00', 1, 0),
    iv('2025-06-01T00:15:00+02:00', 1, 0),
    iv('2025-06-01T00:30:00+02:00', 1, 0)
  ];
  const summary = computeCoverageSummary(intervals);
  assert.equal(summary.firstTimestamp, '2025-06-01T00:15:00+02:00');
  assert.equal(summary.lastTimestamp, '2025-06-01T00:45:00+02:00');
});

test('throws on duplicate timestamps for the same interval', () => {
  const intervals = [iv('2025-06-01T00:15:00+02:00', 1, 0), iv('2025-06-01T00:15:00+02:00', 1, 0)];
  assert.throws(() => computeCoverageSummary(intervals), /dubbele timestamps/i);
});

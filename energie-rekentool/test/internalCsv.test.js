import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTERNAL_HEADER, parseInternalCsv, serializeInternalCsv } from '../src/core/internalCsv.js';

function csv(rows) {
  return [INTERNAL_HEADER, ...rows].join('\n') + '\n';
}

test('rejects a wrong header', () => {
  assert.throws(() => parseInternalCsv('foo,bar\n1,2\n'), /kopregel/i);
});

test('parses valid rows', () => {
  const { intervals, warnings } = parseInternalCsv(
    csv(['2025-06-01T00:15:00+02:00,0.6,0', '2025-06-01T00:30:00+02:00,0,0.2'])
  );
  assert.equal(warnings.length, 0);
  assert.deepEqual(intervals, [
    { timestamp: '2025-06-01T00:15:00+02:00', importKwh: 0.6, exportKwh: 0 },
    { timestamp: '2025-06-01T00:30:00+02:00', importKwh: 0, exportKwh: 0.2 }
  ]);
});

test('requires an ISO 8601 timestamp with explicit offset', () => {
  assert.throws(() => parseInternalCsv(csv(['2025-06-01T00:15:00,0.6,0'])), /iso 8601 met offset/i);
});

test('rejects negative values as corrupt', () => {
  assert.throws(() => parseInternalCsv(csv(['2025-06-01T00:15:00+02:00,-0.1,0'])), /corrupt bestand/i);
});

test('keeps import and export as-is when both are > 0 (valid with solar)', () => {
  const { intervals, warnings } = parseInternalCsv(csv(['2025-06-01T00:15:00+02:00,0.5,0.8']));
  assert.equal(warnings.length, 0);
  assert.equal(intervals[0].importKwh, 0.5);
  assert.equal(intervals[0].exportKwh, 0.8);
});

test('serializeInternalCsv round-trips through parseInternalCsv', () => {
  const original = [
    { timestamp: '2025-06-01T00:15:00+02:00', importKwh: 0.6, exportKwh: 0 },
    { timestamp: '2025-06-01T00:30:00+02:00', importKwh: 0, exportKwh: 0.2 }
  ];
  const { intervals } = parseInternalCsv(serializeInternalCsv(original));
  assert.deepEqual(intervals, original);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOMEWIZARD_HEADER, parseHomeWizardCsv, toIntervalReadings } from '../src/core/homewizardCsv.js';

function csv(rows) {
  return [HOMEWIZARD_HEADER, ...rows].join('\n') + '\n';
}

test('rejects a wrong header', () => {
  assert.throws(() => parseHomeWizardCsv('foo,bar\n1,2\n'), /kopregel/i);
});

test('rejects an empty file', () => {
  assert.throws(() => parseHomeWizardCsv(''), /leeg/i);
});

test('rejects fewer than two rows (no interval derivable)', () => {
  assert.throws(() => parseHomeWizardCsv(csv(['2025-06-01 00:00,1.0,0,0,0,0,0,0'])), /te weinig/i);
});

test('rejects a malformed row (wrong column count)', () => {
  assert.throws(() => parseHomeWizardCsv(csv(['2025-06-01 00:00,1.0,0,0,0,0,0'])), /8 kolommen/i);
});

test('rejects a non-numeric value', () => {
  assert.throws(() => parseHomeWizardCsv(csv(['2025-06-01 00:00,abc,0,0,0,0,0,0'])), /ongeldige numerieke waarde/i);
});

test('first row is a baseline; N rows yield N-1 intervals, T1+T2 summed', () => {
  const rows = parseHomeWizardCsv(
    csv([
      '2025-06-01 00:00,100.000,10.000,5.000,1.000,0,0,0',
      // import-only interval: T1 +0.3, T2 +0.2, export unchanged
      '2025-06-01 00:15,100.300,10.200,5.000,1.000,50,60,40',
      // export-only interval: export T1 +0.1, T2 +0.1, import unchanged
      '2025-06-01 00:30,100.300,10.200,5.100,1.100,55,58,42'
    ])
  );
  const { intervals, warnings } = toIntervalReadings(rows);
  assert.equal(intervals.length, 2);
  assert.equal(warnings.length, 0);

  assert.ok(Math.abs(intervals[0].importKwh - 0.5) < 1e-9);
  assert.equal(intervals[0].exportKwh, 0);

  assert.equal(intervals[1].importKwh, 0);
  assert.ok(Math.abs(intervals[1].exportKwh - 0.2) < 1e-9);
});

test('timestamps are converted to Europe/Amsterdam ISO with offset, start-of-interval', () => {
  const rows = parseHomeWizardCsv(
    csv(['2025-06-01 00:00,100.000,0,0,0,0,0,0', '2025-06-01 00:15,100.500,0,0,0,50,60,40'])
  );
  const { intervals } = toIntervalReadings(rows);
  assert.equal(intervals[0].timestamp, '2025-06-01T00:15:00+02:00');
});

test('a decreasing meter reading fails hard with a clear message', () => {
  const rows = parseHomeWizardCsv(
    csv(['2025-06-01 00:00,100.000,0,0,0,0,0,0', '2025-06-01 00:15,99.500,0,0,0,0,0,0'])
  );
  assert.throws(() => toIntervalReadings(rows), /corrupt bestand.*dalende meterstand/i);
});

test('import and export both > 0 in the same interval are kept as-is, not netted (valid with solar)', () => {
  const rows = parseHomeWizardCsv(
    csv([
      '2025-06-01 00:00,100.000,0,5.000,0,0,0,0',
      // stroomrichting slaat binnen dit kwartier om: beide tellers lopen op
      '2025-06-01 00:15,100.500,0,5.800,0,0,0,0'
    ])
  );
  const { intervals, warnings } = toIntervalReadings(rows);
  assert.equal(warnings.length, 0);
  assert.ok(Math.abs(intervals[0].importKwh - 0.5) < 1e-9);
  assert.ok(Math.abs(intervals[0].exportKwh - 0.8) < 1e-9);
});

test('phase power is kept alongside intervals, unused but preserved (can be negative)', () => {
  const rows = parseHomeWizardCsv(
    csv(['2025-06-01 00:00,100.000,0,0,0,0,0,0', '2025-06-01 00:15,100.500,0,0.200,0,-120,80,-40'])
  );
  const { phasePower } = toIntervalReadings(rows);
  assert.deepEqual(phasePower[0], {
    timestamp: '2025-06-01T00:15:00+02:00',
    l1MaxW: -120,
    l2MaxW: 80,
    l3MaxW: -40
  });
});

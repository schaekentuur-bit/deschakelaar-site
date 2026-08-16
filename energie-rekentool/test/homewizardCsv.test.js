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

test('empty kWh fields (dongle offline) are treated as missing, not as a meter reading of 0', () => {
  const rows = parseHomeWizardCsv(
    csv([
      '2025-06-01 00:00,100.000,10.000,5.000,1.000,0,0,0',
      // meerdere opeenvolgende, volledig lege rijen: een gat, geen 0-meting
      '2025-06-01 00:15,,,,,,,',
      '2025-06-01 00:30,,,,,,,',
      '2025-06-01 00:45,,,,,,,',
      // meterstanden lopen na het gat gewoon door vanaf hun oude niveau
      '2025-06-01 01:00,101.000,10.500,5.200,1.000,10,20,30'
    ])
  );

  const { intervals, phasePower, warnings } = toIntervalReadings(rows);

  // Geen enkel interval mag over of vanuit een lege rij berekend zijn: van de
  // 4 mogelijke intervallen (00:15, 00:30, 00:45, 01:00) blijft er geen over,
  // want elk grenst aan minstens één lege rij.
  assert.equal(intervals.length, 0);
  assert.equal(phasePower.length, 0);
  assert.equal(warnings.length, 0);
});

test('a gap of empty rows does not trigger the corrupt-file (descending reading) check, and is reported as a gap by computeCoverageSummary', async () => {
  const { computeCoverageSummary } = await import('../src/core/validate.js');
  const rows = parseHomeWizardCsv(
    csv([
      '2025-06-01 00:00,100.000,0,0,0,0,0,0', // baseline, geen interval
      '2025-06-01 00:15,100.300,0,0,0,0,0,0', // normaal interval vóór het gat
      '2025-06-01 00:30,100.600,0,0,0,0,0,0', // nog een normaal interval (15 min na de vorige)
      // dongle offline: 00:45 t/m 01:30 (4 kwartieren) volledig leeg
      '2025-06-01 00:45,,,,,,,',
      '2025-06-01 01:00,,,,,,,',
      '2025-06-01 01:15,,,,,,,',
      '2025-06-01 01:30,,,,,,,',
      // hervat vanaf een fors hogere, maar wel degelijk stijgende meterstand
      '2025-06-01 01:45,105.000,0,0,0,0,0,0', // eerste rij ná het gat: grenst nog aan de lege 01:30, dus zelf niet berekenbaar
      '2025-06-01 02:00,105.300,0,0,0,0,0,0' // normaal interval, 15 min na 01:45
    ])
  );

  // Geen "corrupt bestand"-fout: het parseren zelf mag niet meer stuklopen op dit gat,
  // ook al ligt de meterstand na het gat (105.000) fors boven de laatste bekende (100.600).
  const { intervals } = toIntervalReadings(rows);
  assert.equal(intervals.length, 3); // 00:15, 00:30 en 02:00 zijn berekenbaar; 01:45 grenst aan een lege rij

  const summary = computeCoverageSummary(intervals);
  assert.equal(summary.expectedCount, 8); // 00:15 t/m 02:00 in kwartieren
  assert.equal(summary.actualCount, 3);
  assert.equal(summary.missingCount, 5); // het gat (00:45 t/m 01:30) + het onberekenbare randinterval 01:45
});

test('a file that ends with an empty block is flagged as ending in a gap, not as an active fault', () => {
  const rows = parseHomeWizardCsv(
    csv([
      '2025-06-01 00:00,100.000,0,0,0,0,0,0',
      '2025-06-01 00:15,100.100,0,0,0,0,0,0',
      '2025-06-01 00:30,100.200,0,0,0,0,0,0',
      '2025-06-01 00:45,100.300,0,0,0,0,0,0',
      '2025-06-01 01:00,100.400,0,0,0,0,0,0',
      '2025-06-01 01:15,100.500,0,0,0,0,0,0',
      '2025-06-01 01:30,100.600,0,0,0,0,0,0',
      '2025-06-01 01:45,100.700,0,0,0,0,0,0',
      '2025-06-01 02:00,100.800,0,0,0,0,0,0',
      '2025-06-01 02:15,100.900,0,0,0,0,0,0',
      // export stopt hier abrupt: de dongle was blijkbaar nog offline op het
      // moment dat deze export werd gegenereerd (niet gesimuleerd als "actieve
      // storing nu", puur als "dit bestand eindigt met een gat")
      '2025-06-01 02:30,,,,,,,',
      '2025-06-01 02:45,,,,,,,',
      '2025-06-01 03:00,,,,,,,'
    ])
  );
  const { warnings } = toIntervalReadings(rows);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /dit bestand eindigt met een gat in de meting/i);
  assert.match(warnings[0], /leeg vanaf 2025-06-01 02:30/);
  assert.match(warnings[0], /controleer of dit de gewenste periode dekt/i);
  // Geen suggestie van een lopende/actieve storing op het moment van gebruik.
  assert.doesNotMatch(warnings[0], /storing|offline/i);
});

test('a normal, fully populated file does not trigger a false trailing-gap warning', () => {
  const rows = parseHomeWizardCsv(
    csv(
      Array.from({ length: 40 }, (_, i) => {
        const hh = String(Math.floor(i / 4)).padStart(2, '0');
        const mm = String((i % 4) * 15).padStart(2, '0');
        return `2025-06-01 ${hh}:${mm},${(100 + i * 0.1).toFixed(3)},0,0,0,0,0,0`;
      })
    )
  );
  const { intervals, warnings } = toIntervalReadings(rows);
  assert.equal(intervals.length, 39);
  assert.equal(warnings.length, 0);
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

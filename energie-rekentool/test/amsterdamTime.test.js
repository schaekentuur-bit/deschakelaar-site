import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localAmsterdamWallTimeToIso,
  localAmsterdamWallTimesToIso,
  formatAmsterdamWallTime,
  utcMsToAmsterdamIso,
  detectIntervalMs
} from '../src/core/amsterdamTime.js';

test('winter (CET, +01:00)', () => {
  assert.equal(localAmsterdamWallTimeToIso('2025-01-15 12:00'), '2025-01-15T12:00:00+01:00');
});

test('summer (CEST, +02:00)', () => {
  assert.equal(localAmsterdamWallTimeToIso('2025-06-15 12:00'), '2025-06-15T12:00:00+02:00');
});

test('accepts space or T separator', () => {
  assert.equal(
    localAmsterdamWallTimeToIso('2025-06-15 12:00'),
    localAmsterdamWallTimeToIso('2025-06-15T12:00')
  );
});

test('offset flips on either side of the DST boundary (last Sunday of March 2025 = 30th)', () => {
  assert.equal(localAmsterdamWallTimeToIso('2025-03-30 01:00'), '2025-03-30T01:00:00+01:00');
  assert.equal(localAmsterdamWallTimeToIso('2025-03-30 04:00'), '2025-03-30T04:00:00+02:00');
});

test('rejects unparseable wall time', () => {
  assert.throws(() => localAmsterdamWallTimeToIso('not-a-date'));
});

test('formatAmsterdamWallTime round-trips a known instant', () => {
  const iso = localAmsterdamWallTimeToIso('2025-06-15 12:00');
  const ms = Date.parse(iso);
  assert.equal(formatAmsterdamWallTime(ms), '2025-06-15 12:00');
});

test('detectIntervalMs finds the modal (most common) delta, ignoring a leading gap', () => {
  const base = Date.UTC(2025, 5, 1, 0, 0);
  const fifteenMin = 15 * 60000;
  // Gat van 2 uur aan het begin, daarna consistente kwartierstappen.
  const timestamps = [base, base + 8 * fifteenMin, base + 9 * fifteenMin, base + 10 * fifteenMin, base + 11 * fifteenMin];
  assert.equal(detectIntervalMs(timestamps), fifteenMin);
});

test('detectIntervalMs throws with fewer than two timestamps', () => {
  assert.throws(() => detectIntervalMs([Date.now()]));
});

test('localAmsterdamWallTimesToIso disambiguates the repeated autumn DST hour by sequence order', () => {
  // Nacht van zaterdag 25 op zondag 26 oktober 2025: klok gaat om 03:00 CEST
  // terug naar 02:00 CET. De labels "02:00".."02:45" komen dus twee keer voor.
  const labels = [
    '2025-10-26 01:30',
    '2025-10-26 01:45',
    '2025-10-26 02:00', // 1e keer: nog CEST (+02:00)
    '2025-10-26 02:15',
    '2025-10-26 02:30',
    '2025-10-26 02:45',
    '2025-10-26 02:00', // 2e keer: alweer CET (+01:00)
    '2025-10-26 02:15',
    '2025-10-26 02:30',
    '2025-10-26 02:45',
    '2025-10-26 03:00'
  ];
  const isos = localAmsterdamWallTimesToIso(labels);

  // Strikt oplopend, geen twee labels resolven naar hetzelfde instant.
  for (let i = 1; i < isos.length; i++) {
    assert.ok(Date.parse(isos[i]) > Date.parse(isos[i - 1]), `${isos[i - 1]} -> ${isos[i]} moet strikt oplopen`);
  }

  assert.equal(isos[2], '2025-10-26T02:00:00+02:00');
  assert.equal(isos[6], '2025-10-26T02:00:00+01:00');
  // Precies 15 minuten tussen elk paar, dus ook tussen het laatste CEST- en
  // eerste CET-kwartier (02:45 CEST -> 02:00 CET).
  assert.equal(Date.parse(isos[6]) - Date.parse(isos[5]), 15 * 60000);
  // In totaal 1 uur (4 kwartieren) langer dan een normale nacht.
  assert.equal(Date.parse(isos[10]) - Date.parse(isos[0]), (11 - 1) * 15 * 60000);
});

test('utcMsToAmsterdamIso converts a real UTC instant unambiguously across the autumn DST boundary', () => {
  // Transitie-instant is 2025-10-26T01:00:00Z: 03:00 CEST -> 02:00 CET.
  assert.equal(utcMsToAmsterdamIso(Date.parse('2025-10-26T00:59:00Z')), '2025-10-26T02:59:00+02:00');
  assert.equal(utcMsToAmsterdamIso(Date.parse('2025-10-26T01:00:00Z')), '2025-10-26T02:00:00+01:00');
});

test('localAmsterdamWallTimesToIso leaves an unambiguous sequence unchanged', () => {
  const labels = ['2025-06-01 00:00', '2025-06-01 00:15', '2025-06-01 00:30'];
  assert.deepEqual(localAmsterdamWallTimesToIso(labels), labels.map(localAmsterdamWallTimeToIso));
});

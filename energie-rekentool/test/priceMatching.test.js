import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchIntervalsToPrices } from '../src/core/priceMatching.js';

function iv(timestamp, importKwh = 1, exportKwh = 0) {
  return { timestamp, importKwh, exportKwh };
}
function price(timestamp, priceEurKwh) {
  return { timestamp, priceEurKwh };
}

test('throws with no intervals', () => {
  assert.throws(() => matchIntervalsToPrices([], [price('2025-06-01T00:00:00+02:00', 0.2)]), /geen verbruiksintervallen/i);
});

test('throws with fewer than two price points', () => {
  assert.throws(
    () => matchIntervalsToPrices([iv('2025-06-01T00:15:00+02:00')], [price('2025-06-01T00:00:00+02:00', 0.2)]),
    /prijsintervalduur/i
  );
});

test('1-op-1 matching when both are quarter-hourly', () => {
  const intervals = [iv('2025-06-01T00:15:00+02:00'), iv('2025-06-01T00:30:00+02:00')];
  const prices = [
    price('2025-06-01T00:00:00+02:00', 0.10),
    price('2025-06-01T00:15:00+02:00', 0.20),
    price('2025-06-01T00:30:00+02:00', 0.30)
  ];
  const { matched, consumptionIntervalMinutes, priceIntervalMinutes } = matchIntervalsToPrices(intervals, prices);
  assert.equal(consumptionIntervalMinutes, 15);
  assert.equal(priceIntervalMinutes, 15);
  assert.equal(matched[0].priceEurKwh, 0.20);
  assert.equal(matched[1].priceEurKwh, 0.30);
});

test('4 kwartieren delen dezelfde uurprijs (de bekende beperking)', () => {
  const intervals = [
    iv('2025-06-01T00:15:00+02:00'),
    iv('2025-06-01T00:30:00+02:00'),
    iv('2025-06-01T00:45:00+02:00'),
    iv('2025-06-01T01:00:00+02:00')
  ];
  const prices = [
    price('2025-06-01T00:00:00+02:00', 0.10), // uur 00:00-01:00
    price('2025-06-01T01:00:00+02:00', 0.20) // uur 01:00-02:00
  ];
  const { matched, priceIntervalMinutes } = matchIntervalsToPrices(intervals, prices);
  assert.equal(priceIntervalMinutes, 60);
  assert.equal(matched[0].priceEurKwh, 0.10);
  assert.equal(matched[1].priceEurKwh, 0.10);
  assert.equal(matched[2].priceEurKwh, 0.10);
  assert.equal(matched[3].priceEurKwh, 0.20);
});

test('negative prices are matched through unchanged, never clamped', () => {
  const intervals = [iv('2025-06-01T12:15:00+02:00'), iv('2025-06-01T13:15:00+02:00')];
  const prices = [price('2025-06-01T12:00:00+02:00', -0.045), price('2025-06-01T13:00:00+02:00', -0.012)];
  const { matched } = matchIntervalsToPrices(intervals, prices);
  assert.equal(matched[0].priceEurKwh, -0.045);
  assert.equal(matched[1].priceEurKwh, -0.012);
});

test('an interval with no matching price bucket gets priceEurKwh: null', () => {
  const intervals = [iv('2025-06-01T00:15:00+02:00'), iv('2025-06-01T03:15:00+02:00')];
  const prices = [price('2025-06-01T00:00:00+02:00', 0.10), price('2025-06-01T01:00:00+02:00', 0.20)];
  const { matched } = matchIntervalsToPrices(intervals, prices);
  assert.equal(matched[0].priceEurKwh, 0.10);
  assert.equal(matched[1].priceEurKwh, null);
});

test('works across a DST boundary (bucket lookup is absolute-time based, not label based)', () => {
  // Najaarsovergang 2025: lokaal label "02:15" komt twee keer voor (CEST en
  // CET), maar dat zijn twee echt verschillende UTC-instanten en dus twee
  // verschillende prijs-emmers.
  const intervals = [
    iv('2025-10-26T02:15:00+02:00'), // 1e keer (CEST) -> UTC 00:15
    iv('2025-10-26T02:15:00+01:00') // 2e keer (CET)  -> UTC 01:15
  ];
  const prices = [
    price('2025-10-26T00:00:00+02:00', 0.10), // UTC 2025-10-25T22:00Z
    price('2025-10-26T01:00:00+02:00', 0.20), // UTC 2025-10-25T23:00Z
    price('2025-10-26T02:00:00+02:00', 0.30), // UTC 2025-10-26T00:00Z (CEST, 1e "02:00"-emmer)
    price('2025-10-26T02:00:00+01:00', 0.40), // UTC 2025-10-26T01:00Z (CET, 2e "02:00"-emmer)
    price('2025-10-26T03:00:00+01:00', 0.50) // UTC 2025-10-26T02:00Z
  ];
  const { matched, priceIntervalMinutes } = matchIntervalsToPrices(intervals, prices);
  assert.equal(priceIntervalMinutes, 60);
  assert.equal(matched[0].priceEurKwh, 0.30);
  assert.equal(matched[1].priceEurKwh, 0.40);
});

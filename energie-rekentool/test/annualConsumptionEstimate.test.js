import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateAnnualImportKwh } from '../src/core/annualConsumptionEstimate.js';

function summary(overrides = {}) {
  return {
    firstTimestamp: '2025-06-01T00:15:00+02:00',
    lastTimestamp: '2025-06-08T00:00:00+02:00', // 7 dagen (incl. het laatste kwartier)
    intervalMinutes: 15,
    totalImportKwh: 140,
    ...overrides
  };
}

test('extrapoleert lineair naar een jaar op basis van de gemeten periode', () => {
  const annual = estimateAnnualImportKwh(summary());
  // 140 kWh over exact 7 dagen -> 20 kWh/dag -> 20 * 365.2425 = 7304,85
  assert.ok(Math.abs(annual - 20 * 365.2425) < 1e-6);
});

test('een langere gemeten periode geeft een lagere extrapolatie bij gelijk totaalverbruik', () => {
  const oneWeek = estimateAnnualImportKwh(summary());
  const oneMonth = estimateAnnualImportKwh({
    ...summary(),
    lastTimestamp: '2025-07-01T00:00:00+02:00' // ~30 dagen i.p.v. 7
  });
  assert.ok(oneMonth < oneWeek);
});

test('een enkel interval (periode van exact 1 intervalduur) extrapoleert nog steeds correct', () => {
  const annual = estimateAnnualImportKwh({
    firstTimestamp: '2025-06-01T00:15:00+02:00',
    lastTimestamp: '2025-06-01T00:15:00+02:00',
    intervalMinutes: 15,
    totalImportKwh: 1
  });
  // 1 kWh per kwartier -> 96 kWh/dag -> * 365.2425
  assert.ok(Math.abs(annual - 96 * 365.2425) < 1e-6);
});

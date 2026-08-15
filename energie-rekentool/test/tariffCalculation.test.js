import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { calculateScenarioComparison } from '../src/core/tariffCalculation.js';
import { parseHomeWizardCsv, toIntervalReadings } from '../src/core/homewizardCsv.js';
import { parsePriceCsv } from '../src/core/priceCsv.js';
import { matchIntervalsToPrices } from '../src/core/priceMatching.js';
import { computePriceCoverage, assertPriceCoverageSufficient } from '../src/core/priceCoverage.js';

const AVERAGE_DAYS_PER_MONTH = 365.2425 / 12;

function iv(timestamp, importKwh, exportKwh, priceEurKwh) {
  return { timestamp, importKwh, exportKwh, priceEurKwh };
}

const BASE_TARIFFS = {
  currentContractType: 'vast',
  currentSupplyRateInclVatEurPerKwh: 0.28,
  currentFeedInRateEurPerKwh: 0.09,
  currentFixedFeedInCostsPerMonth: 0,
  dynamicMarkupEurPerKwh: 0.02,
  dynamicFeedInMarkupEurPerKwh: 0.01,
  currentFixedSupplyCostsPerMonth: 0,
  dynamicFixedSupplyCostsPerMonth: 0
};

test('rejects an invalid contract type', () => {
  const tariffs = { ...BASE_TARIFFS, currentContractType: 'onbekend' };
  assert.throws(
    () => calculateScenarioComparison([iv('2025-06-01T00:15:00+02:00', 1, 0, 0.2)], tariffs),
    /currentContractType/i
  );
});

test('rejects a missing or non-numeric tariff field', () => {
  const tariffs = { ...BASE_TARIFFS, dynamicMarkupEurPerKwh: undefined };
  assert.throws(
    () => calculateScenarioComparison([iv('2025-06-01T00:15:00+02:00', 1, 0, 0.2)], tariffs),
    /dynamicMarkupEurPerKwh/i
  );
});

test('throws when an interval has no matched price (must resolve via stap 2 first)', () => {
  const intervals = [iv('2025-06-01T00:15:00+02:00', 1, 0, 0.2), iv('2025-06-01T00:30:00+02:00', 1, 0, null)];
  assert.throws(() => calculateScenarioComparison(intervals, BASE_TARIFFS), /geen gekoppelde prijs/i);
});

test('basic case with a positive price: dynamic and current totals match the literal formula', () => {
  const intervals = [
    iv('2025-06-01T00:15:00+02:00', 2, 0, 0.10), // alleen afname
    iv('2025-06-01T00:30:00+02:00', 0, 1, 0.10) // alleen teruglevering
  ];
  const result = calculateScenarioComparison(intervals, BASE_TARIFFS);

  // Dynamisch: (2 * (0.10+0.02)) - (1 * (0.10-0.01)) = 0.24 - 0.09 = 0.15
  assert.ok(Math.abs(result.dynamic.variableCostEur - 0.15) < 1e-9);
  // Huidig: (2 * 0.28) - (1 * 0.09) = 0.56 - 0.09 = 0.47
  assert.ok(Math.abs(result.current.variableCostEur - 0.47) < 1e-9);
  assert.ok(Math.abs(result.differenceEur - (0.47 - 0.15)) < 1e-9);
});

test('a negative spot price flows through unclamped: import can pay the customer, export can cost money', () => {
  const intervals = [
    iv('2025-01-15T03:00:00+01:00', 2, 3, -0.05),
    iv('2025-01-15T04:00:00+01:00', 0, 0, -0.05) // 0 kWh: draagt niets bij, alleen om intervalduur af te leiden
  ];
  const result = calculateScenarioComparison(intervals, {
    ...BASE_TARIFFS,
    dynamicMarkupEurPerKwh: 0.02,
    dynamicFeedInMarkupEurPerKwh: 0.01
  });

  // Import: 2 * (-0.05 + 0.02) = 2 * -0.03 = -0.06 (klant wordt betaald om te verbruiken)
  // Export: -(3 * (-0.05 - 0.01)) = -(3 * -0.06) = +0.18 (klant betaalt om terug te leveren)
  // Totaal: -0.06 + 0.18 = 0.12
  assert.ok(Math.abs(result.dynamic.variableCostEur - 0.12) < 1e-9);
  assert.equal(result.perInterval[0].dynamicCostEur > 0, true, 'teruglevering bij negatieve prijs moet per saldo geld kosten, niet opleveren');
});

test('fixed monthly costs are prorated to the exact measured period, not a fixed 30 days', () => {
  const intervals = [iv('2025-06-01T00:00:00+02:00', 0, 0, 0.10), iv('2025-06-01T01:00:00+02:00', 0, 0, 0.10)];
  // Periode: van 00:00 tot 01:00 + 1 uur interval = 2 uur = 2/24 dag.
  const periodDays = 2 / 24;
  const tariffs = { ...BASE_TARIFFS, dynamicFixedSupplyCostsPerMonth: 30, currentFixedSupplyCostsPerMonth: 15 };
  const result = calculateScenarioComparison(intervals, tariffs);

  const expectedDynamicFixed = 30 * (periodDays / AVERAGE_DAYS_PER_MONTH);
  const expectedCurrentFixed = 15 * (periodDays / AVERAGE_DAYS_PER_MONTH);
  assert.ok(Math.abs(result.dynamic.fixedCostEur - expectedDynamicFixed) < 1e-9);
  assert.ok(Math.abs(result.current.fixedCostEur - expectedCurrentFixed) < 1e-9);
  assert.ok(Math.abs(result.periodDays - periodDays) < 1e-9);
});

test('a fixed monthly feed-in cost is added only to the current scenario', () => {
  const intervals = [iv('2025-06-01T00:00:00+02:00', 0, 0, 0.10), iv('2025-06-01T01:00:00+02:00', 0, 0, 0.10)];
  const tariffs = { ...BASE_TARIFFS, currentFixedFeedInCostsPerMonth: 3 };
  const result = calculateScenarioComparison(intervals, tariffs);
  assert.ok(result.current.fixedFeedInCostEur > 0);
  assert.equal(result.dynamic.fixedCostEur, 0);
});

test('real HomeWizard dataset (klantdata/), if present locally, produces a finite, sane comparison', (t) => {
  const consumptionPath = 'klantdata/P1e-2026-7-20-2026-7-26.csv';
  const cachePath = '.cache/energyzero/energyzero_2026-07-19T00-00-00-000Z_2026-07-27T00-00-00-000Z_btw-true.csv';
  if (!existsSync(consumptionPath) || !existsSync(cachePath)) {
    t.skip('Echte klantdata en/of prijzencache niet aanwezig op deze machine (beide staan in .gitignore)');
    return;
  }

  const rows = parseHomeWizardCsv(readFileSync(consumptionPath, 'utf8'));
  const { intervals, warnings } = toIntervalReadings(rows);
  const prices = parsePriceCsv(readFileSync(cachePath, 'utf8'));
  const matchResult = matchIntervalsToPrices(intervals, prices);
  const coverage = computePriceCoverage(matchResult);
  assertPriceCoverageSufficient(coverage);

  const tariffs = {
    currentContractType: 'vast',
    currentSupplyRateInclVatEurPerKwh: 0.28,
    currentFeedInRateEurPerKwh: 0.09,
    currentFixedFeedInCostsPerMonth: 0,
    dynamicMarkupEurPerKwh: 0.02,
    dynamicFeedInMarkupEurPerKwh: 0.01,
    currentFixedSupplyCostsPerMonth: 6.17,
    dynamicFixedSupplyCostsPerMonth: 4.99
  };
  const result = calculateScenarioComparison(matchResult.matched, tariffs);

  assert.equal(result.intervalCount, 671);
  assert.ok(Number.isFinite(result.dynamic.totalEur));
  assert.ok(Number.isFinite(result.current.totalEur));
  assert.ok(Number.isFinite(result.differenceEur));
  // Iedere interval kreeg een prijs (coverage was 100%, zie stap 2), dus geen enkele
  // regel mag zonder kostenberekening zijn blijven staan.
  assert.equal(result.perInterval.every((r) => r.dynamicCostEur !== null), true);
  // Na de saldering-correctie worden import/export nooit meer gewaarschuwd of
  // gesaldeerd, ook niet als beide > 0 zijn binnen hetzelfde kwartier.
  assert.equal(warnings.length, 0);
});

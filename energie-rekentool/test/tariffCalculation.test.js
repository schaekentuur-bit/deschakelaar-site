import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { calculateFixedContractTotal, calculateScenarioComparison } from '../src/core/tariffCalculation.js';
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
  currentFixedSupplyCostsPerMonth: 0,
  newSupplyRateInclVatEurPerKwh: 0.26,
  newFeedInRateEurPerKwh: 0.12,
  newFixedFeedInCostsPerMonth: 0,
  newFixedSupplyCostsPerMonth: 0,
  dynamicMarkupEurPerKwh: 0.02,
  dynamicFeedInMarkupEurPerKwh: 0.01,
  dynamicEnergyTaxEurPerKwh: 0, // 0 in de basisfixture zodat de bestaande, met de hand nagerekende tests ongewijzigd blijven; zie de aparte energiebelasting-tests hieronder voor een niet-nul waarde
  dynamicFixedSupplyCostsPerMonth: 0
};

// --- calculateFixedContractTotal: de herbruikbare vast-tariefberekening, los getest ---

test('calculateFixedContractTotal: matches the literal formula for a positive rate', () => {
  const intervals = [
    iv('2025-06-01T00:15:00+02:00', 2, 0), // alleen afname
    iv('2025-06-01T00:30:00+02:00', 0, 1) // alleen teruglevering
  ];
  const result = calculateFixedContractTotal(intervals, {
    supplyRateInclVatEurPerKwh: 0.28,
    feedInRateEurPerKwh: 0.09,
    fixedFeedInCostsPerMonth: 0,
    fixedSupplyCostsPerMonth: 0
  });
  // (2 * 0.28) - (1 * 0.09) = 0.56 - 0.09 = 0.47
  assert.ok(Math.abs(result.variableCostEur - 0.47) < 1e-9);
  assert.equal(result.totalEur, result.variableCostEur);
});

test('calculateFixedContractTotal: prorates both fixed cost fields over the exact measured period', () => {
  const intervals = [iv('2025-06-01T00:00:00+02:00', 0, 0), iv('2025-06-01T01:00:00+02:00', 0, 0)];
  const periodDays = 2 / 24; // 00:00 t/m 01:00 + 1 uur interval = 2 uur
  const result = calculateFixedContractTotal(intervals, {
    supplyRateInclVatEurPerKwh: 0,
    feedInRateEurPerKwh: 0,
    fixedFeedInCostsPerMonth: 3,
    fixedSupplyCostsPerMonth: 15
  });
  const factor = periodDays / AVERAGE_DAYS_PER_MONTH;
  assert.ok(Math.abs(result.fixedCostEur - 15 * factor) < 1e-9);
  assert.ok(Math.abs(result.fixedFeedInCostEur - 3 * factor) < 1e-9);
  assert.ok(Math.abs(result.totalEur - (15 * factor + 3 * factor)) < 1e-9);
});

test('calculateFixedContractTotal: is reusable for two different tariff sets on the same consumption', () => {
  const intervals = [iv('2025-06-01T00:15:00+02:00', 10, 2), iv('2025-06-01T00:30:00+02:00', 0, 0)];
  const cheap = calculateFixedContractTotal(intervals, {
    supplyRateInclVatEurPerKwh: 0.2,
    feedInRateEurPerKwh: 0.1,
    fixedFeedInCostsPerMonth: 0,
    fixedSupplyCostsPerMonth: 0
  });
  const expensive = calculateFixedContractTotal(intervals, {
    supplyRateInclVatEurPerKwh: 0.35,
    feedInRateEurPerKwh: 0.05,
    fixedFeedInCostsPerMonth: 0,
    fixedSupplyCostsPerMonth: 0
  });
  assert.ok(expensive.totalEur > cheap.totalEur);
});

test('calculateFixedContractTotal: throws on an empty dataset', () => {
  assert.throws(
    () => calculateFixedContractTotal([], { supplyRateInclVatEurPerKwh: 0.2, feedInRateEurPerKwh: 0.1, fixedFeedInCostsPerMonth: 0, fixedSupplyCostsPerMonth: 0 }),
    /geen intervallen/i
  );
});

// --- calculateScenarioComparison: drie scenario's + drie vergelijkingen ---

test('rejects an invalid contract type', () => {
  const tariffs = { ...BASE_TARIFFS, currentContractType: 'onbekend' };
  assert.throws(
    () => calculateScenarioComparison([iv('2025-06-01T00:15:00+02:00', 1, 0, 0.2)], tariffs),
    /currentContractType/i
  );
});

test('rejects a missing or non-numeric tariff field (incl. the new "new contract" fields)', () => {
  for (const field of ['dynamicMarkupEurPerKwh', 'dynamicEnergyTaxEurPerKwh', 'newSupplyRateInclVatEurPerKwh', 'newFeedInRateEurPerKwh']) {
    const tariffs = { ...BASE_TARIFFS, [field]: undefined };
    assert.throws(
      () => calculateScenarioComparison([iv('2025-06-01T00:15:00+02:00', 1, 0, 0.2)], tariffs),
      new RegExp(field, 'i'),
      `verwacht een fout die "${field}" noemt`
    );
  }
});

test('throws when an interval has no matched price (must resolve via stap 2 first)', () => {
  const intervals = [iv('2025-06-01T00:15:00+02:00', 1, 0, 0.2), iv('2025-06-01T00:30:00+02:00', 1, 0, null)];
  assert.throws(() => calculateScenarioComparison(intervals, BASE_TARIFFS), /geen gekoppelde prijs/i);
});

test('computes current, newFixed and dynamic independently from the same three tariff groups', () => {
  const intervals = [
    iv('2025-06-01T00:15:00+02:00', 2, 0, 0.1), // alleen afname
    iv('2025-06-01T00:30:00+02:00', 0, 1, 0.1) // alleen teruglevering
  ];
  const result = calculateScenarioComparison(intervals, BASE_TARIFFS);

  // Huidig: (2*0.28) - (1*0.09) = 0.47
  assert.ok(Math.abs(result.current.variableCostEur - 0.47) < 1e-9);
  // Nieuw vast: (2*0.26) - (1*0.12) = 0.40
  assert.ok(Math.abs(result.newFixed.variableCostEur - 0.4) < 1e-9);
  // Dynamisch: (2*(0.1+0.02)) - (1*(0.1-0.01)) = 0.24 - 0.09 = 0.15
  assert.ok(Math.abs(result.dynamic.variableCostEur - 0.15) < 1e-9);
});

test('the three comparisons are pre-computed with a clear label and "cheaper" pointer', () => {
  const intervals = [iv('2025-06-01T00:15:00+02:00', 10, 0, 0.1), iv('2025-06-01T00:30:00+02:00', 0, 0, 0.1)];
  const result = calculateScenarioComparison(intervals, BASE_TARIFFS);
  const { currentVsNewFixed, currentVsDynamic, newFixedVsDynamic } = result.comparisons;

  // currentSupplyRate 0.28 > newSupplyRate 0.26 > dynamisch (0.1+0.02): nieuw vast en
  // dynamisch zijn allebei goedkoper dan huidig; onderling is dynamisch het goedkoopst.
  assert.equal(currentVsNewFixed.cheaper, 'newFixed');
  assert.equal(currentVsDynamic.cheaper, 'dynamic');
  assert.equal(newFixedVsDynamic.cheaper, 'dynamic');

  assert.ok(/huidig/i.test(currentVsNewFixed.label) && /nieuw vast/i.test(currentVsNewFixed.label));
  assert.ok(/huidig/i.test(currentVsDynamic.label) && /dynamisch/i.test(currentVsDynamic.label));
  assert.ok(/nieuw vast/i.test(newFixedVsDynamic.label) && /dynamisch/i.test(newFixedVsDynamic.label));

  // Interne consistentie: differenceEur = totaalA - totaalB per de eigen definitie.
  assert.ok(Math.abs(currentVsNewFixed.differenceEur - (result.current.totalEur - result.newFixed.totalEur)) < 1e-9);
  assert.ok(Math.abs(currentVsDynamic.differenceEur - (result.current.totalEur - result.dynamic.totalEur)) < 1e-9);
  assert.ok(Math.abs(newFixedVsDynamic.differenceEur - (result.newFixed.totalEur - result.dynamic.totalEur)) < 1e-9);
});

test('a comparison reports "cheaper: null" when both totals are exactly equal', () => {
  const intervals = [iv('2025-06-01T00:15:00+02:00', 10, 0, 0.1), iv('2025-06-01T00:30:00+02:00', 0, 0, 0.1)];
  const tariffs = { ...BASE_TARIFFS, newSupplyRateInclVatEurPerKwh: BASE_TARIFFS.currentSupplyRateInclVatEurPerKwh, newFeedInRateEurPerKwh: BASE_TARIFFS.currentFeedInRateEurPerKwh };
  const result = calculateScenarioComparison(intervals, tariffs);
  assert.equal(result.comparisons.currentVsNewFixed.differenceEur, 0);
  assert.equal(result.comparisons.currentVsNewFixed.cheaper, null);
});

test('a negative spot price flows through unclamped for the dynamic scenario: import can pay the customer, export can cost money', () => {
  const intervals = [
    iv('2025-01-15T03:00:00+01:00', 2, 3, -0.05),
    iv('2025-01-15T04:00:00+01:00', 0, 0, -0.05) // 0 kWh: draagt niets bij, alleen om intervalduur af te leiden
  ];
  const result = calculateScenarioComparison(intervals, BASE_TARIFFS);

  // Import: 2 * (-0.05 + 0.02) = 2 * -0.03 = -0.06 (klant wordt betaald om te verbruiken)
  // Export: -(3 * (-0.05 - 0.01)) = -(3 * -0.06) = +0.18 (klant betaalt om terug te leveren)
  // Totaal: -0.06 + 0.18 = 0.12
  assert.ok(Math.abs(result.dynamic.variableCostEur - 0.12) < 1e-9);
  assert.equal(result.perInterval[0].dynamicCostEur > 0, true, 'teruglevering bij negatieve prijs moet per saldo geld kosten, niet opleveren');
});

test('energiebelasting wordt alleen op afname toegepast, nooit op teruglevering', () => {
  const intervals = [
    iv('2025-06-01T00:15:00+02:00', 10, 0, 0.1), // alleen afname
    iv('2025-06-01T00:30:00+02:00', 0, 10, 0.1) // alleen teruglevering
  ];
  const tariffs = { ...BASE_TARIFFS, dynamicEnergyTaxEurPerKwh: 0.11085 };
  const result = calculateScenarioComparison(intervals, tariffs);

  // Afname: 10 * (0.1 + 0.02 + 0.11085) = 10 * 0.23085 = 2.3085
  // Teruglevering: -(10 * (0.1 - 0.01)) = -0.9 (energiebelasting hier NIET verrekend)
  // Totaal: 2.3085 - 0.9 = 1.4085
  assert.ok(Math.abs(result.dynamic.variableCostEur - 1.4085) < 1e-9);
});

test('een hogere energiebelasting maakt het dynamische scenario duurder, verder gelijk', () => {
  const intervals = [iv('2025-06-01T00:15:00+02:00', 10, 0, 0.1), iv('2025-06-01T00:30:00+02:00', 0, 0, 0.1)];
  const zonderBelasting = calculateScenarioComparison(intervals, { ...BASE_TARIFFS, dynamicEnergyTaxEurPerKwh: 0 });
  const metBelasting = calculateScenarioComparison(intervals, { ...BASE_TARIFFS, dynamicEnergyTaxEurPerKwh: 0.11085 });
  assert.ok(Math.abs(metBelasting.dynamic.totalEur - zonderBelasting.dynamic.totalEur - 10 * 0.11085) < 1e-9);
  // Huidig en nieuw vast blijven volledig ongewijzigd: de klant vult daar al incl. energiebelasting in.
  assert.deepEqual(metBelasting.current, zonderBelasting.current);
  assert.deepEqual(metBelasting.newFixed, zonderBelasting.newFixed);
});

test('fixed monthly costs for all three scenarios are prorated to the exact measured period, not a fixed 30 days', () => {
  const intervals = [iv('2025-06-01T00:00:00+02:00', 0, 0, 0.10), iv('2025-06-01T01:00:00+02:00', 0, 0, 0.10)];
  const periodDays = 2 / 24;
  const tariffs = {
    ...BASE_TARIFFS,
    dynamicFixedSupplyCostsPerMonth: 30,
    currentFixedSupplyCostsPerMonth: 15,
    newFixedSupplyCostsPerMonth: 20
  };
  const result = calculateScenarioComparison(intervals, tariffs);

  const factor = periodDays / AVERAGE_DAYS_PER_MONTH;
  assert.ok(Math.abs(result.dynamic.fixedCostEur - 30 * factor) < 1e-9);
  assert.ok(Math.abs(result.current.fixedCostEur - 15 * factor) < 1e-9);
  assert.ok(Math.abs(result.newFixed.fixedCostEur - 20 * factor) < 1e-9);
  assert.ok(Math.abs(result.periodDays - periodDays) < 1e-9);
});

test('a fixed monthly feed-in cost is added only to the scenario it belongs to', () => {
  const intervals = [iv('2025-06-01T00:00:00+02:00', 0, 0, 0.10), iv('2025-06-01T01:00:00+02:00', 0, 0, 0.10)];
  const tariffs = { ...BASE_TARIFFS, currentFixedFeedInCostsPerMonth: 3, newFixedFeedInCostsPerMonth: 5 };
  const result = calculateScenarioComparison(intervals, tariffs);
  assert.ok(result.current.fixedFeedInCostEur > 0);
  assert.ok(result.newFixed.fixedFeedInCostEur > 0);
  assert.notEqual(result.current.fixedFeedInCostEur, result.newFixed.fixedFeedInCostEur);
  assert.equal(result.dynamic.fixedCostEur, 0);
});

test('real HomeWizard dataset (klantdata/), if present locally, produces a finite, sane comparison across all three scenarios', (t) => {
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

  // Zelfde tarieven als het smoke-test-tarievenbestand uit stap 3, aangevuld
  // met een apart onderbouwd "nieuw vast contract"-scenario, zodat dit met de
  // hand opnieuw is na te rekenen zoals bij stap 3.
  const tariffs = {
    currentContractType: 'vast',
    currentSupplyRateInclVatEurPerKwh: 0.28,
    currentFeedInRateEurPerKwh: 0.09,
    currentFixedFeedInCostsPerMonth: 0,
    currentFixedSupplyCostsPerMonth: 6.17,
    newSupplyRateInclVatEurPerKwh: 0.275,
    newFeedInRateEurPerKwh: 0.16,
    newFixedFeedInCostsPerMonth: 0,
    newFixedSupplyCostsPerMonth: 6.5,
    dynamicMarkupEurPerKwh: 0.02,
    dynamicFeedInMarkupEurPerKwh: 0.01,
    dynamicEnergyTaxEurPerKwh: 0.11085,
    dynamicFixedSupplyCostsPerMonth: 4.99
  };
  const result = calculateScenarioComparison(matchResult.matched, tariffs);

  assert.equal(result.intervalCount, 671);
  for (const scenario of [result.current, result.newFixed, result.dynamic]) {
    assert.ok(Number.isFinite(scenario.totalEur));
  }
  for (const comparison of Object.values(result.comparisons)) {
    assert.ok(Number.isFinite(comparison.differenceEur));
    assert.ok(['current', 'newFixed', 'dynamic', null].includes(comparison.cheaper));
  }
  // Iedere interval kreeg een prijs (coverage was 100%, zie stap 2), dus geen enkele
  // regel mag zonder dynamische kostenberekening zijn blijven staan.
  assert.equal(result.perInterval.every((r) => r.dynamicCostEur !== null), true);
  // Na de saldering-correctie worden import/export nooit meer gewaarschuwd of
  // gesaldeerd, ook niet als beide > 0 zijn binnen hetzelfde kwartier.
  assert.equal(warnings.length, 0);

  console.log(
    `[stap 6 narekenen] huidig=€${result.current.totalEur.toFixed(2)} ` +
      `nieuw-vast=€${result.newFixed.totalEur.toFixed(2)} ` +
      `dynamisch=€${result.dynamic.totalEur.toFixed(2)}`
  );
});

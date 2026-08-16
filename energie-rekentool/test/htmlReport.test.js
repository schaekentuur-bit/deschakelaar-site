import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHtmlReport } from '../src/core/htmlReport.js';

function baseInput(overrides = {}) {
  const perInterval = [
    { timestamp: '2025-06-01T00:15:00+02:00', importKwh: 1, exportKwh: 0, priceEurKwh: 0.2, dynamicCostEur: 0.22 },
    { timestamp: '2025-06-01T00:30:00+02:00', importKwh: 0, exportKwh: 1, priceEurKwh: 0.25, dynamicCostEur: -0.24 }
  ];
  return {
    generatedAt: '2026-08-15T10:00:00.000Z',
    consumptionPath: 'klantdata/voorbeeld.csv',
    format: 'homewizard',
    consumptionSummary: {
      intervalMinutes: 15,
      firstTimestamp: '2025-06-01T00:15:00+02:00',
      lastTimestamp: '2025-06-01T00:30:00+02:00',
      expectedCount: 2,
      actualCount: 2,
      missingCount: 0,
      missingPercentage: 0,
      totalImportKwh: 1,
      totalExportKwh: 1
    },
    consumptionWarnings: [],
    priceSource: 'cache (.cache/energyzero/foo.csv)',
    coverage: {
      totalCount: 2,
      matchedCount: 2,
      missingCount: 0,
      missingPercentage: 0,
      consumptionIntervalMinutes: 15,
      priceIntervalMinutes: 60,
      isHourlyApproximation: true,
      limitationNote: 'BEKENDE BEPERKING (niet opgelost): test-notitie.'
    },
    result: {
      periodDays: 0.5,
      intervalCount: 2,
      tariffs: {
        currentContractType: 'vast',
        currentSupplyRateInclVatEurPerKwh: 0.28,
        currentFeedInRateEurPerKwh: 0.09,
        currentFixedFeedInCostsPerMonth: 0,
        currentFixedSupplyCostsPerMonth: 6.17,
        newSupplyRateInclVatEurPerKwh: 0.26,
        newFeedInRateEurPerKwh: 0.16,
        newFixedFeedInCostsPerMonth: 0,
        newFixedSupplyCostsPerMonth: 5.5,
        dynamicMarkupEurPerKwh: 0.02,
        dynamicFeedInMarkupEurPerKwh: 0.01,
        dynamicEnergyTaxEurPerKwh: 0.11085,
        dynamicFixedSupplyCostsPerMonth: 4.99
      },
      current: { variableCostEur: 0.19, fixedCostEur: 0.1, fixedFeedInCostEur: 0, totalEur: 0.29 },
      newFixed: { variableCostEur: 0.15, fixedCostEur: 0.05, fixedFeedInCostEur: 0, totalEur: 0.2 },
      dynamic: { variableCostEur: -0.02, fixedCostEur: 0.08, totalEur: 0.06 },
      comparisons: {
        currentVsNewFixed: { label: 'Huidig vast contract vs. nieuw vast contract', differenceEur: 0.09, cheaper: 'newFixed' },
        currentVsDynamic: { label: 'Huidig vast contract vs. nieuw dynamisch contract', differenceEur: 0.23, cheaper: 'dynamic' },
        newFixedVsDynamic: { label: 'Nieuw vast contract vs. nieuw dynamisch contract', differenceEur: 0.14, cheaper: 'dynamic' }
      },
      perInterval
    },
    ...overrides
  };
}

test('produces a complete, well-formed html document with an embedded svg chart', () => {
  const html = buildHtmlReport(baseInput());
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<\/html>\s*$/);
  assert.match(html, /<svg /);
  assert.match(html, /<\/svg>/);
});

test('shows all thirteen tariff fields explicitly, across all three scenarios', () => {
  const html = buildHtmlReport(baseInput());
  for (const value of [0.28, 0.09, 6.17, 0.26, 0.16, 5.5, 0.02, 0.01, 0.11085, 4.99, 'vast']) {
    assert.match(html, new RegExp(String(value).replace('.', '\\.')));
  }
});

test('shows coverage data from stap 1 and 2: period, interval counts, gaps, price coverage', () => {
  const html = buildHtmlReport(baseInput());
  assert.match(html, /2025-06-01T00:15:00\+02:00 t\/m 2025-06-01T00:30:00\+02:00/);
  assert.match(html, /2 van 2 verwacht/);
  assert.match(html, /cache \(\.cache\/energyzero\/foo\.csv\)/);
});

test('renders the known-limitation note prominently when present', () => {
  const html = buildHtmlReport(baseInput());
  assert.match(html, /BEKENDE BEPERKING \(niet opgelost\): test-notitie\./);
  assert.match(html, /class="ev-hint warn"/);
});

test('omits the limitation box when there is no limitation', () => {
  const input = baseInput();
  input.coverage = { ...input.coverage, limitationNote: null };
  const html = buildHtmlReport(input);
  assert.doesNotMatch(html, /BEKENDE BEPERKING/);
});

test('shows all three scenario totals and three clearly labeled comparison sentences', () => {
  const html = buildHtmlReport(baseInput());
  assert.match(html, /€ 0\.29/); // huidig vast
  assert.match(html, /€ 0\.20/); // nieuw vast
  assert.match(html, /€ 0\.06/); // dynamisch

  assert.match(html, /Huidig vast contract vs\. nieuw vast contract.*nieuw vast contract.*€ 0\.09 goedkoper/s);
  assert.match(html, /Huidig vast contract vs\. nieuw dynamisch contract.*nieuw dynamisch contract.*€ 0\.23 goedkoper/s);
  assert.match(html, /Nieuw vast contract vs\. nieuw dynamisch contract.*nieuw dynamisch contract.*€ 0\.14 goedkoper/s);
});

test('warns near "Huidig vast" that saldering (t/m 1 januari 2027) niet is meegerekend', () => {
  const html = buildHtmlReport(baseInput());
  assert.match(html, /Huidig vast<\/strong> houdt geen rekening met de salderingsregeling/);
  assert.match(html, /1 januari 2027/);
  // De waarschuwing hoort direct bij het resultaatblok (sectie 03), vóór de vergelijkingen.
  const resultSectionIndex = html.indexOf('Resultaat over de gemeten periode');
  const hintIndex = html.indexOf('salderingsregeling');
  const comparisonsIndex = html.indexOf('class="ev-comparisons"');
  assert.ok(resultSectionIndex < hintIndex && hintIndex < comparisonsIndex);
});

test('renders a neutral (non-green) comparison when the current contract is cheaper', () => {
  const input = baseInput();
  input.result = {
    ...input.result,
    comparisons: {
      ...input.result.comparisons,
      currentVsNewFixed: { label: 'Huidig vast contract vs. nieuw vast contract', differenceEur: -0.5, cheaper: 'current' }
    }
  };
  const html = buildHtmlReport(input);
  assert.match(html, /huidig vast contract.*€ 0\.50 goedkoper/s);
  assert.match(html, /class="ev-difference neutral"/);
});

test('renders a neutral message when two scenarios are exactly equal', () => {
  const input = baseInput();
  input.result = {
    ...input.result,
    comparisons: {
      ...input.result.comparisons,
      currentVsNewFixed: { label: 'Huidig vast contract vs. nieuw vast contract', differenceEur: 0, cheaper: null }
    }
  };
  const html = buildHtmlReport(input);
  assert.match(html, /Huidig vast contract vs\. nieuw vast contract: geen verschil over deze periode\./);
});

test('escapes untrusted string fields to prevent HTML injection', () => {
  const input = baseInput({ consumptionPath: '<script>alert(1)</script>.csv' });
  const html = buildHtmlReport(input);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('is deterministic: identical input produces identical output', () => {
  const input = baseInput();
  assert.equal(buildHtmlReport(input), buildHtmlReport(baseInput()));
});

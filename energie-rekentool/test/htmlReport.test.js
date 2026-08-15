import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHtmlReport } from '../src/core/htmlReport.js';

function baseInput(overrides = {}) {
  const perInterval = [
    { timestamp: '2025-06-01T00:15:00+02:00', importKwh: 1, exportKwh: 0, priceEurKwh: 0.2, dynamicCostEur: 0.22, currentCostEur: 0.28 },
    { timestamp: '2025-06-01T00:30:00+02:00', importKwh: 0, exportKwh: 1, priceEurKwh: 0.25, dynamicCostEur: -0.24, currentCostEur: -0.09 }
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
        dynamicMarkupEurPerKwh: 0.02,
        dynamicFeedInMarkupEurPerKwh: 0.01,
        currentFixedSupplyCostsPerMonth: 6.17,
        dynamicFixedSupplyCostsPerMonth: 4.99
      },
      dynamic: { variableCostEur: -0.02, fixedCostEur: 0.08, totalEur: 0.06 },
      current: { variableCostEur: 0.19, fixedCostEur: 0.1, fixedFeedInCostEur: 0, totalEur: 0.29 },
      differenceEur: 0.23,
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

test('shows all eight tariff fields explicitly', () => {
  const html = buildHtmlReport(baseInput());
  for (const value of [0.28, 0.09, 0.02, 0.01, 6.17, 4.99, 'vast']) {
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
  assert.match(html, /class="warning"/);
});

test('omits the limitation box when there is no limitation', () => {
  const input = baseInput();
  input.coverage = { ...input.coverage, limitationNote: null };
  const html = buildHtmlReport(input);
  assert.doesNotMatch(html, /BEKENDE BEPERKING/);
});

test('shows both scenario totals and a savings message when dynamic is cheaper', () => {
  const html = buildHtmlReport(baseInput());
  assert.match(html, /€ 0\.06/); // dynamic total
  assert.match(html, /€ 0\.29/); // current total
  assert.match(html, /bespaart.*€ 0\.23/s);
});

test('shows an extra-cost message when the current contract is cheaper', () => {
  const input = baseInput();
  input.result = { ...input.result, differenceEur: -1.5 };
  const html = buildHtmlReport(input);
  assert.match(html, /kost.*€ 1\.50.*extra/s);
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

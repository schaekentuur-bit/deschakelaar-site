// Bevestigt dat een xlsx-bestand met identieke inhoud als een csv-bestand
// door de omzetstap (src/io/xlsxToCsv.js) tot exact dezelfde berekende
// uitkomst leidt als het csv-bestand zelf, via de volledige pijplijn:
// inlezen -> normaliseren -> prijzen koppelen -> scenario's berekenen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { convertXlsxToCsvText } from '../src/io/xlsxToCsv.js';
import { detectFormat } from '../src/core/formatDetect.js';
import { parseHomeWizardCsv, toIntervalReadings } from '../src/core/homewizardCsv.js';
import { matchIntervalsToPrices } from '../src/core/priceMatching.js';
import { calculateScenarioComparison } from '../src/core/tariffCalculation.js';

const FIXTURE_XLSX = 'fixtures/synthetisch-1-dag.xlsx';
const FIXTURE_CSV = 'fixtures/synthetisch-1-dag.csv';

const TARIFFS = {
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

// Synthetische uurprijzen die de hele fixture-periode (2025-06-15 t/m
// 2025-06-16) dekken; de exacte waarden zijn irrelevant voor deze test —
// alleen dat csv en xlsx tot dezelfde koppeling en uitkomst leiden telt.
function buildHourlyPricesCoveringOneDay() {
  const prices = [];
  const start = Date.parse('2025-06-14T22:00:00Z');
  for (let i = 0; i < 30; i++) {
    const ts = new Date(start + i * 3600000).toISOString().replace('.000Z', '+00:00');
    prices.push({ timestamp: ts, priceEurKwh: 0.1 + 0.01 * (i % 5) });
  }
  return prices;
}

function runPipeline(csvText) {
  const format = detectFormat(csvText);
  const rows = parseHomeWizardCsv(csvText);
  const { intervals, warnings } = toIntervalReadings(rows);
  const prices = buildHourlyPricesCoveringOneDay();
  const matchResult = matchIntervalsToPrices(intervals, prices);
  const result = calculateScenarioComparison(matchResult.matched, TARIFFS);
  return { format, warnings, result };
}

test('a csv file and an equivalent xlsx file produce exactly the same calculated outcome', () => {
  const originalCsv = readFileSync(FIXTURE_CSV, 'utf8').replace(/\r\n/g, '\n');
  const xlsxBytes = new Uint8Array(readFileSync(FIXTURE_XLSX));
  const { csvText: convertedCsv } = convertXlsxToCsvText(xlsxBytes);

  const fromCsv = runPipeline(originalCsv);
  const fromXlsx = runPipeline(convertedCsv);

  assert.equal(fromXlsx.format, fromCsv.format);
  assert.deepEqual(fromXlsx.warnings, fromCsv.warnings);
  assert.deepEqual(fromXlsx.result, fromCsv.result);
});

#!/usr/bin/env node
// Dunne CLI-schil: leest verbruik + prijzen (via de gedeelde loader uit stap
// 2) en een tarievenbestand van schijf, roept core/tariffCalculation.js en
// core/htmlReport.js aan, print het tekstrapport en schrijft het navolgbare
// HTML-rapport (met grafiek) naar schijf.
'use strict';

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { parseArgs, loadConsumptionAndMatchedPrices, assertPriceCoverageSufficient } from './lib/loadConsumptionAndPrices.js';
import { calculateScenarioComparison } from '../core/tariffCalculation.js';
import { buildHtmlReport } from '../core/htmlReport.js';

function formatEur(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}€ ${Math.abs(n).toFixed(2)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const consumptionPath = args._[0];
  if (!consumptionPath || !args.tariffs) {
    console.error(
      'Gebruik: node src/cli/calculate.js <verbruik.csv> --tariffs <tarieven.json> ' +
        '[--prices <eigen-prijzen.csv>] [--cache-dir .cache/energyzero] [--excl-btw] [--out <rapport.html>]'
    );
    process.exit(1);
  }

  const tariffs = JSON.parse(readFileSync(args.tariffs, 'utf8'));

  const { format, consumptionWarnings, consumptionSummary, priceSource, matchResult, coverage } =
    await loadConsumptionAndMatchedPrices({
      consumptionPath,
      pricesPath: args.prices,
      cacheDir: args['cache-dir'],
      inclBtw: !('excl-btw' in args)
    });

  console.log(`Verbruiksbestand:     ${consumptionPath}`);
  console.log(`Herkend format:       ${format}`);
  console.log(`Periode:              ${consumptionSummary.firstTimestamp} t/m ${consumptionSummary.lastTimestamp}`);
  console.log(`Intervallen gevonden: ${consumptionSummary.actualCount} van ${consumptionSummary.expectedCount} verwacht`);
  console.log(`Totale afname:        ${consumptionSummary.totalImportKwh.toFixed(3)} kWh`);
  console.log(`Totale teruglevering: ${consumptionSummary.totalExportKwh.toFixed(3)} kWh`);
  if (consumptionWarnings.length > 0) {
    console.log(`Waarschuwingen (verbruik): ${consumptionWarnings.length}`);
  }

  console.log('');
  console.log(`Prijsbron:            ${priceSource}`);
  console.log(`Prijsintervalduur:    ${coverage.priceIntervalMinutes} minuten (verbruik: ${coverage.consumptionIntervalMinutes} minuten)`);
  console.log(`Prijzen gekoppeld:    ${coverage.matchedCount} van ${coverage.totalCount} intervallen (${coverage.missingPercentage.toFixed(2)}% ontbreekt)`);
  if (coverage.limitationNote) {
    console.log(`⚠ ${coverage.limitationNote}`);
  }
  assertPriceCoverageSufficient(coverage);

  const result = calculateScenarioComparison(matchResult.matched, tariffs);

  console.log('');
  console.log(`Gemeten periode:      ${result.periodDays.toFixed(2)} dagen (${result.intervalCount} intervallen)`);

  console.log('');
  console.log(`Huidig contract (${tariffs.currentContractType}), per klant aangeleverd:`);
  console.log(`  Leveringstarief incl. btw:  ${tariffs.currentSupplyRateInclVatEurPerKwh} EUR/kWh`);
  console.log(`  Terugleververgoeding:       ${tariffs.currentFeedInRateEurPerKwh} EUR/kWh`);
  console.log(`  Vaste terugleverkosten:     ${tariffs.currentFixedFeedInCostsPerMonth} EUR/maand`);
  console.log(`  Vaste leveringskosten:      ${tariffs.currentFixedSupplyCostsPerMonth} EUR/maand`);

  console.log('');
  console.log('Nieuw vast contract, per klant aangeleverd:');
  console.log(`  Leveringstarief incl. btw:  ${tariffs.newSupplyRateInclVatEurPerKwh} EUR/kWh`);
  console.log(`  Terugleververgoeding:       ${tariffs.newFeedInRateEurPerKwh} EUR/kWh`);
  console.log(`  Vaste terugleverkosten:     ${tariffs.newFixedFeedInCostsPerMonth} EUR/maand`);
  console.log(`  Vaste leveringskosten:      ${tariffs.newFixedSupplyCostsPerMonth} EUR/maand`);

  console.log('');
  console.log('Nieuw dynamisch contract, per klant aangeleverd:');
  console.log(`  Opslag op afname:           ${tariffs.dynamicMarkupEurPerKwh} EUR/kWh (bij de spotprijs opgeteld)`);
  console.log(`  Opslag op teruglevering:    ${tariffs.dynamicFeedInMarkupEurPerKwh} EUR/kWh (van de spotprijs afgetrokken)`);
  console.log(`  Energiebelasting op afname: ${tariffs.dynamicEnergyTaxEurPerKwh} EUR/kWh (alleen bij afname, niet bij teruglevering)`);
  console.log(`  Vaste leveringskosten:      ${tariffs.dynamicFixedSupplyCostsPerMonth} EUR/maand`);
  console.log(`  Vaste kosten geprorateerd over ${result.periodDays.toFixed(2)} dagen (gemiddelde maandlengte: 30,44 dagen)`);

  console.log('');
  console.log(`Huidig vast — totaal:       ${formatEur(result.current.totalEur)} (variabel ${formatEur(result.current.variableCostEur)} + vast ${formatEur(result.current.fixedCostEur)} + terugleverkosten ${formatEur(result.current.fixedFeedInCostEur)})`);
  console.log(`Nieuw vast — totaal:        ${formatEur(result.newFixed.totalEur)} (variabel ${formatEur(result.newFixed.variableCostEur)} + vast ${formatEur(result.newFixed.fixedCostEur)} + terugleverkosten ${formatEur(result.newFixed.fixedFeedInCostEur)})`);
  console.log(`Nieuw dynamisch — totaal:   ${formatEur(result.dynamic.totalEur)} (variabel ${formatEur(result.dynamic.variableCostEur)} + vast ${formatEur(result.dynamic.fixedCostEur)})`);

  console.log('');
  const scenarioNames = { current: 'huidig vast contract', newFixed: 'nieuw vast contract', dynamic: 'nieuw dynamisch contract' };
  for (const comparison of Object.values(result.comparisons)) {
    if (comparison.cheaper === null) {
      console.log(`${comparison.label}: geen verschil over deze periode.`);
    } else {
      console.log(`${comparison.label}: ${scenarioNames[comparison.cheaper]} is ${formatEur(Math.abs(comparison.differenceEur))} goedkoper over deze periode.`);
    }
  }
  console.log('\n(Dit zijn de bedragen over de gemeten periode, geen jaarindicatie. Een negatief totaal betekent een tegoed: de teruglevering overtreft de afname.)');

  const outPath = args.out || `rapporten/${basename(consumptionPath).replace(/\.csv$/i, '')}.rapport.html`;
  const html = buildHtmlReport({
    generatedAt: new Date().toISOString(),
    consumptionPath,
    format,
    consumptionSummary,
    consumptionWarnings,
    priceSource,
    coverage,
    result
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  console.log(`\nHTML-rapport (met grafiek) geschreven naar: ${outPath}`);
}

main().catch((err) => {
  console.error(`\nFout: ${err.message}`);
  process.exit(1);
});

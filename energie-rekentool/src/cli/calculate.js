#!/usr/bin/env node
// Dunne CLI-schil: leest verbruik + prijzen (via de gedeelde loader uit stap
// 2) en een tarievenbestand van schijf, roept core/tariffCalculation.js aan
// en print het volledige, navolgbare rapport. Nog geen grafiek/output-laag
// (stap 4) — alleen de eindbedragen en het verschil.
'use strict';

import { readFileSync } from 'node:fs';
import { parseArgs, loadConsumptionAndMatchedPrices, assertPriceCoverageSufficient } from './lib/loadConsumptionAndPrices.js';
import { calculateScenarioComparison } from '../core/tariffCalculation.js';

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
        '[--prices <eigen-prijzen.csv>] [--cache-dir .cache/energyzero] [--excl-btw]'
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
  console.log('Gebruikte tarieven (per klant aangeleverd, niets hardcoded):');
  console.log(`  Huidig contracttype:                 ${tariffs.currentContractType}`);
  console.log(`  Huidig leveringstarief incl. btw:     ${tariffs.currentSupplyRateInclVatEurPerKwh} EUR/kWh`);
  console.log(`  Huidige terugleververgoeding:         ${tariffs.currentFeedInRateEurPerKwh} EUR/kWh`);
  console.log(`  Huidige vaste terugleverkosten:       ${tariffs.currentFixedFeedInCostsPerMonth} EUR/maand`);
  console.log(`  Huidige vaste leveringskosten:        ${tariffs.currentFixedSupplyCostsPerMonth} EUR/maand`);
  console.log(`  Dynamische opslag op afname:          ${tariffs.dynamicMarkupEurPerKwh} EUR/kWh (bij de spotprijs opgeteld)`);
  console.log(`  Dynamische opslag op teruglevering:    ${tariffs.dynamicFeedInMarkupEurPerKwh} EUR/kWh (van de spotprijs afgetrokken)`);
  console.log(`  Dynamische vaste leveringskosten:      ${tariffs.dynamicFixedSupplyCostsPerMonth} EUR/maand`);
  console.log(`  Vaste kosten geprorateerd over ${result.periodDays.toFixed(2)} dagen (gemiddelde maandlengte: 30,44 dagen)`);

  console.log('');
  console.log(`Huidig contract (${tariffs.currentContractType}):`);
  console.log(`  Variabel (afname/teruglevering):     ${formatEur(result.current.variableCostEur)}`);
  console.log(`  Vaste leveringskosten:               ${formatEur(result.current.fixedCostEur)}`);
  console.log(`  Vaste terugleverkosten:               ${formatEur(result.current.fixedFeedInCostEur)}`);
  console.log(`  Totaal over de gemeten periode:       ${formatEur(result.current.totalEur)}`);

  console.log('');
  console.log('Dynamisch contract:');
  console.log(`  Variabel (afname/teruglevering):     ${formatEur(result.dynamic.variableCostEur)}`);
  console.log(`  Vaste leveringskosten:               ${formatEur(result.dynamic.fixedCostEur)}`);
  console.log(`  Totaal over de gemeten periode:       ${formatEur(result.dynamic.totalEur)}`);

  console.log('');
  if (result.differenceEur > 0) {
    console.log(`Verschil: overstappen naar dynamisch bespaart ${formatEur(result.differenceEur)} over deze periode.`);
  } else if (result.differenceEur < 0) {
    console.log(`Verschil: overstappen naar dynamisch kost ${formatEur(-result.differenceEur)} extra over deze periode.`);
  } else {
    console.log('Verschil: geen verschil tussen beide scenario\'s over deze periode.');
  }
  console.log(
    '\n(Dit is het bedrag over de gemeten periode, geen jaarindicatie — die volgt in de output/grafiek-stap.)'
  );
}

main().catch((err) => {
  console.error(`\nFout: ${err.message}`);
  process.exit(1);
});

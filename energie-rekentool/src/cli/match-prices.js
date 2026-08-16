#!/usr/bin/env node
// Dunne CLI-schil: leest verbruiksbestand + evt. eigen prijsbestand van
// schijf, of haalt EnergyZero-uurprijzen op (met lokale cache), roept core/
// aan, print het validatierapport. Doet nog geen berekening (stap 3) — dit
// demonstreert/valideert alleen de prijskoppeling uit stap 2.
'use strict';

import { parseArgs, loadConsumptionAndMatchedPrices, assertPriceCoverageSufficient } from './lib/loadConsumptionAndPrices.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const consumptionPath = args._[0];
  if (!consumptionPath) {
    console.error('Gebruik: node src/cli/match-prices.js <verbruik.csv> [--prices <eigen-prijzen.csv>] [--cache-dir .cache/energyzero] [--excl-btw]');
    process.exit(1);
  }

  const { format, consumptionWarnings, consumptionSummary, priceSource, coverage } = await loadConsumptionAndMatchedPrices({
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
    console.log(`Waarschuwingen (verbruik, ${consumptionWarnings.length}):`);
    for (const w of consumptionWarnings) console.log(`  - ${w}`);
  }

  console.log('');
  console.log(`Prijsbron:            ${priceSource}`);
  console.log(`Prijsintervalduur:    ${coverage.priceIntervalMinutes} minuten (verbruik: ${coverage.consumptionIntervalMinutes} minuten)`);
  console.log(`Prijzen gekoppeld:    ${coverage.matchedCount} van ${coverage.totalCount} intervallen`);
  console.log(`Ontbrekende prijzen:  ${coverage.missingCount} (${coverage.missingPercentage.toFixed(2)}%)`);
  if (coverage.limitationNote) {
    console.log('');
    console.log(`⚠ ${coverage.limitationNote}`);
  }

  assertPriceCoverageSufficient(coverage);
  console.log('\nPrijsdekking voldoende om mee te rekenen.');
}

main().catch((err) => {
  console.error(`\nFout: ${err.message}`);
  process.exit(1);
});

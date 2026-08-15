#!/usr/bin/env node
// Dunne CLI-schil: leest verbruiksbestand + evt. eigen prijsbestand van
// schijf, of haalt EnergyZero-uurprijzen op (met lokale cache), roept core/
// aan, print het validatierapport. Doet nog geen berekening (stap 3) — dit
// demonstreert/valideert alleen de prijskoppeling uit stap 2.
'use strict';

import { readFileSync } from 'node:fs';
import { detectFormat } from '../core/formatDetect.js';
import { parseHomeWizardCsv, toIntervalReadings } from '../core/homewizardCsv.js';
import { parseInternalCsv } from '../core/internalCsv.js';
import { computeCoverageSummary } from '../core/validate.js';
import { parsePriceCsv } from '../core/priceCsv.js';
import { matchIntervalsToPrices } from '../core/priceMatching.js';
import { computePriceCoverage, assertPriceCoverageSufficient } from '../core/priceCoverage.js';
import { fetchEnergyZeroHourlyPrices } from './lib/energyZeroClient.js';
import { readPriceCache, writePriceCache } from './lib/priceCache.js';

function normalizeConsumption(csvText) {
  const format = detectFormat(csvText);
  if (format === 'homewizard') {
    const rows = parseHomeWizardCsv(csvText);
    return { format, ...toIntervalReadings(rows) };
  }
  const { intervals, warnings } = parseInternalCsv(csvText);
  return { format, intervals, warnings };
}

function utcDayFloorIso(ms) {
  return new Date(Math.floor(ms / 86400000) * 86400000).toISOString();
}

function utcNextDayFloorIso(ms) {
  return new Date(Math.floor(ms / 86400000) * 86400000 + 86400000).toISOString();
}

async function getEnergyZeroPrices({ firstTimestamp, lastTimestamp, cacheDir, inclBtw }) {
  const fromDateUtcIso = utcDayFloorIso(Date.parse(firstTimestamp));
  const tillDateUtcIso = utcNextDayFloorIso(Date.parse(lastTimestamp));

  const cached = readPriceCache(cacheDir, fromDateUtcIso, tillDateUtcIso, inclBtw);
  if (cached) {
    return { prices: cached.prices, source: `cache (${cached.path})` };
  }

  const prices = await fetchEnergyZeroHourlyPrices(fromDateUtcIso, tillDateUtcIso, { inclBtw });
  const path = writePriceCache(cacheDir, fromDateUtcIso, tillDateUtcIso, inclBtw, prices);
  return { prices, source: `EnergyZero-API (nu opgehaald, gecachet naar ${path})` };
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      opts[arg.slice(2)] = argv[i + 1];
      i++;
    } else {
      opts._.push(arg);
    }
  }
  return opts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const consumptionPath = args._[0];
  if (!consumptionPath) {
    console.error('Gebruik: node src/cli/match-prices.js <verbruik.csv> [--prices <eigen-prijzen.csv>] [--cache-dir .cache/energyzero] [--excl-btw]');
    process.exit(1);
  }

  const cacheDir = args['cache-dir'] || '.cache/energyzero';
  const inclBtw = !('excl-btw' in args);

  const consumptionCsv = readFileSync(consumptionPath, 'utf8');
  const { format, intervals, warnings } = normalizeConsumption(consumptionCsv);
  const consumptionSummary = computeCoverageSummary(intervals);

  console.log(`Verbruiksbestand:     ${consumptionPath}`);
  console.log(`Herkend format:       ${format}`);
  console.log(`Periode:              ${consumptionSummary.firstTimestamp} t/m ${consumptionSummary.lastTimestamp}`);
  console.log(`Intervallen gevonden: ${consumptionSummary.actualCount} van ${consumptionSummary.expectedCount} verwacht`);
  console.log(`Totale afname:        ${consumptionSummary.totalImportKwh.toFixed(3)} kWh`);
  console.log(`Totale teruglevering: ${consumptionSummary.totalExportKwh.toFixed(3)} kWh`);
  if (warnings.length > 0) {
    console.log(`Waarschuwingen (verbruik): ${warnings.length}`);
  }

  let prices;
  let priceSource;
  if (args.prices) {
    prices = parsePriceCsv(readFileSync(args.prices, 'utf8'));
    priceSource = `eigen prijsbestand (${args.prices})`;
  } else {
    const result = await getEnergyZeroPrices({
      firstTimestamp: consumptionSummary.firstTimestamp,
      lastTimestamp: consumptionSummary.lastTimestamp,
      cacheDir,
      inclBtw
    });
    prices = result.prices;
    priceSource = `${result.source}, incl. BTW: ${inclBtw}`;
  }

  const matchResult = matchIntervalsToPrices(intervals, prices);
  const coverage = computePriceCoverage(matchResult);

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
  console.log('\nPrijsdekking voldoende om mee te rekenen (stap 3, nog niet gebouwd).');
}

main().catch((err) => {
  console.error(`\nFout: ${err.message}`);
  process.exit(1);
});

// Gedeelde CLI-orkestratie tussen match-prices.js en calculate.js: verbruik
// inlezen/normaliseren, prijzen ophalen (cache/API of eigen bestand), koppelen
// en de verplichte dekkingscheck toepassen. Puur I/O-orkestratie — de
// eigenlijke logica staat in core/.
'use strict';

import { readFileSync } from 'node:fs';
import { detectFormat } from '../../core/formatDetect.js';
import { parseHomeWizardCsv, toIntervalReadings } from '../../core/homewizardCsv.js';
import { parseInternalCsv } from '../../core/internalCsv.js';
import { computeCoverageSummary } from '../../core/validate.js';
import { parsePriceCsv } from '../../core/priceCsv.js';
import { matchIntervalsToPrices } from '../../core/priceMatching.js';
import { computePriceCoverage, assertPriceCoverageSufficient } from '../../core/priceCoverage.js';
import { fetchEnergyZeroHourlyPrices } from './energyZeroClient.js';
import { readPriceCache, writePriceCache } from './priceCache.js';

export function parseArgs(argv) {
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

/**
 * @param {object} opts
 * @param {string} opts.consumptionPath
 * @param {string} [opts.pricesPath] - eigen prijsbestand; indien afwezig wordt EnergyZero gebruikt
 * @param {string} [opts.cacheDir]
 * @param {boolean} [opts.inclBtw]
 */
export async function loadConsumptionAndMatchedPrices(opts) {
  const { consumptionPath, pricesPath, cacheDir = '.cache/energyzero', inclBtw = true } = opts;

  const consumptionCsv = readFileSync(consumptionPath, 'utf8');
  const { format, intervals, warnings: consumptionWarnings } = normalizeConsumption(consumptionCsv);
  const consumptionSummary = computeCoverageSummary(intervals);

  let prices;
  let priceSource;
  if (pricesPath) {
    prices = parsePriceCsv(readFileSync(pricesPath, 'utf8'));
    priceSource = `eigen prijsbestand (${pricesPath})`;
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

  return { format, consumptionWarnings, consumptionSummary, priceSource, matchResult, coverage };
}

export { assertPriceCoverageSufficient };

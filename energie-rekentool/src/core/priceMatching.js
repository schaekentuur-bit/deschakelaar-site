// Pure functie: koppelt verbruiksintervallen aan prijspunten. Beide komen als
// data binnen (arrays), er wordt niets opgehaald of van schijf gelezen —
// dat gebeurt in de CLI-laag, ongeacht of de bron EnergyZero of een eigen
// prijsbestand is.
'use strict';

import { detectIntervalMs } from './amsterdamTime.js';

/**
 * Koppelt elk verbruiksinterval aan het prijspunt van de "emmer" (bucket)
 * waar het binnenvalt. Werkt voor elke combinatie van resolutie: kwartier-
 * verbruik tegen kwartierprijzen (1-op-1), of kwartierverbruik tegen
 * uurprijzen (4 kwartieren delen dezelfde prijs — zie priceCoverage.js voor
 * de bijbehorende beperking-labeling).
 *
 * Prijs-emmers worden bepaald door de epoch-tijd te delen door de
 * gedetecteerde prijsintervalduur: dat werkt correct ongeacht tijdzone/DST
 * omdat epoch 0 zelf op een hele UTC-uur- én kwartiergrens ligt.
 *
 * @param {Array<{timestamp: string, importKwh: number, exportKwh: number}>} intervals
 * @param {Array<{timestamp: string, priceEurKwh: number}>} pricePoints
 * @returns {{ matched: Array, consumptionIntervalMinutes: number, priceIntervalMinutes: number }}
 */
export function matchIntervalsToPrices(intervals, pricePoints) {
  if (intervals.length === 0) {
    throw new Error('Geen verbruiksintervallen aangeleverd');
  }
  if (pricePoints.length < 2) {
    throw new Error('Kan prijsintervalduur niet bepalen: minstens twee prijspunten nodig');
  }

  const consumptionMs = intervals.map((iv) => Date.parse(iv.timestamp)).sort((a, b) => a - b);
  const consumptionIntervalMinutes = detectIntervalMs(consumptionMs) / 60000;

  const sortedPrices = [...pricePoints].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const priceMsList = sortedPrices.map((p) => Date.parse(p.timestamp));
  const priceIntervalMs = detectIntervalMs(priceMsList);
  const priceIntervalMinutes = priceIntervalMs / 60000;

  const priceByBucketStartMs = new Map();
  sortedPrices.forEach((p, i) => priceByBucketStartMs.set(priceMsList[i], p.priceEurKwh));

  const matched = intervals.map((interval) => {
    const intervalMs = Date.parse(interval.timestamp);
    const bucketStartMs = Math.floor(intervalMs / priceIntervalMs) * priceIntervalMs;
    const priceEurKwh = priceByBucketStartMs.has(bucketStartMs) ? priceByBucketStartMs.get(bucketStartMs) : null;
    return { ...interval, priceEurKwh };
  });

  return { matched, consumptionIntervalMinutes, priceIntervalMinutes };
}

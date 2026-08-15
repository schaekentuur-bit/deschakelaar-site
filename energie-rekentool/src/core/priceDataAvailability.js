// Pure functie: data in, data uit. Bepaalt welke per-maand prijsbestanden
// een verbruiksperiode nodig heeft, en of die allemaal daadwerkelijk
// gepubliceerd zijn — zodat de pagina een duidelijke melding kan tonen in
// plaats van stilzwijgend een onvolledig resultaat.
'use strict';

function nextMonth(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * @param {{firstTimestamp: string, lastTimestamp: string}} consumptionSummary - uit core/validate.js
 * @param {{months: string[]}} manifest - de ingelezen data/prices/energyzero/index.json
 * @returns {{
 *   neededMonths: string[],
 *   missingMonths: string[],
 *   isFullyAvailable: boolean,
 *   earliestAvailable: string|null,
 *   latestAvailable: string|null
 * }}
 */
export function checkPriceDataAvailability(consumptionSummary, manifest) {
  const firstMonth = consumptionSummary.firstTimestamp.slice(0, 7);
  const lastMonth = consumptionSummary.lastTimestamp.slice(0, 7);

  const neededMonths = [];
  let cursor = firstMonth;
  while (cursor <= lastMonth) {
    neededMonths.push(cursor);
    cursor = nextMonth(cursor);
  }

  const available = manifest.months || [];
  const availableSet = new Set(available);
  const missingMonths = neededMonths.filter((m) => !availableSet.has(m));

  return {
    neededMonths,
    missingMonths,
    isFullyAvailable: missingMonths.length === 0,
    earliestAvailable: available.length > 0 ? available[0] : null,
    latestAvailable: available.length > 0 ? available[available.length - 1] : null
  };
}

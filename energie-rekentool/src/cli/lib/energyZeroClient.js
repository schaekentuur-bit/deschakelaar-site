// Node-specifiek (fetch): hoort niet in src/core/. Haalt EnergyZero-uurprijzen
// op en zet ze om naar het canonieke prijsformat uit core/priceCsv.js.
//
// BEKENDE BEPERKING (niet opgelost): zowel EnergyZero als Frank Energie zijn
// getest op kwartierprecisie (rond de markttransitie van 1 oktober 2025 én in
// augustus 2026, via hun publieke API's). Beide leverden in alle gevallen
// uitsluitend uurprijzen (interval=3 bij EnergyZero gaf een lege array; Frank
// Energie's marketPricesElectricity gaf per punt een from/till van exact 1
// uur). Dit is dus de best beschikbare bron, geen kwartierbron — zie
// core/priceCoverage.js voor hoe dat in de rapportage zichtbaar blijft.
'use strict';

import { utcMsToAmsterdamIso } from '../../core/amsterdamTime.js';

const ENERGYZERO_URL = 'https://api.energyzero.nl/v1/energyprices';

/**
 * @param {string} fromDateUtcIso - ISO-instant, begin van het tijdvak (UTC)
 * @param {string} tillDateUtcIso - ISO-instant, einde van het tijdvak (UTC)
 * @param {object} [opts]
 * @param {boolean} [opts.inclBtw] - BTW wel/niet inbegrepen in de teruggegeven marktprijs
 * @returns {Promise<Array<{timestamp: string, priceEurKwh: number}>>}
 */
export async function fetchEnergyZeroHourlyPrices(fromDateUtcIso, tillDateUtcIso, opts = {}) {
  const { inclBtw = true } = opts;

  const url = new URL(ENERGYZERO_URL);
  url.searchParams.set('fromDate', fromDateUtcIso);
  url.searchParams.set('tillDate', tillDateUtcIso);
  url.searchParams.set('interval', '4'); // uur — interval=3 (kwartier) getest, levert niets op
  url.searchParams.set('usageType', '1'); // elektriciteit
  url.searchParams.set('inclBtw', String(inclBtw));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`EnergyZero-API gaf ${response.status} ${response.statusText} voor ${url}`);
  }
  const data = await response.json();
  if (!Array.isArray(data.Prices)) {
    throw new Error(`Onverwacht antwoord van EnergyZero-API (geen Prices-array): ${JSON.stringify(data).slice(0, 200)}`);
  }
  if (data.Prices.length === 0) {
    throw new Error(`EnergyZero-API leverde geen prijzen voor ${fromDateUtcIso} t/m ${tillDateUtcIso}`);
  }

  return data.Prices.map((p) => ({
    timestamp: utcMsToAmsterdamIso(Date.parse(p.readingDate)),
    priceEurKwh: p.price
  })).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

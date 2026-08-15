// Pure functie: genereert een synthetisch HomeWizard-CSV-bestand als string.
// Geen fs hier — het wegschrijven gebeurt in de CLI-laag.
'use strict';

import { HOMEWIZARD_HEADER } from './homewizardCsv.js';
import { localAmsterdamWallTimeToIso, formatAmsterdamWallTime } from './amsterdamTime.js';

// Kleine deterministische PRNG (mulberry32), zodat fixtures/tests reproduceerbaar
// zijn zonder van Math.random afhankelijk te zijn.
function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function parseLabel(label) {
  const [datePart, timePart] = label.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  return { year, month, day, hour, minute };
}

function dayOfYear({ year, month, day }) {
  const startOfYear = Date.UTC(year, 0, 1);
  return Math.floor((Date.UTC(year, month - 1, day) - startOfYear) / 86400000) + 1;
}

/**
 * Genereert een synthetisch HomeWizard-exportbestand (CSV-tekst) met
 * oplopende meterstanden, een zonnecurve overdag en een avondpiek.
 * Ondersteunt elke periodelengte via `days` (bv. 1 voor een dag, 365 voor een jaar).
 *
 * Rijen worden gegenereerd op basis van echt verstreken tijd (uniforme UTC-
 * stappen), en pas daarna omgezet naar de lokale Amsterdamse wandkloklabel.
 * Dat reproduceert automatisch hoe een echte meter zich gedraagt rond de
 * DST-overgangen: het najaarsuur verschijnt twee keer, het lenteuur wordt
 * overgeslagen — precies zoals in een echte HomeWizard-export.
 *
 * @param {object} opts
 * @param {string} opts.startDate - "YYYY-MM-DD", lokale (Amsterdamse) startdag
 * @param {number} opts.days - periodelengte in dagen
 * @param {15|60} [opts.intervalMinutes]
 * @param {number} [opts.seed] - voor reproduceerbare ruis
 * @param {number} [opts.startImportKwh] - beginmeterstand afname
 * @param {number} [opts.startExportKwh] - beginmeterstand teruglevering
 * @param {number} [opts.householdBaseKw] - basislast van het huishouden
 * @param {number} [opts.solarPeakKw] - piekvermogen van de zonnepanelen
 * @returns {string} CSV-tekst in exact het HomeWizard-exportformaat
 */
export function generateHomeWizardFixtureCsv(opts = {}) {
  const {
    startDate = '2025-06-01',
    days = 1,
    intervalMinutes = 15,
    seed = 42,
    startImportKwh = 12345.678,
    startExportKwh = 2345.123,
    householdBaseKw = 0.3,
    solarPeakKw = 3.5
  } = opts;

  if (intervalMinutes !== 15 && intervalMinutes !== 60) {
    throw new Error('intervalMinutes moet 15 of 60 zijn');
  }
  if (days <= 0) {
    throw new Error('days moet groter dan 0 zijn');
  }

  const startMs = Date.parse(localAmsterdamWallTimeToIso(`${startDate} 00:00`));
  const intervalCount = Math.round((days * 24 * 60) / intervalMinutes);
  if (intervalCount < 1) {
    throw new Error('Periode te kort: levert geen enkel interval op');
  }

  const rand = mulberry32(seed);
  const lines = [HOMEWIZARD_HEADER];

  let cumImport = startImportKwh;
  let cumExport = startExportKwh;
  // Baseline-rij (levert bij normalisatie geen interval op, is startpunt voor diffing).
  lines.push(
    [formatAmsterdamWallTime(startMs), cumImport.toFixed(3), '0.000', cumExport.toFixed(3), '0.000', 0, 0, 0].join(
      ','
    )
  );

  const intervalHours = intervalMinutes / 60;
  // Cloudfactor per kalenderdag, zodat opeenvolgende dagen niet identiek zijn.
  const cloudFactorByDay = new Map();
  function cloudFactorFor(dayKey) {
    if (!cloudFactorByDay.has(dayKey)) cloudFactorByDay.set(dayKey, 0.35 + rand() * 0.65);
    return cloudFactorByDay.get(dayKey);
  }

  for (let i = 1; i <= intervalCount; i++) {
    const ms = startMs + i * intervalMinutes * 60000;
    const label = formatAmsterdamWallTime(ms);
    const local = parseLabel(label);
    const dayKey = label.slice(0, 10);
    const hourOfDay = local.hour + local.minute / 60;

    // Seizoensfactor: piek rond dag 172 (eind juni), minimum in de winter.
    const seasonFactor = 0.15 + 0.85 * Math.max(0, Math.sin((Math.PI * (dayOfYear(local) - 80)) / 185));

    // Zonnecurve: gaussian rond zonne-middag (13:00), alleen overdag actief.
    const solarShape = Math.max(0, Math.exp(-((hourOfDay - 13) ** 2) / (2 * 3.2 ** 2)) - 0.05);
    const solarKw = solarPeakKw * solarShape * seasonFactor * cloudFactorFor(dayKey);

    // Verbruikscurve: basislast + ochtendbump + avondpiek + kleine ruis.
    const morningBump = Math.exp(-((hourOfDay - 8) ** 2) / (2 * 1.2 ** 2)) * 0.5;
    const eveningPeak = Math.exp(-((hourOfDay - 19.5) ** 2) / (2 * 1.8 ** 2)) * 1.6;
    const noise = (rand() - 0.5) * 0.15;
    const consumptionKw = Math.max(0.05, householdBaseKw + morningBump + eveningPeak + noise);

    const consumptionKwh = consumptionKw * intervalHours;
    const solarKwh = solarKw * intervalHours;

    let importKwh = 0;
    let exportKwh = 0;
    const net = consumptionKwh - solarKwh;
    if (net >= 0) {
      importKwh = net;
    } else {
      exportKwh = -net;
    }

    cumImport += importKwh;
    cumExport += exportKwh;

    const netPowerW = (importKwh - exportKwh) * 1000 * (60 / intervalMinutes);
    const peakFactor = 1.05 + rand() * 0.35;
    const w1 = 0.28 + rand() * 0.15;
    const w2 = 0.28 + rand() * 0.15;
    const w3 = Math.max(0.1, 1 - w1 - w2);
    const l1MaxW = Math.round(netPowerW * peakFactor * w1);
    const l2MaxW = Math.round(netPowerW * peakFactor * w2);
    const l3MaxW = Math.round(netPowerW * peakFactor * w3);

    lines.push(
      [
        label,
        cumImport.toFixed(3),
        '0.000',
        cumExport.toFixed(3),
        '0.000',
        l1MaxW,
        l2MaxW,
        l3MaxW
      ].join(',')
    );
  }

  return lines.join('\n') + '\n';
}

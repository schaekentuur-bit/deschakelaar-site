#!/usr/bin/env node
// Draait dagelijks via een GitHub Action. Haalt een recent venster
// EnergyZero-uurprijzen op en merget dat in de gepubliceerde, per-maand
// gesplitste prijsbestanden onder data/prices/energyzero/. Dit zijn gewone
// statische bestanden die de (nog te bouwen) webpagina rechtstreeks van
// hetzelfde domein laadt — geen CORS, geen backend, geen schijf-cache nodig
// in de browser.
//
// Herbruikt fetchEnergyZeroHourlyPrices (cli/lib) en parsePriceCsv/
// serializePriceCsv (core) ongewijzigd: er is maar één plek waar het
// priceCsv-format gelezen/geschreven wordt.
'use strict';

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fetchEnergyZeroHourlyPrices } from './lib/energyZeroClient.js';
import { parsePriceCsv, serializePriceCsv } from '../core/priceCsv.js';

const DATA_DIR = 'data/prices/energyzero';
const WINDOW_DAYS = 4; // ruimer dan 1 dag: self-helend bij een gemiste run
const HOUR_MS = 3600000;

function utcDayFloorIso(ms) {
  return new Date(Math.floor(ms / 86400000) * 86400000).toISOString();
}

function monthOf(timestamp) {
  return timestamp.slice(0, 7); // "YYYY-MM" (Amsterdamse lokale tijd, staat al zo in de timestamp)
}

/**
 * Zoekt gaten in een chronologisch gesorteerde, per-uur prijsreeks. Werkt op
 * de epoch-tijd (niet de lokale cijfers in de timestamp-string), dus dit
 * detecteert correct rond een DST-overgang: de onderliggende EnergyZero-
 * emmers liggen altijd precies 1 uur uit elkaar in UTC, ook al springt de
 * lokale klokweergave dan met 0 of 2 uur.
 */
function findGaps(sortedPrices) {
  const gaps = [];
  for (let i = 1; i < sortedPrices.length; i++) {
    const deltaMs = Date.parse(sortedPrices[i].timestamp) - Date.parse(sortedPrices[i - 1].timestamp);
    if (deltaMs !== HOUR_MS) {
      gaps.push({
        afterTimestamp: sortedPrices[i - 1].timestamp,
        beforeTimestamp: sortedPrices[i].timestamp,
        missingHours: Math.round(deltaMs / HOUR_MS) - 1
      });
    }
  }
  return gaps;
}

/** @returns {Array<{month: string, gaps: Array}>} de bijgewerkte maanden die een gat bevatten */
async function mergeIntoMonthlyFiles(freshPrices) {
  const byMonth = new Map();
  for (const p of freshPrices) {
    const month = monthOf(p.timestamp);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(p);
  }

  mkdirSync(DATA_DIR, { recursive: true });

  const monthsWithGaps = [];

  for (const [month, newRows] of byMonth) {
    const filePath = `${DATA_DIR}/${month}.csv`;
    const existing = existsSync(filePath) ? parsePriceCsv(readFileSync(filePath, 'utf8')) : [];

    // Op timestamp samenvoegen: nieuwe waarden overschrijven oude bij dezelfde
    // sleutel (idempotent bij een herhaalde run, en vangt eventuele latere
    // correcties door EnergyZero op).
    const merged = new Map(existing.map((p) => [p.timestamp, p.priceEurKwh]));
    for (const p of newRows) merged.set(p.timestamp, p.priceEurKwh);

    const sorted = [...merged.entries()]
      .map(([timestamp, priceEurKwh]) => ({ timestamp, priceEurKwh }))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    writeFileSync(filePath, serializePriceCsv(sorted), 'utf8');
    console.log(`${filePath}: ${sorted.length} rijen totaal (${newRows.length} nieuw opgehaald)`);

    const gaps = findGaps(sorted);
    if (gaps.length > 0) {
      monthsWithGaps.push({ month, gaps });
      for (const gap of gaps) {
        // ::error:: is een GitHub Actions workflow-command: verschijnt als
        // rode annotatie bovenaan de run-samenvatting, niet alleen in de log.
        console.log(
          `::error::Gat in ${filePath}: ${gap.missingHours} ontbrekend(e) uur/uren tussen ` +
            `${gap.afterTimestamp} en ${gap.beforeTimestamp}`
        );
      }
    }
  }

  return monthsWithGaps;
}

function updateManifest() {
  const months = readdirSync(DATA_DIR)
    .filter((f) => /^\d{4}-\d{2}\.csv$/.test(f))
    .map((f) => f.replace('.csv', ''))
    .sort();
  const manifest = { months, lastUpdatedUtc: new Date().toISOString() };
  writeFileSync(`${DATA_DIR}/index.json`, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(
    `index.json bijgewerkt: ${months.length} maand(en) beschikbaar (${months[0]} t/m ${months[months.length - 1]})`
  );
}

async function main() {
  const now = Date.now();
  const fromDateUtcIso = utcDayFloorIso(now - WINDOW_DAYS * 86400000);
  const tillDateUtcIso = utcDayFloorIso(now + 86400000); // t/m eind vandaag (UTC)

  console.log(`Ophalen EnergyZero-uurprijzen: ${fromDateUtcIso} t/m ${tillDateUtcIso}`);
  const freshPrices = await fetchEnergyZeroHourlyPrices(fromDateUtcIso, tillDateUtcIso, { inclBtw: true });
  console.log(`${freshPrices.length} prijspunten opgehaald van EnergyZero`);

  const monthsWithGaps = await mergeIntoMonthlyFiles(freshPrices);
  // Manifest altijd bijwerken, ook als er een gat gevonden is: de bestanden
  // zijn nog steeds geldig en bruikbaar, alleen onvolledig. De run zelf moet
  // wel als mislukt getoond worden (zie main().catch), zodat dit opvalt in
  // het Actions-overzicht in plaats van pas bij een klant.
  updateManifest();

  if (monthsWithGaps.length > 0) {
    const totalGaps = monthsWithGaps.reduce((sum, m) => sum + m.gaps.length, 0);
    throw new Error(
      `${totalGaps} gat(en) gevonden in ${monthsWithGaps.length} bijgewerkt(e) maandbestand(en): ` +
        monthsWithGaps.map((m) => m.month).join(', ') +
        '. Bestanden zijn wel weggeschreven; los het gat handmatig op (bv. een grotere WINDOW_DAYS of een eenmalige backfill).'
    );
  }
}

main().catch((err) => {
  console.error(`Fout: ${err.message}`);
  process.exit(1);
});

#!/usr/bin/env node
// Dunne CLI-schil: leest argv + bestand van schijf, roept core/ aan, print rapport.
// Doet nog geen berekening (stap 3) — alleen inlezen, normaliseren en valideren.
'use strict';

import { detectFormat } from '../core/formatDetect.js';
import { parseHomeWizardCsv, toIntervalReadings } from '../core/homewizardCsv.js';
import { parseInternalCsv } from '../core/internalCsv.js';
import { computeCoverageSummary } from '../core/validate.js';
import { readConsumptionFileAsCsvText } from './lib/loadConsumptionAndPrices.js';

function normalize(csvText) {
  const format = detectFormat(csvText);
  if (format === 'homewizard') {
    const rows = parseHomeWizardCsv(csvText);
    const { intervals, warnings } = toIntervalReadings(rows);
    return { format, intervals, warnings };
  }
  const { intervals, warnings } = parseInternalCsv(csvText);
  return { format, intervals, warnings };
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Gebruik: node src/cli/inspect.js <pad-naar-csv-of-xlsx>');
    process.exit(1);
  }

  const csvText = readConsumptionFileAsCsvText(path);
  const { format, intervals, warnings } = normalize(csvText);
  const summary = computeCoverageSummary(intervals);

  console.log(`Bestand:              ${path}`);
  console.log(`Herkend format:       ${format}`);
  console.log(`Intervalduur:         ${summary.intervalMinutes} minuten`);
  console.log(`Periode:              ${summary.firstTimestamp} t/m ${summary.lastTimestamp}`);
  console.log(`Intervallen gevonden: ${summary.actualCount} van ${summary.expectedCount} verwacht`);
  console.log(`Ontbrekende gaten:    ${summary.missingCount} (${summary.missingPercentage.toFixed(2)}%)`);
  console.log(`Totale afname:        ${summary.totalImportKwh.toFixed(3)} kWh`);
  console.log(`Totale teruglevering: ${summary.totalExportKwh.toFixed(3)} kWh`);
  if (warnings.length > 0) {
    console.log(`\nWaarschuwingen (${warnings.length}):`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
}

main();

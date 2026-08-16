#!/usr/bin/env node
// Eenmalig hulpscript: zet een bestaand CSV-bestand (HomeWizard- of interne
// format) om naar een .xlsx-tweeling met identieke inhoud, voor het
// downloadbare template en voor testfixtures. Dit is de omgekeerde richting
// van src/io/xlsxToCsv.js (die converteert xlsx -> csv voor echte uploads);
// hier hoeft niets gedeeld te worden, dus staat het los in de CLI-laag.
//
// De tijdkolom blijft tekst (zoals een echte HomeWizard-export of ons eigen
// template die al gebruikt); de overige kolommen worden als getallen
// geschreven, zoals een gebruiker ze in Excel zou intypen.
'use strict';

import { readFileSync, writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

function csvTextToAoa(csvText) {
  const lines = csvText.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
  return lines.map((line, rowIndex) =>
    line.split(',').map((cell, colIndex) => {
      if (rowIndex === 0 || colIndex === 0) return cell; // kopregel, en tijd-/timestampkolom blijft tekst
      const num = Number(cell);
      return Number.isFinite(num) && cell.trim() !== '' ? num : cell;
    })
  );
}

function convertCsvFileToXlsx(csvPath, xlsxPath) {
  const csvText = readFileSync(csvPath, 'utf8');
  const aoa = csvTextToAoa(csvText);
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Verbruik');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  writeFileSync(xlsxPath, bytes);
  console.log(`${csvPath} -> ${xlsxPath}`);
}

function main() {
  const pairs = process.argv.slice(2);
  if (pairs.length === 0 || pairs.length % 2 !== 0) {
    console.error('Gebruik: node src/cli/generate-xlsx-fixtures.js <bron.csv> <doel.xlsx> [<bron2.csv> <doel2.xlsx> ...]');
    process.exit(1);
  }
  for (let i = 0; i < pairs.length; i += 2) {
    convertCsvFileToXlsx(pairs[i], pairs[i + 1]);
  }
}

main();

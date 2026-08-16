import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { convertXlsxToCsvText } from '../src/io/xlsxToCsv.js';
import { detectFormat } from '../src/core/formatDetect.js';
import { parseHomeWizardCsv, toIntervalReadings } from '../src/core/homewizardCsv.js';

const FIXTURE_XLSX = 'fixtures/synthetisch-1-dag.xlsx';
const FIXTURE_CSV = 'fixtures/synthetisch-1-dag.csv';

function parseHomeWizard(csvText) {
  return toIntervalReadings(parseHomeWizardCsv(csvText));
}

test('converts the synthetic xlsx fixture into csv text matching the original csv fixture', () => {
  const bytes = new Uint8Array(readFileSync(FIXTURE_XLSX));
  const { csvText, sheetCount, usedSheetName } = convertXlsxToCsvText(bytes);

  assert.equal(sheetCount, 1);
  assert.equal(usedSheetName, 'Verbruik');

  const originalCsv = readFileSync(FIXTURE_CSV, 'utf8').replace(/\r\n/g, '\n');
  const format = detectFormat(csvText);
  assert.equal(format, detectFormat(originalCsv));
  assert.equal(format, 'homewizard');

  const fromXlsx = parseHomeWizard(csvText);
  const fromCsv = parseHomeWizard(originalCsv);
  assert.deepEqual(fromXlsx, fromCsv);
});

test('reports the sheet count and only reads the first sheet', () => {
  const workbook = XLSX.utils.book_new();
  const sheet1 = XLSX.utils.aoa_to_sheet([
    ['timestamp', 'import_kwh', 'export_kwh'],
    ['2026-01-01T00:00:00+01:00', 0.1, 0]
  ]);
  const sheet2 = XLSX.utils.aoa_to_sheet([['irrelevant']]);
  XLSX.utils.book_append_sheet(workbook, sheet1, 'Eerste');
  XLSX.utils.book_append_sheet(workbook, sheet2, 'Tweede');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const { csvText, sheetCount, usedSheetName } = convertXlsxToCsvText(new Uint8Array(bytes));

  assert.equal(sheetCount, 2);
  assert.equal(usedSheetName, 'Eerste');
  assert.match(csvText, /^timestamp,import_kwh,export_kwh/);
});

test('unrecognized headers in an xlsx file fail the same way as an unrecognized csv', () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['time', 'kwh'],
    ['2026-01-01', 1]
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Blad1');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const { csvText } = convertXlsxToCsvText(new Uint8Array(bytes));
  assert.throws(() => detectFormat(csvText), /onherkend bestandsformat/i);
});

test('throws a clear error for a corrupt xlsx file', () => {
  // Geldige xlsx-signatuur (PK-zip magic bytes), maar afgekapt/beschadigd archief.
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0xff, 0xff, 0x01, 0x02, 0x03]);
  assert.throws(() => convertXlsxToCsvText(bytes), /kan het xlsx-bestand niet lezen/i);
});

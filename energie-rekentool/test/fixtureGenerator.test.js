import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateHomeWizardFixtureCsv } from '../src/core/fixtureGenerator.js';
import { HOMEWIZARD_HEADER, parseHomeWizardCsv, toIntervalReadings } from '../src/core/homewizardCsv.js';
import { computeCoverageSummary } from '../src/core/validate.js';

test('produces the exact HomeWizard header', () => {
  const csv = generateHomeWizardFixtureCsv({ days: 1 });
  assert.equal(csv.split('\n')[0], HOMEWIZARD_HEADER);
});

test('is deterministic for a given seed', () => {
  const a = generateHomeWizardFixtureCsv({ days: 2, seed: 123 });
  const b = generateHomeWizardFixtureCsv({ days: 2, seed: 123 });
  assert.equal(a, b);
});

test('different seeds produce different data', () => {
  const a = generateHomeWizardFixtureCsv({ days: 2, seed: 1 });
  const b = generateHomeWizardFixtureCsv({ days: 2, seed: 2 });
  assert.notEqual(a, b);
});

test('row count is intervalCount + 1 (baseline row) for a day at 15-minute resolution', () => {
  const csv = generateHomeWizardFixtureCsv({ days: 1, intervalMinutes: 15 });
  const dataRows = csv.trim().split('\n').length - 1;
  assert.equal(dataRows, 97); // baseline + 96 kwartieren
});

test('supports an arbitrary period length, from a day to a year, and hourly resolution', () => {
  const oneDay = generateHomeWizardFixtureCsv({ days: 1, intervalMinutes: 60 });
  assert.equal(oneDay.trim().split('\n').length - 1, 25); // baseline + 24 uur

  const oneYear = generateHomeWizardFixtureCsv({ days: 365, intervalMinutes: 15 });
  assert.equal(oneYear.trim().split('\n').length - 1, 365 * 96 + 1);
});

test('meter readings are strictly non-decreasing (never corrupt by construction)', () => {
  const csv = generateHomeWizardFixtureCsv({ days: 3, seed: 9 });
  const rows = parseHomeWizardCsv(csv);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].importT1Kwh >= rows[i - 1].importT1Kwh);
    assert.ok(rows[i].exportT1Kwh >= rows[i - 1].exportT1Kwh);
  }
});

test('generated fixture normalizes cleanly with no warnings and no gaps', () => {
  const csv = generateHomeWizardFixtureCsv({ startDate: '2025-06-15', days: 1, seed: 7 });
  const rows = parseHomeWizardCsv(csv);
  const { intervals, warnings } = toIntervalReadings(rows);
  assert.equal(warnings.length, 0);

  const summary = computeCoverageSummary(intervals);
  assert.equal(summary.actualCount, 96);
  assert.equal(summary.missingCount, 0);
  assert.ok(summary.totalImportKwh > 0);
  assert.ok(summary.totalExportKwh > 0); // zonnecurve moet teruglevering veroorzaken
});

test('a year-long fixture crosses both DST transitions without colliding or duplicate timestamps', () => {
  const csv = generateHomeWizardFixtureCsv({ startDate: '2025-01-01', days: 365, seed: 3 });
  const rows = parseHomeWizardCsv(csv);
  const { intervals, warnings } = toIntervalReadings(rows);
  assert.equal(warnings.length, 0);

  // computeCoverageSummary zelf gooit al bij dubbele timestamps; als dat niet
  // gebeurt, weten we dat de DST-overgangen correct zijn opgelost.
  const summary = computeCoverageSummary(intervals);
  assert.equal(summary.actualCount, intervals.length);

  const offsets = intervals.map((iv) => iv.timestamp.slice(-6));
  assert.ok(offsets.includes('+01:00'), 'verwacht CET-tijdstippen in de winter');
  assert.ok(offsets.includes('+02:00'), 'verwacht CEST-tijdstippen in de zomer');
});

test('produces a solar export bump around midday and near-zero solar at night', () => {
  const csv = generateHomeWizardFixtureCsv({ startDate: '2025-06-15', days: 1, seed: 7, householdBaseKw: 0 });
  const rows = parseHomeWizardCsv(csv);
  const { intervals } = toIntervalReadings(rows);

  const byHour = (h) => intervals.find((iv) => iv.timestamp.includes(`T${String(h).padStart(2, '0')}:`));
  const midday = byHour(13);
  const midnight = byHour(2);

  assert.ok(midday.exportKwh > 0, 'expected solar export around midday');
  assert.equal(midnight.exportKwh, 0); // geen zon om 02:00
  assert.ok(midnight.importKwh > 0); // baseload > 0, dus netto afname
});

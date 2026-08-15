import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTariffDefaultsFreshness } from '../src/core/tariffDefaultsFreshness.js';

function config(overrides = {}) {
  return {
    velden: {
      currentContractType: { waarde: 'vast' }, // geen peildatum: moet genegeerd worden
      currentSupplyRateInclVatEurPerKwh: { waarde: 0.28, peildatum: '2026-08-01' },
      ...overrides
    }
  };
}

test('reports fresh when all dated fields are within 42 days', () => {
  const now = Date.parse('2026-08-15T00:00:00Z');
  const result = checkTariffDefaultsFreshness(config(), now);
  assert.equal(result.isStale, false);
  assert.deepEqual(result.staleFields, []);
});

test('flags a field older than 42 days as stale, with age in days', () => {
  // peildatum 2026-05-01; 2026-08-15 is 106 dagen later.
  const now = Date.parse('2026-08-15T00:00:00Z');
  const result = checkTariffDefaultsFreshness(
    config({ dynamicMarkupEurPerKwh: { waarde: 0.02, peildatum: '2026-05-01' } }),
    now,
    42
  );
  assert.equal(result.isStale, true);
  assert.equal(result.staleFields.length, 1);
  assert.equal(result.staleFields[0].field, 'dynamicMarkupEurPerKwh');
  assert.equal(result.staleFields[0].ageDays, 106);
});

test('ignores fields without a peildatum (e.g. currentContractType)', () => {
  const now = Date.parse('2030-01-01T00:00:00Z'); // ver in de toekomst
  const result = checkTariffDefaultsFreshness(config(), now);
  assert.equal(result.staleFields.some((f) => f.field === 'currentContractType'), false);
});

test('respects a custom maxAgeDays threshold', () => {
  const now = Date.parse('2026-08-15T00:00:00Z'); // 14 dagen na 2026-08-01
  const strict = checkTariffDefaultsFreshness(config(), now, 10);
  assert.equal(strict.isStale, true);
  assert.ok(strict.staleFields.some((f) => f.field === 'currentSupplyRateInclVatEurPerKwh'));

  const lenient = checkTariffDefaultsFreshness(config(), now, 20);
  assert.equal(lenient.staleFields.some((f) => f.field === 'currentSupplyRateInclVatEurPerKwh'), false);
});

test('exactly at the threshold is not yet stale (strictly greater-than)', () => {
  const peildatum = '2026-06-01';
  const now = Date.parse('2026-06-01T00:00:00Z') + 42 * 86400000;
  const result = checkTariffDefaultsFreshness(
    { velden: { x: { waarde: 1, peildatum } } },
    now,
    42
  );
  assert.equal(result.isStale, false);
});

test('throws on an unparseable peildatum', () => {
  assert.throws(
    () => checkTariffDefaultsFreshness({ velden: { x: { waarde: 1, peildatum: '01-06-2026' } } }, Date.now()),
    /ongeldige peildatum/i
  );
});

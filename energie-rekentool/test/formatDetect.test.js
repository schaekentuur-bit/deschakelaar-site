import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat } from '../src/core/formatDetect.js';
import { HOMEWIZARD_HEADER } from '../src/core/homewizardCsv.js';
import { INTERNAL_HEADER } from '../src/core/internalCsv.js';

test('recognizes a HomeWizard export', () => {
  assert.equal(detectFormat(`${HOMEWIZARD_HEADER}\nfoo\n`), 'homewizard');
});

test('recognizes the internal format', () => {
  assert.equal(detectFormat(`${INTERNAL_HEADER}\nfoo\n`), 'internal');
});

test('rejects an unrecognized header instead of guessing', () => {
  assert.throws(() => detectFormat('time,kwh\nfoo\n'), /onherkend bestandsformat/i);
});

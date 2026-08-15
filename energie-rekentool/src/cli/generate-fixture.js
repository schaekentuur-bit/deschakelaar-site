#!/usr/bin/env node
// Dunne CLI-schil: leest argv, schrijft naar schijf. Alle logica staat in core/.
'use strict';

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateHomeWizardFixtureCsv } from '../core/fixtureGenerator.js';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    opts[key] = value;
    i++;
  }
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out || 'fixtures/synthetisch-1-dag.csv';
  const startDate = args.start || '2025-06-01';
  const days = args.days ? Number(args.days) : 1;
  const intervalMinutes = args.interval ? Number(args.interval) : 15;
  const seed = args.seed ? Number(args.seed) : 42;

  const csv = generateHomeWizardFixtureCsv({ startDate, days, intervalMinutes, seed });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, csv, 'utf8');
  const rowCount = csv.trim().split('\n').length - 1;
  console.log(`Geschreven: ${out} (${rowCount} rijen, start ${startDate}, ${days} dag(en), interval ${intervalMinutes} min)`);
}

main();

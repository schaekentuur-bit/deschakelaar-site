#!/usr/bin/env node
// Dunne CLI-schil rond core/tariffDefaultsFreshness.js. Waarschuwt zichtbaar
// en faalt (exit 1) zodra een peildatum in config/tariff-defaults.json ouder
// is dan 6 weken. Handmatig te draaien, en wordt ook aangeroepen door de
// maandelijkse reminder-Action zodat de aangemaakte issue meteen de actuele
// status toont.
'use strict';

import { readFileSync } from 'node:fs';
import { checkTariffDefaultsFreshness } from '../core/tariffDefaultsFreshness.js';

const CONFIG_PATH = 'config/tariff-defaults.json';

function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const result = checkTariffDefaultsFreshness(config, Date.now());

  if (!result.isStale) {
    console.log(`Alle gedateerde velden in ${CONFIG_PATH} zijn binnen ${result.maxAgeDays} dagen bijgewerkt.`);
    return;
  }

  console.log(`::error::${result.staleFields.length} veld(en) in ${CONFIG_PATH} zijn ouder dan ${result.maxAgeDays} dagen:`);
  for (const f of result.staleFields) {
    console.log(`::error::  - ${f.field}: peildatum ${f.peildatum} (${f.ageDays} dagen oud)`);
  }
  console.log(`\nWerk deze velden bij met een actuele bron en peildatum in ${CONFIG_PATH}.`);
  process.exitCode = 1;
}

main();

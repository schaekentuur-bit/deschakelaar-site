#!/usr/bin/env node
// Genereert de markdown-body voor de maandelijkse reminder-issue (zie
// .github/workflows/monthly-tariff-defaults-reminder.yml). Print naar
// stdout, zodat de workflow dit rechtstreeks aan `gh issue create` kan geven.
'use strict';

import { readFileSync } from 'node:fs';
import { checkTariffDefaultsFreshness } from '../core/tariffDefaultsFreshness.js';

const CONFIG_PATH = 'config/tariff-defaults.json';

function eur(n) {
  return `€${n}`;
}

function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const freshness = checkTariffDefaultsFreshness(config, Date.now());

  const lines = [];
  lines.push('Maandelijkse controle van de marktgemiddelden in `config/tariff-defaults.json`.');
  lines.push('Werk elk veld bij op basis van een actuele bron en zet de nieuwe waarde, bron-URL en peildatum erbij.');
  lines.push('');

  if (freshness.isStale) {
    lines.push(`> [!WARNING]`);
    lines.push(
      `> ${freshness.staleFields.length} veld(en) zijn nu al ouder dan ${freshness.maxAgeDays} dagen: ` +
        freshness.staleFields.map((f) => `\`${f.field}\` (${f.ageDays}d)`).join(', ')
    );
  } else {
    lines.push('Alle velden zijn op dit moment nog binnen 6 weken bijgewerkt.');
  }
  lines.push('');

  for (const [field, info] of Object.entries(config.velden || {})) {
    if (!info.peildatum) continue; // bv. currentContractType: geen marktgemiddelde
    const waarde = typeof info.waarde === 'number' ? eur(info.waarde) : info.waarde;
    lines.push(`- [ ] \`${field}\` — huidig: ${waarde} (bron: ${info.bron}, peildatum: ${info.peildatum})`);
  }

  lines.push('');
  lines.push('Zie `energie-rekentool/config/tariff-defaults.json` voor het volledige bestand en het formaat.');

  console.log(lines.join('\n'));
}

main();

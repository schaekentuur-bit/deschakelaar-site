'use strict';

import { HOMEWIZARD_HEADER } from './homewizardCsv.js';
import { INTERNAL_HEADER } from './internalCsv.js';

/** Herkent aan de hand van de kopregel welk format een bestand heeft. Geen automatische herkenning van andere leveranciersformaten. */
export function detectFormat(csvText) {
  const firstLine = csvText.replace(/\r\n/g, '\n').split('\n')[0]?.trim();
  if (firstLine === HOMEWIZARD_HEADER) return 'homewizard';
  if (firstLine === INTERNAL_HEADER) return 'internal';
  throw new Error(
    'Onherkend bestandsformat: kopregel komt niet overeen met de HomeWizard-export of het interne format.\n' +
      `Verwacht een van:\n  ${HOMEWIZARD_HEADER}\n  ${INTERNAL_HEADER}\n` +
      `Gevonden:\n  ${firstLine}`
  );
}

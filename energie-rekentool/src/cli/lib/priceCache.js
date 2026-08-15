// Node-specifiek (fs): lokale cache van opgehaalde prijzen, zodat herhaald
// rekenen op dezelfde periode geen nieuwe API-calls oplevert. Cachebestanden
// zijn gewoon geldige core/priceCsv.js-bestanden.
'use strict';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePriceCsv, serializePriceCsv } from '../../core/priceCsv.js';

function cacheFileName(fromDateUtcIso, tillDateUtcIso, inclBtw) {
  const safe = (s) => s.replace(/[:.]/g, '-');
  return `energyzero_${safe(fromDateUtcIso)}_${safe(tillDateUtcIso)}_btw-${inclBtw}.csv`;
}

export function readPriceCache(cacheDir, fromDateUtcIso, tillDateUtcIso, inclBtw) {
  const path = join(cacheDir, cacheFileName(fromDateUtcIso, tillDateUtcIso, inclBtw));
  if (!existsSync(path)) return null;
  return { path, prices: parsePriceCsv(readFileSync(path, 'utf8')) };
}

export function writePriceCache(cacheDir, fromDateUtcIso, tillDateUtcIso, inclBtw, prices) {
  mkdirSync(cacheDir, { recursive: true });
  const path = join(cacheDir, cacheFileName(fromDateUtcIso, tillDateUtcIso, inclBtw));
  writeFileSync(path, serializePriceCsv(prices), 'utf8');
  return path;
}

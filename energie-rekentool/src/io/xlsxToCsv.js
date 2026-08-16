// Dunne omzetstap, geen tweede parser: zet de eerste sheet van een xlsx-
// werkboek om naar exact dezelfde tekstuele CSV-structuur die
// core/homewizardCsv.js en core/internalCsv.js al verwachten, en geeft die
// string door. formatDetect.js en de bestaande parsers blijven ongewijzigd —
// dit is de ENIGE plek die xlsx-specifiek is.
//
// Bewust NIET in src/core/: core/ blijft vrij van derdepartij-
// afhankelijkheden. Deze module gebruikt de "xlsx"-bibliotheek (SheetJS),
// met dezelfde bare-specifier-import in Node (via node_modules) en de
// browser (via een importmap naar een lokaal gevendorde kopie van
// node_modules/xlsx/xlsx.mjs — zelfde bestand, dus aantoonbaar identiek
// gedrag in beide omgevingen, geverifieerd met tests in beide contexten).
//
// LET OP: npm's publieke "xlsx"-pakket staat vast op een oudere, kwetsbare
// versie (prototype pollution + ReDoS via een kwaadaardig bestand — precies
// ons dreigingsmodel, aangeleverde bestanden van een klant). De gepatchte
// versie (0.20.3+) is alleen te installeren via SheetJS' eigen cdn.sheetjs.com
// (officieel aanbevolen workaround voor het verlaten npm-registrypakket, niet
// een ad-hoc omweg): "npm install --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz".
'use strict';

import * as XLSX from 'xlsx';

// Reconstrueert "YYYY-MM-DD HH:MM"-achtige tekst uit een eventuele native
// Excel-datumcel. Tekstcellen (het gangbare geval — zowel ons eigen
// gegenereerde template als een handmatig ingevuld bestand met de tijd als
// tekst) worden hierdoor niet geraakt; alleen een echte datumcel wordt
// herschreven. Excel-datums kennen geen tijdzone-offset, dus dit helpt niet
// voor het interne format se "+HH:MM"-staart — dat format vereist tekstcellen.
const CSV_OPTIONS = { blankrows: false, dateNF: 'yyyy-mm-dd hh:mm' };

/**
 * @param {Uint8Array} bytes - de ruwe inhoud van het xlsx-bestand
 * @returns {{ csvText: string, sheetCount: number, usedSheetName: string }}
 */
export function convertXlsxToCsvText(bytes) {
  let workbook;
  try {
    workbook = XLSX.read(bytes, { type: 'array' });
  } catch (err) {
    throw new Error(`Kan het xlsx-bestand niet lezen: ${err.message}`);
  }

  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error('Het xlsx-bestand bevat geen sheets.');
  }

  const usedSheetName = sheetNames[0];
  const sheet = workbook.Sheets[usedSheetName];
  const csvText = XLSX.utils.sheet_to_csv(sheet, CSV_OPTIONS).replace(/\r\n/g, '\n');

  return { csvText, sheetCount: sheetNames.length, usedSheetName };
}

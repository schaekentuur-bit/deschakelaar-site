// Pure functies: string in, data uit. Geen fs/netwerk hier — dat hoort in de CLI-laag.
'use strict';

import { localAmsterdamWallTimesToIso } from './amsterdamTime.js';

export const HOMEWIZARD_HEADER =
  'time,Import T1 kWh,Import T2 kWh,Export T1 kWh,Export T2 kWh,L1 max W,L2 max W,L3 max W';

function splitLines(csvText) {
  return csvText.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim() !== '');
}

// Een leeg veld (na trim) betekent "niet gemeten" (bv. de HomeWizard-dongle was
// offline) en wordt null, niet 0 — Number('') levert in JS 0 op, wat een
// ontbrekende meting zou laten doorgaan als een echte meterstand van nul en
// de dalende-meterstand-check in toIntervalReadings() zou laten afgaan op een
// vals-positieve "corrupt bestand"-fout in plaats van een normaal gat.
function parseNullableNumber(value, context) {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error(`Ongeldige numerieke waarde "${value}" (${context})`);
  }
  return n;
}

/**
 * Parseert de ruwe HomeWizard-CSV-tekst naar rijen met cumulatieve meterstanden.
 * Doet geen normalisatie/diffing — dat is toIntervalReadings().
 */
export function parseHomeWizardCsv(csvText) {
  const lines = splitLines(csvText);
  if (lines.length === 0) {
    throw new Error('Leeg bestand: geen data gevonden');
  }
  const header = lines[0].trim();
  if (header !== HOMEWIZARD_HEADER) {
    throw new Error(
      `Onverwachte kopregel. Verwacht:\n  ${HOMEWIZARD_HEADER}\nGevonden:\n  ${header}`
    );
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const cols = lines[i].split(',');
    if (cols.length !== 8) {
      throw new Error(`Regel ${lineNumber}: verwacht 8 kolommen, gevonden ${cols.length}`);
    }
    const [time, importT1, importT2, exportT1, exportT2, l1MaxW, l2MaxW, l3MaxW] = cols;
    rows.push({
      lineNumber,
      time: time.trim(),
      importT1Kwh: parseNullableNumber(importT1, `regel ${lineNumber}, Import T1 kWh`),
      importT2Kwh: parseNullableNumber(importT2, `regel ${lineNumber}, Import T2 kWh`),
      exportT1Kwh: parseNullableNumber(exportT1, `regel ${lineNumber}, Export T1 kWh`),
      exportT2Kwh: parseNullableNumber(exportT2, `regel ${lineNumber}, Export T2 kWh`),
      l1MaxW: parseNullableNumber(l1MaxW, `regel ${lineNumber}, L1 max W`),
      l2MaxW: parseNullableNumber(l2MaxW, `regel ${lineNumber}, L2 max W`),
      l3MaxW: parseNullableNumber(l3MaxW, `regel ${lineNumber}, L3 max W`)
    });
  }
  if (rows.length < 2) {
    throw new Error('Te weinig rijen: minstens 2 meterstanden nodig om één interval te kunnen afleiden');
  }
  return rows;
}

/**
 * Zet cumulatieve meterstand-rijen om in het interne format: per-interval
 * import/export in kWh, plus apart bewaarde momentane fase-vermogens.
 * De eerste rij is alleen de startmeterstand en levert geen interval op.
 *
 * Een interval met een ontbrekende (lege) meterstand aan weerskanten wordt
 * overgeslagen i.p.v. als 0 gerekend of als corrupt bestand geweigerd — het
 * telt zo vanzelf mee als gat in computeCoverageSummary() (validate.js). De
 * dalende-meterstand-check (corrupt bestand) loopt alleen over intervallen
 * waarvan beide meterstanden daadwerkelijk bekend zijn.
 *
 * Retourneert { intervals, phasePower, warnings }.
 */
export function toIntervalReadings(parsedRows) {
  const intervals = [];
  const phasePower = [];
  const warnings = [];

  // In één keer resolven over de hele, chronologisch gesorteerde reeks, zodat
  // het herhaalde wandklokuur bij de najaars-DST-overgang (bv. twee keer
  // "02:15") correct als twee verschillende instanten wordt herkend.
  const isoTimestamps = localAmsterdamWallTimesToIso(parsedRows.map((r) => r.time));

  for (let i = 1; i < parsedRows.length; i++) {
    const prev = parsedRows[i - 1];
    const curr = parsedRows[i];

    const channels = [
      ['Import T1 kWh', prev.importT1Kwh, curr.importT1Kwh],
      ['Import T2 kWh', prev.importT2Kwh, curr.importT2Kwh],
      ['Export T1 kWh', prev.exportT1Kwh, curr.exportT1Kwh],
      ['Export T2 kWh', prev.exportT2Kwh, curr.exportT2Kwh]
    ];

    // Een ontbrekende meterstand (leeg veld, null) aan weerskanten van dit
    // interval — bv. de HomeWizard-dongle was offline — betekent: dit
    // kwartier is niet gemeten, geen berekenbare delta. Dat is een gat, geen
    // corrupt bestand: het interval wordt overgeslagen (niet als 0 of als
    // dalende meterstand behandeld) en telt vanzelf mee in de bestaande
    // gatendetectie (computeCoverageSummary in validate.js), die ontbrekende
    // tijdstippen afleidt uit wat er wél in de intervals-array staat.
    const isMeasurable = channels.every(([, prevVal, currVal]) => prevVal !== null && currVal !== null);
    if (!isMeasurable) {
      continue;
    }

    for (const [label, prevVal, currVal] of channels) {
      if (currVal < prevVal) {
        throw new Error(
          `Corrupt bestand: dalende meterstand bij "${label}" op regel ${curr.lineNumber} ` +
            `(${curr.time}): ${prevVal} -> ${currVal}`
        );
      }
    }

    // Import en export mogen binnen hetzelfde kwartier allebei > 0 zijn (de
    // stroomrichting kan omslaan binnen het interval, bv. bij zonnepanelen) —
    // beide waarden worden ongewijzigd uit de bron overgenomen, niet gesaldeerd.
    const importKwh = curr.importT1Kwh + curr.importT2Kwh - (prev.importT1Kwh + prev.importT2Kwh);
    const exportKwh = curr.exportT1Kwh + curr.exportT2Kwh - (prev.exportT1Kwh + prev.exportT2Kwh);

    intervals.push({
      timestamp: isoTimestamps[i],
      importKwh,
      exportKwh
    });

    phasePower.push({
      timestamp: isoTimestamps[i],
      l1MaxW: curr.l1MaxW,
      l2MaxW: curr.l2MaxW,
      l3MaxW: curr.l3MaxW
    });
  }

  return { intervals, phasePower, warnings };
}

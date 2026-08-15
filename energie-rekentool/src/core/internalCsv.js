// Pure functies: string in, data uit.
'use strict';

export const INTERNAL_HEADER = 'timestamp,import_kwh,export_kwh';

function splitLines(csvText) {
  return csvText.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim() !== '');
}

/**
 * Parseert een bestand dat al in het interne format staat naar
 * { intervals, warnings }. import_kwh en export_kwh mogen binnen dezelfde rij
 * allebei > 0 zijn (de stroomrichting kan binnen een interval omslaan) en
 * worden ongewijzigd overgenomen.
 */
export function parseInternalCsv(csvText) {
  const lines = splitLines(csvText);
  if (lines.length === 0) {
    throw new Error('Leeg bestand: geen data gevonden');
  }
  const header = lines[0].trim();
  if (header !== INTERNAL_HEADER) {
    throw new Error(`Onverwachte kopregel. Verwacht:\n  ${INTERNAL_HEADER}\nGevonden:\n  ${header}`);
  }

  const intervals = [];
  const warnings = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const cols = lines[i].split(',');
    if (cols.length !== 3) {
      throw new Error(`Regel ${lineNumber}: verwacht 3 kolommen, gevonden ${cols.length}`);
    }
    const [timestampRaw, importRaw, exportRaw] = cols.map((c) => c.trim());

    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(timestampRaw)) {
      throw new Error(
        `Regel ${lineNumber}: timestamp "${timestampRaw}" is geen ISO 8601 met offset ` +
          '(verwacht "YYYY-MM-DDTHH:MM:SS+HH:MM")'
      );
    }

    const importKwh = Number(importRaw);
    const exportKwh = Number(exportRaw);
    if (!Number.isFinite(importKwh) || !Number.isFinite(exportKwh)) {
      throw new Error(`Regel ${lineNumber}: import_kwh/export_kwh moeten numeriek zijn`);
    }
    if (importKwh < 0 || exportKwh < 0) {
      throw new Error(
        `Corrupt bestand: negatieve waarde op regel ${lineNumber} (${timestampRaw}). ` +
          'import_kwh en export_kwh moeten altijd >= 0 zijn.'
      );
    }

    intervals.push({ timestamp: timestampRaw, importKwh, exportKwh });
  }

  return { intervals, warnings };
}

/** Serialiseert intervallen terug naar het interne CSV-format (o.a. handig voor tests/fixtures). */
export function serializeInternalCsv(intervals) {
  const lines = [INTERNAL_HEADER];
  for (const { timestamp, importKwh, exportKwh } of intervals) {
    lines.push(`${timestamp},${importKwh},${exportKwh}`);
  }
  return lines.join('\n') + '\n';
}

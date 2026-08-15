// Pure functies: string in, data uit. Zelfde canonieke format wordt gebruikt
// voor zowel de EnergyZero-cache als een handmatig aangeleverd prijsbestand,
// zodat beide bronnen door exact dezelfde code lopen.
'use strict';

export const PRICE_HEADER = 'timestamp,price_eur_kwh';

function splitLines(csvText) {
  return csvText.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim() !== '');
}

/**
 * Parseert een prijsbestand (timestamp,price_eur_kwh) naar
 * Array<{ timestamp, priceEurKwh }>. Prijzen mogen negatief zijn (dat is
 * geldige marktdata) en worden dus nooit op nul afgekapt of geweigerd.
 */
export function parsePriceCsv(csvText) {
  const lines = splitLines(csvText);
  if (lines.length === 0) {
    throw new Error('Leeg prijsbestand: geen data gevonden');
  }
  const header = lines[0].trim();
  if (header !== PRICE_HEADER) {
    throw new Error(`Onverwachte kopregel. Verwacht:\n  ${PRICE_HEADER}\nGevonden:\n  ${header}`);
  }

  const prices = [];
  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const cols = lines[i].split(',');
    if (cols.length !== 2) {
      throw new Error(`Regel ${lineNumber}: verwacht 2 kolommen, gevonden ${cols.length}`);
    }
    const [timestampRaw, priceRaw] = cols.map((c) => c.trim());

    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(timestampRaw)) {
      throw new Error(
        `Regel ${lineNumber}: timestamp "${timestampRaw}" is geen ISO 8601 met offset ` +
          '(verwacht "YYYY-MM-DDTHH:MM:SS+HH:MM")'
      );
    }

    const priceEurKwh = Number(priceRaw);
    if (!Number.isFinite(priceEurKwh)) {
      throw new Error(`Regel ${lineNumber}: price_eur_kwh moet numeriek zijn, gevonden "${priceRaw}"`);
    }

    prices.push({ timestamp: timestampRaw, priceEurKwh });
  }

  return prices;
}

/** Serialiseert prijspunten terug naar CSV (o.a. voor de lokale cache). */
export function serializePriceCsv(prices) {
  const lines = [PRICE_HEADER];
  for (const { timestamp, priceEurKwh } of prices) {
    lines.push(`${timestamp},${priceEurKwh}`);
  }
  return lines.join('\n') + '\n';
}

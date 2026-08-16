// Pure functie: data in, data uit. Geen Date.now() hier — "nu" komt als
// parameter binnen, zodat dit deterministisch getest kan worden en identiek
// werkt in Node (CLI) en de browser (pagina).
'use strict';

const DAY_MS = 86400000;
const DEFAULT_MAX_AGE_DAYS = 42; // 6 weken

/**
 * Controleert of de peildatum van elk (gedateerd) veld in het
 * tariff-defaults-configbestand niet ouder is dan maxAgeDays. Velden zonder
 * peildatum (zoals currentContractType, dat geen marktgemiddelde is) worden
 * genegeerd.
 *
 * Een veld mag in de config een eigen "maxAgeDays" meegeven om de standaard
 * te overschrijven (bijv. dynamicEnergyTaxEurPerKwh: energiebelastingtarieven
 * worden één keer per jaar op 1 januari vastgesteld en blijven het hele jaar
 * geldig, dus die verdient een jaarlijkse cadans in plaats van de 6-weken-
 * drempel die bedoeld is voor maandelijks bewegende marktgemiddelden).
 *
 * @param {object} config - de ingelezen tariff-defaults.json (met .velden)
 * @param {number} nowMs - huidige tijd in ms sinds epoch, door de aanroeper bepaald
 * @param {number} [maxAgeDays] - standaardwaarde, per veld overschrijfbaar via info.maxAgeDays
 * @returns {{ isStale: boolean, staleFields: Array<{field: string, peildatum: string, ageDays: number, maxAgeDays: number}>, maxAgeDays: number }}
 */
export function checkTariffDefaultsFreshness(config, nowMs, maxAgeDays = DEFAULT_MAX_AGE_DAYS) {
  const staleFields = [];

  for (const [field, info] of Object.entries(config.velden || {})) {
    if (!info || !info.peildatum) continue;
    const peildatumMs = Date.parse(`${info.peildatum}T00:00:00Z`);
    if (Number.isNaN(peildatumMs)) {
      throw new Error(`Ongeldige peildatum voor veld "${field}": "${info.peildatum}" (verwacht "YYYY-MM-DD")`);
    }
    const fieldMaxAgeDays = typeof info.maxAgeDays === 'number' ? info.maxAgeDays : maxAgeDays;
    const ageDays = Math.floor((nowMs - peildatumMs) / DAY_MS);
    if (ageDays > fieldMaxAgeDays) {
      staleFields.push({ field, peildatum: info.peildatum, ageDays, maxAgeDays: fieldMaxAgeDays });
    }
  }

  return {
    isStale: staleFields.length > 0,
    staleFields,
    maxAgeDays
  };
}

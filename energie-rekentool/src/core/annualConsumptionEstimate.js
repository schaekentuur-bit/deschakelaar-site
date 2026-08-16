// Pure functie: dekkingssamenvatting (uit core/validate.js) in, een ruwe
// jaarindicatie van de afname uit. Bestaat voor precies één doel: inschatten
// of een klant richting de 10.000 kWh/jaar-grens van energiebelastingschijf
// 1+2 gaat (zie config/tariff-defaults.json, dynamicEnergyTaxEurPerKwh) — dit
// is GEEN kostenprognose en wordt nergens anders gebruikt (de rapportages
// rekenen bewust alleen over de gemeten periode, geen jaarindicatie).
'use strict';

const AVERAGE_DAYS_PER_YEAR = 365.2425;

/**
 * Extrapoleert de gemeten afname lineair naar een schatting per jaar: totale
 * afname over de gemeten periode gedeeld door het aantal gemeten dagen, keer
 * 365,2425. GEEN seizoenscorrectie — een zomermeting bij bijvoorbeeld een
 * woning met zonnepanelen (lage afname, hoge teruglevering in de zomer)
 * onderschat het werkelijke jaarverbruik fors, omdat de hogere winterafname
 * (verwarming, minder zon) niet wordt meegewogen. Voor het doel hier (een
 * ja/nee-grenswaarschuwing die liever te vroeg dan te laat afgaat) is dat
 * aanvaardbaar: onderschatting betekent in het slechtste geval een gemiste of
 * te late waarschuwing, nooit een onterechte. GEBRUIK DEZE FUNCTIE DAAROM
 * NERGENS ANDERS als serieuze jaarvoorspelling of kostenprognose — daarvoor is
 * dit te grof.
 *
 * @param {object} consumptionSummary - uit core/validate.js (computeCoverageSummary)
 * @param {string} consumptionSummary.firstTimestamp
 * @param {string} consumptionSummary.lastTimestamp
 * @param {number} consumptionSummary.intervalMinutes
 * @param {number} consumptionSummary.totalImportKwh
 * @returns {number} geëxtrapoleerd jaarverbruik in kWh
 */
export function estimateAnnualImportKwh(consumptionSummary) {
  const { firstTimestamp, lastTimestamp, intervalMinutes, totalImportKwh } = consumptionSummary;
  const periodMs = Date.parse(lastTimestamp) - Date.parse(firstTimestamp) + intervalMinutes * 60000;
  const periodDays = periodMs / 86400000;
  if (!(periodDays > 0)) {
    throw new Error(`Kan geen jaarindicatie extrapoleren: ongeldige periode (${periodDays} dagen)`);
  }
  return totalImportKwh * (AVERAGE_DAYS_PER_YEAR / periodDays);
}

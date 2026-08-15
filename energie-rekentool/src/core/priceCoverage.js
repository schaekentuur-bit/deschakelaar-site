// Pure functies: data in, samenvatting/foutmelding uit.
'use strict';

/**
 * Berekent de verplichte prijsdekking: hoeveel intervallen een prijs hebben,
 * en of dit een uurgemiddelde-benadering is i.p.v. echte kwartierprijzen.
 *
 * BEKENDE BEPERKING (nog niet opgelost): zowel EnergyZero als Frank Energie
 * zijn getest op kwartierprecisie (rond de markttransitie van oktober 2025 én
 * in augustus 2026) en leverden in beide gevallen alleen uurprijzen. Als
 * priceIntervalMinutes > consumptionIntervalMinutes is elke uurprijs dus
 * herhaald toegepast op alle kwartieren binnen dat uur — dit is een
 * benadering, geen echte kwartierprijs, en moet als zodanig zichtbaar blijven
 * in elke rapportage totdat er een betere bron gevonden wordt.
 */
export function computePriceCoverage({ matched, consumptionIntervalMinutes, priceIntervalMinutes }) {
  const totalCount = matched.length;
  const matchedCount = matched.filter((m) => m.priceEurKwh !== null).length;
  const missingCount = totalCount - matchedCount;
  const missingPercentage = totalCount === 0 ? 100 : (missingCount / totalCount) * 100;
  const isHourlyApproximation = priceIntervalMinutes > consumptionIntervalMinutes;

  return {
    totalCount,
    matchedCount,
    missingCount,
    missingPercentage,
    consumptionIntervalMinutes,
    priceIntervalMinutes,
    isHourlyApproximation,
    limitationNote: isHourlyApproximation
      ? 'BEKENDE BEPERKING (niet opgelost): geen van de geteste prijsbronnen (EnergyZero, Frank Energie) levert ' +
        `betrouwbare kwartierprijzen. Elke uurprijs is herhaald toegepast op alle ${
          priceIntervalMinutes / consumptionIntervalMinutes
        } kwartieren binnen dat uur — dit is een benadering, geen echte kwartierprijs.`
      : null
  };
}

/**
 * Weigert te rekenen als meer dan `maxMissingPercentage` procent van de
 * prijzen ontbreekt. Gooit een fout i.p.v. stilzwijgend door te rekenen met
 * een onvolledige dataset.
 */
export function assertPriceCoverageSufficient(coverage, maxMissingPercentage = 5) {
  if (coverage.missingPercentage > maxMissingPercentage) {
    throw new Error(
      `Te veel ontbrekende prijzen: ${coverage.missingPercentage.toFixed(2)}% van de intervallen heeft geen prijs ` +
        `(max ${maxMissingPercentage}%). Berekening geweigerd.`
    );
  }
}

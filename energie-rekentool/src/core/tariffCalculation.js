// Pure functie: verbruik+prijs (uit stap 1/2) en een tarievenset in, een
// scenariovergelijking uit. Geen fs/netwerk — tarieven zijn een parameter,
// nergens hardcoded.
'use strict';

import { detectIntervalMs } from './amsterdamTime.js';

// Gregoriaans gemiddelde maandlengte, voor het prorateren van vaste
// maandkosten over een gemeten periode van willekeurige lengte (dag t/m jaar).
const AVERAGE_DAYS_PER_MONTH = 365.2425 / 12;

const REQUIRED_NUMERIC_TARIFF_FIELDS = [
  'currentSupplyRateInclVatEurPerKwh',
  'currentFeedInRateEurPerKwh',
  'currentFixedFeedInCostsPerMonth',
  'dynamicMarkupEurPerKwh',
  'dynamicFeedInMarkupEurPerKwh',
  'currentFixedSupplyCostsPerMonth',
  'dynamicFixedSupplyCostsPerMonth'
];

function validateTariffs(tariffs) {
  if (tariffs.currentContractType !== 'vast' && tariffs.currentContractType !== 'variabel') {
    throw new Error(
      `Tarief "currentContractType" moet "vast" of "variabel" zijn (gevonden: ${tariffs.currentContractType})`
    );
  }
  for (const field of REQUIRED_NUMERIC_TARIFF_FIELDS) {
    const value = tariffs[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Tarief "${field}" ontbreekt of is geen geldig getal (gevonden: ${value})`);
    }
  }
}

/**
 * Berekent, per interval en gesommeerd over de hele periode, wat de klant
 * onder het dynamische scenario had betaald tegenover het huidige contract.
 *
 * Dynamisch, per interval:
 *   kosten = importKwh * (spotprijs + dynamicMarkupEurPerKwh)
 *          - exportKwh * (spotprijs - dynamicFeedInMarkupEurPerKwh)
 * Huidig (vast/variabel), per interval:
 *   kosten = importKwh * currentSupplyRateInclVatEurPerKwh
 *          - exportKwh * currentFeedInRateEurPerKwh
 *
 * Een negatieve spotprijs werkt hierdoor vanzelf correct door: teruglevering
 * bij een negatieve prijs (spotprijs - opslag wordt dan nóg negatiever) kost
 * geld in plaats van dat het oplevert. Nergens wordt op nul afgekapt.
 *
 * Vaste maandkosten worden geprorateerd over de exacte lengte van de gemeten
 * periode (AVERAGE_DAYS_PER_MONTH), niet over een aangenomen vaste maand.
 *
 * @param {Array<{timestamp: string, importKwh: number, exportKwh: number, priceEurKwh: number|null}>} matchedIntervals
 * @param {object} tariffs
 * @param {'vast'|'variabel'} tariffs.currentContractType - alleen label, geen invloed op de formule
 * @param {number} tariffs.currentSupplyRateInclVatEurPerKwh
 * @param {number} tariffs.currentFeedInRateEurPerKwh
 * @param {number} tariffs.currentFixedFeedInCostsPerMonth
 * @param {number} tariffs.dynamicMarkupEurPerKwh
 * @param {number} tariffs.dynamicFeedInMarkupEurPerKwh
 * @param {number} tariffs.currentFixedSupplyCostsPerMonth
 * @param {number} tariffs.dynamicFixedSupplyCostsPerMonth
 */
export function calculateScenarioComparison(matchedIntervals, tariffs) {
  validateTariffs(tariffs);
  if (matchedIntervals.length === 0) {
    throw new Error('Geen intervallen om te berekenen');
  }

  const timestampsMs = matchedIntervals.map((iv) => Date.parse(iv.timestamp)).sort((a, b) => a - b);
  const intervalMs = detectIntervalMs(timestampsMs);
  const periodDays = (timestampsMs[timestampsMs.length - 1] - timestampsMs[0] + intervalMs) / 86400000;
  const prorationFactor = periodDays / AVERAGE_DAYS_PER_MONTH;

  let dynamicVariableCostEur = 0;
  let currentVariableCostEur = 0;
  let missingPriceCount = 0;

  const perInterval = matchedIntervals.map((iv) => {
    if (iv.priceEurKwh === null || iv.priceEurKwh === undefined) {
      missingPriceCount++;
      return { ...iv, dynamicCostEur: null, currentCostEur: null };
    }

    const dynamicImportPriceEurKwh = iv.priceEurKwh + tariffs.dynamicMarkupEurPerKwh;
    const dynamicFeedInPriceEurKwh = iv.priceEurKwh - tariffs.dynamicFeedInMarkupEurPerKwh;
    const dynamicCostEur = iv.importKwh * dynamicImportPriceEurKwh - iv.exportKwh * dynamicFeedInPriceEurKwh;

    const currentCostEur =
      iv.importKwh * tariffs.currentSupplyRateInclVatEurPerKwh - iv.exportKwh * tariffs.currentFeedInRateEurPerKwh;

    dynamicVariableCostEur += dynamicCostEur;
    currentVariableCostEur += currentCostEur;

    return { ...iv, dynamicCostEur, currentCostEur };
  });

  if (missingPriceCount > 0) {
    throw new Error(
      `Kan niet rekenen: ${missingPriceCount} interval(len) hebben geen gekoppelde prijs. ` +
        'Los dit eerst op via de prijskoppeling (stap 2) voordat je opnieuw rekent.'
    );
  }

  const dynamicFixedCostEur = tariffs.dynamicFixedSupplyCostsPerMonth * prorationFactor;
  const currentFixedCostEur = tariffs.currentFixedSupplyCostsPerMonth * prorationFactor;
  const currentFixedFeedInCostEur = tariffs.currentFixedFeedInCostsPerMonth * prorationFactor;

  const dynamicTotalEur = dynamicVariableCostEur + dynamicFixedCostEur;
  const currentTotalEur = currentVariableCostEur + currentFixedCostEur + currentFixedFeedInCostEur;

  return {
    periodDays,
    intervalCount: matchedIntervals.length,
    tariffs,
    dynamic: {
      variableCostEur: dynamicVariableCostEur,
      fixedCostEur: dynamicFixedCostEur,
      totalEur: dynamicTotalEur
    },
    current: {
      variableCostEur: currentVariableCostEur,
      fixedCostEur: currentFixedCostEur,
      fixedFeedInCostEur: currentFixedFeedInCostEur,
      totalEur: currentTotalEur
    },
    // Positief: huidig contract kost meer dan dynamisch (overstappen bespaart).
    // Negatief: dynamisch kost meer dan huidig (overstappen kost extra).
    differenceEur: currentTotalEur - dynamicTotalEur,
    perInterval
  };
}

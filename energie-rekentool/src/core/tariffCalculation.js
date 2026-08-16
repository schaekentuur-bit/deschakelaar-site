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
  'currentFixedSupplyCostsPerMonth',
  'newSupplyRateInclVatEurPerKwh',
  'newFeedInRateEurPerKwh',
  'newFixedFeedInCostsPerMonth',
  'newFixedSupplyCostsPerMonth',
  'dynamicMarkupEurPerKwh',
  'dynamicFeedInMarkupEurPerKwh',
  'dynamicEnergyTaxEurPerKwh',
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

function periodDaysOf(matchedIntervals) {
  const timestampsMs = matchedIntervals.map((iv) => Date.parse(iv.timestamp)).sort((a, b) => a - b);
  const intervalMs = detectIntervalMs(timestampsMs);
  return (timestampsMs[timestampsMs.length - 1] - timestampsMs[0] + intervalMs) / 86400000;
}

/**
 * Herbruikbare berekening voor één vast-tariefscenario (huidig contract, of
 * een nieuw af te sluiten contract — zelfde formule, andere tarieven).
 * Per interval:
 *   kosten = importKwh * supplyRateInclVatEurPerKwh - exportKwh * feedInRateEurPerKwh
 * gesommeerd over de hele periode, plus geprorateerde vaste maandkosten.
 *
 * @param {Array<{importKwh: number, exportKwh: number}>} matchedIntervals
 * @param {object} fixedTariffs
 * @param {number} fixedTariffs.supplyRateInclVatEurPerKwh
 * @param {number} fixedTariffs.feedInRateEurPerKwh
 * @param {number} fixedTariffs.fixedFeedInCostsPerMonth
 * @param {number} fixedTariffs.fixedSupplyCostsPerMonth
 * @returns {{variableCostEur: number, fixedCostEur: number, fixedFeedInCostEur: number, totalEur: number}}
 */
export function calculateFixedContractTotal(matchedIntervals, fixedTariffs) {
  if (matchedIntervals.length === 0) {
    throw new Error('Geen intervallen om te berekenen');
  }
  const prorationFactor = periodDaysOf(matchedIntervals) / AVERAGE_DAYS_PER_MONTH;

  let variableCostEur = 0;
  for (const iv of matchedIntervals) {
    variableCostEur +=
      iv.importKwh * fixedTariffs.supplyRateInclVatEurPerKwh - iv.exportKwh * fixedTariffs.feedInRateEurPerKwh;
  }

  const fixedCostEur = fixedTariffs.fixedSupplyCostsPerMonth * prorationFactor;
  const fixedFeedInCostEur = fixedTariffs.fixedFeedInCostsPerMonth * prorationFactor;

  return {
    variableCostEur,
    fixedCostEur,
    fixedFeedInCostEur,
    totalEur: variableCostEur + fixedCostEur + fixedFeedInCostEur
  };
}

function compareScenarios(label, totalA, nameA, totalB, nameB) {
  const differenceEur = totalA - totalB;
  const cheaper = differenceEur > 0 ? nameB : differenceEur < 0 ? nameA : null;
  return { label, differenceEur, cheaper };
}

/**
 * Berekent, per interval en gesommeerd over de hele periode, drie scenario's:
 * het huidige vaste contract, een nieuw af te sluiten vast contract, en een
 * nieuw dynamisch contract — en drie onderlinge verschillen daartussen, zodat
 * niet zelf afgeleid hoeft te worden welk bedrag waarvoor staat.
 *
 * Vast (huidig én nieuw): zie calculateFixedContractTotal(), twee keer
 * aangeroepen met verschillende tarieven i.p.v. de logica te kopiëren.
 *
 * Dynamisch, per interval:
 *   kosten = importKwh * (spotprijs + dynamicMarkupEurPerKwh + dynamicEnergyTaxEurPerKwh)
 *          - exportKwh * (spotprijs - dynamicFeedInMarkupEurPerKwh)
 *
 * dynamicEnergyTaxEurPerKwh (energiebelasting) staat los van dynamicMarkupEurPerKwh
 * (leveranciersmarge): het is een overheidsheffing, geen leveranciersopslag, en
 * geldt alleen voor afname — nooit voor teruglevering (zie config/tariff-defaults.json
 * voor tarief, bron en de aanname over schijf 1+2 tot 10.000 kWh/jaar). Bij "huidig
 * vast" en "nieuw vast" wordt dit NIET los opgeteld: de klant vult daar een tarief in
 * dat hij al inclusief energiebelasting kent (currentSupplyRateInclVatEurPerKwh /
 * newSupplyRateInclVatEurPerKwh), dus die formule blijft ongewijzigd om niet dubbel te tellen.
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
 * @param {number} tariffs.currentFixedSupplyCostsPerMonth
 * @param {number} tariffs.newSupplyRateInclVatEurPerKwh
 * @param {number} tariffs.newFeedInRateEurPerKwh
 * @param {number} tariffs.newFixedFeedInCostsPerMonth
 * @param {number} tariffs.newFixedSupplyCostsPerMonth
 * @param {number} tariffs.dynamicMarkupEurPerKwh
 * @param {number} tariffs.dynamicFeedInMarkupEurPerKwh
 * @param {number} tariffs.dynamicEnergyTaxEurPerKwh - energiebelasting per kWh, alleen toegepast op afname
 * @param {number} tariffs.dynamicFixedSupplyCostsPerMonth
 */
export function calculateScenarioComparison(matchedIntervals, tariffs) {
  validateTariffs(tariffs);
  if (matchedIntervals.length === 0) {
    throw new Error('Geen intervallen om te berekenen');
  }

  const periodDays = periodDaysOf(matchedIntervals);
  const prorationFactor = periodDays / AVERAGE_DAYS_PER_MONTH;

  // Dynamisch scenario: ongewijzigd t.o.v. eerder. Enige scenario met een
  // spotprijs per interval, dus ook de enige plek waar een ontbrekende
  // prijskoppeling wordt gedetecteerd.
  let dynamicVariableCostEur = 0;
  let missingPriceCount = 0;
  const perInterval = matchedIntervals.map((iv) => {
    if (iv.priceEurKwh === null || iv.priceEurKwh === undefined) {
      missingPriceCount++;
      return { ...iv, dynamicCostEur: null };
    }

    const dynamicImportPriceEurKwh =
      iv.priceEurKwh + tariffs.dynamicMarkupEurPerKwh + tariffs.dynamicEnergyTaxEurPerKwh;
    const dynamicFeedInPriceEurKwh = iv.priceEurKwh - tariffs.dynamicFeedInMarkupEurPerKwh;
    const dynamicCostEur = iv.importKwh * dynamicImportPriceEurKwh - iv.exportKwh * dynamicFeedInPriceEurKwh;
    dynamicVariableCostEur += dynamicCostEur;

    return { ...iv, dynamicCostEur };
  });

  if (missingPriceCount > 0) {
    throw new Error(
      `Kan niet rekenen: ${missingPriceCount} interval(len) hebben geen gekoppelde prijs. ` +
        'Los dit eerst op via de prijskoppeling (stap 2) voordat je opnieuw rekent.'
    );
  }

  const dynamicFixedCostEur = tariffs.dynamicFixedSupplyCostsPerMonth * prorationFactor;
  const dynamic = {
    variableCostEur: dynamicVariableCostEur,
    fixedCostEur: dynamicFixedCostEur,
    totalEur: dynamicVariableCostEur + dynamicFixedCostEur
  };

  const current = calculateFixedContractTotal(matchedIntervals, {
    supplyRateInclVatEurPerKwh: tariffs.currentSupplyRateInclVatEurPerKwh,
    feedInRateEurPerKwh: tariffs.currentFeedInRateEurPerKwh,
    fixedFeedInCostsPerMonth: tariffs.currentFixedFeedInCostsPerMonth,
    fixedSupplyCostsPerMonth: tariffs.currentFixedSupplyCostsPerMonth
  });
  const newFixed = calculateFixedContractTotal(matchedIntervals, {
    supplyRateInclVatEurPerKwh: tariffs.newSupplyRateInclVatEurPerKwh,
    feedInRateEurPerKwh: tariffs.newFeedInRateEurPerKwh,
    fixedFeedInCostsPerMonth: tariffs.newFixedFeedInCostsPerMonth,
    fixedSupplyCostsPerMonth: tariffs.newFixedSupplyCostsPerMonth
  });

  return {
    periodDays,
    intervalCount: matchedIntervals.length,
    tariffs,
    current,
    newFixed,
    dynamic,
    // Elk verschil is totaalA - totaalB; "cheaper" noemt welk scenario van
    // het paar goedkoper uitvalt (of null bij een exact gelijk bedrag), zodat
    // de weergave niet zelf drie bedragen van elkaar hoeft af te trekken.
    comparisons: {
      currentVsNewFixed: compareScenarios(
        'Huidig vast contract vs. nieuw vast contract',
        current.totalEur,
        'current',
        newFixed.totalEur,
        'newFixed'
      ),
      currentVsDynamic: compareScenarios(
        'Huidig vast contract vs. nieuw dynamisch contract',
        current.totalEur,
        'current',
        dynamic.totalEur,
        'dynamic'
      ),
      newFixedVsDynamic: compareScenarios(
        'Nieuw vast contract vs. nieuw dynamisch contract',
        newFixed.totalEur,
        'newFixed',
        dynamic.totalEur,
        'dynamic'
      )
    },
    perInterval
  };
}

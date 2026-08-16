// Pure functie: data in, HTML-string uit. Geen fs/netwerk/Date.now() —
// generatedAt komt als parameter binnen zodat dit deterministisch en
// testbaar blijft (zelfde inputs -> zelfde output).
//
// Stijl is afgeleid van de bestaande "export-view" (ev-*) klassen in
// deschakelaar-financiële-situatieschets.html, zodat dit rapport visueel bij
// de rest van de site aansluit i.p.v. een losstaand ontwerp te introduceren.
'use strict';

import { buildConsumptionPriceChartSvg } from './chartSvg.js';

const SCENARIO_NAMES = {
  current: 'huidig vast contract',
  newFixed: 'nieuw vast contract',
  dynamic: 'nieuw dynamisch contract'
};

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function eur(n) {
  const sign = n < 0 ? '−' : '';
  return `${sign}€ ${Math.abs(n).toFixed(2)}`;
}

function pct(n) {
  return `${n.toFixed(2)}%`;
}

function evGrid(rows) {
  return `<div class="ev-grid">${rows
    .map(([label, value]) => `<div class="ev-row"><div class="ev-label">${esc(label)}</div><div class="ev-value">${value}</div></div>`)
    .join('')}</div>`;
}

function sectionHead(num, title) {
  return `<div class="ev-section-head"><div class="ev-snum">${num}</div><div class="ev-stitle">${esc(title)}</div></div>`;
}

/** Vertaalt één vergelijking (uit tariffCalculation.js) naar een leesbare zin, zodat niemand zelf hoeft af te trekken. */
function comparisonSentence(comparison) {
  if (comparison.cheaper === null) {
    return `${esc(comparison.label)}: geen verschil over deze periode.`;
  }
  const amount = eur(Math.abs(comparison.differenceEur));
  const cheaperName = SCENARIO_NAMES[comparison.cheaper];
  return `${esc(comparison.label)}: <strong>${esc(cheaperName)}</strong> is ${amount} goedkoper over deze periode.`;
}

/** Groen (het alternatief wint), neutraal in alle andere gevallen — incl. gelijkspel. */
function isAlternativeCheaper(key, comparison) {
  return key === 'currentVsNewFixed' ? comparison.cheaper === 'newFixed' : comparison.cheaper === 'dynamic';
}

/**
 * Bouwt het volledige, zelfstandige HTML-rapport: dekkingsgegevens (stap 1+2,
 * inclusief de EnergyZero-uurgemiddelde-beperking indien van toepassing),
 * alle gebruikte tariefvelden voor drie scenario's (huidig vast, nieuw vast,
 * nieuw dynamisch), de drie eindbedragen en de drie onderlinge verschillen,
 * en de verbruik/prijs-grafiek — alles in één oogopslag, zonder in de code
 * te hoeven kijken.
 *
 * @param {object} input
 * @param {string} input.generatedAt - ISO-timestamp, door de aanroeper bepaald
 * @param {string} input.consumptionPath
 * @param {string} input.format
 * @param {object} input.consumptionSummary - uit core/validate.js
 * @param {string[]} input.consumptionWarnings
 * @param {string} input.priceSource
 * @param {object} input.coverage - uit core/priceCoverage.js
 * @param {object} input.result - uit core/tariffCalculation.js (calculateScenarioComparison)
 * @returns {string} volledig HTML-document
 */
export function buildHtmlReport(input) {
  const { generatedAt, consumptionPath, format, consumptionSummary, consumptionWarnings, priceSource, coverage, result } =
    input;
  const { tariffs } = result;

  const chartSvg = buildConsumptionPriceChartSvg(result.perInterval);

  const limitationBox = coverage.limitationNote
    ? `<div class="ev-hint warn">&#9888; ${esc(coverage.limitationNote)}</div>`
    : '';

  const warningsBox =
    consumptionWarnings.length > 0
      ? `<div class="ev-hint warn">&#9888; ${consumptionWarnings.length} waarschuwing(en) bij het inlezen van het verbruiksbestand.</div>`
      : '';

  const dekkingRows = evGrid([
    ['Periode', `${esc(consumptionSummary.firstTimestamp)} t/m ${esc(consumptionSummary.lastTimestamp)} (${result.periodDays.toFixed(2)} dagen)`],
    ['Intervallen gevonden', `${consumptionSummary.actualCount} van ${consumptionSummary.expectedCount} verwacht (intervalduur: ${consumptionSummary.intervalMinutes} min)`],
    ['Ontbrekende intervallen (gaten)', `${consumptionSummary.missingCount} (${pct(consumptionSummary.missingPercentage)})`],
    ['Totale afname / teruglevering', `${consumptionSummary.totalImportKwh.toFixed(3)} kWh / ${consumptionSummary.totalExportKwh.toFixed(3)} kWh`],
    ['Prijsbron', esc(priceSource)],
    ['Prijsintervalduur', `${coverage.priceIntervalMinutes} min (verbruik: ${coverage.consumptionIntervalMinutes} min)`],
    ['Prijzen gekoppeld', `${coverage.matchedCount} van ${coverage.totalCount} intervallen (${pct(coverage.missingPercentage)} ontbreekt)`]
  ]);

  const currentTariefRows = evGrid([
    ['Contracttype', esc(tariffs.currentContractType)],
    ['Leveringstarief incl. btw', `${tariffs.currentSupplyRateInclVatEurPerKwh} EUR/kWh`],
    ['Terugleververgoeding', `${tariffs.currentFeedInRateEurPerKwh} EUR/kWh`],
    ['Vaste terugleverkosten', `${tariffs.currentFixedFeedInCostsPerMonth} EUR/maand`],
    ['Vaste leveringskosten', `${tariffs.currentFixedSupplyCostsPerMonth} EUR/maand`]
  ]);
  const newTariefRows = evGrid([
    ['Leveringstarief incl. btw', `${tariffs.newSupplyRateInclVatEurPerKwh} EUR/kWh`],
    ['Terugleververgoeding', `${tariffs.newFeedInRateEurPerKwh} EUR/kWh`],
    ['Vaste terugleverkosten', `${tariffs.newFixedFeedInCostsPerMonth} EUR/maand`],
    ['Vaste leveringskosten', `${tariffs.newFixedSupplyCostsPerMonth} EUR/maand`]
  ]);
  const dynamicTariefRows = evGrid([
    ['Opslag op afname', `${tariffs.dynamicMarkupEurPerKwh} EUR/kWh (bij de spotprijs opgeteld)`],
    ['Opslag op teruglevering', `${tariffs.dynamicFeedInMarkupEurPerKwh} EUR/kWh (van de spotprijs afgetrokken)`],
    ['Energiebelasting op afname', `${tariffs.dynamicEnergyTaxEurPerKwh} EUR/kWh (alleen bij afname, niet bij teruglevering)`],
    ['Vaste leveringskosten', `${tariffs.dynamicFixedSupplyCostsPerMonth} EUR/maand`]
  ]);

  const comparisonBoxes = Object.entries(result.comparisons)
    .map(
      ([key, comparison]) =>
        `<div class="ev-difference${isAlternativeCheaper(key, comparison) ? '' : ' neutral'}">${comparisonSentence(comparison)}</div>`
    )
    .join('');

  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<title>Energierapport — ${esc(consumptionPath)}</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html,body{background:#F7F8FA;color:#1B2E4B;font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.6;}
.wrap{max-width:820px;margin:0 auto;padding:1.5rem 1.25rem 3rem;}

.ev-topbar{background:#1B2E4B;border-radius:10px;padding:.95rem 1.35rem;margin-bottom:1.5rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;}
.ev-topbar-brand{font-family:'Syne',sans-serif;font-size:.56rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6DBF4A;margin-bottom:.16rem;}
.ev-topbar-title{font-family:'Syne',sans-serif;font-size:1.05rem;font-weight:700;color:#fff;line-height:1.2;}
.ev-topbar-date{font-size:.7rem;color:rgba(255,255,255,.4);text-align:right;}

.ev-section{background:#fff;border:.5px solid rgba(27,46,75,.14);border-radius:12px;padding:1.1rem 1.3rem 1.3rem;margin-bottom:1.1rem;}
.ev-section-head{display:flex;align-items:center;gap:.6rem;margin-bottom:.75rem;}
.ev-snum{width:24px;height:24px;border-radius:50%;background:rgba(109,191,74,.10);border:.5px solid rgba(109,191,74,.28);display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-size:.62rem;font-weight:700;color:#6DBF4A;flex-shrink:0;}
.ev-stitle{font-family:'Syne',sans-serif;font-size:.85rem;font-weight:700;color:#1B2E4B;flex:1;}
.ev-subhead{font-size:.62rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(27,46,75,.42);padding:.6rem 0 .3rem;border-top:.5px solid rgba(27,46,75,.08);margin-top:.2rem;}
.ev-subhead:first-of-type{border-top:none;margin-top:0;padding-top:0;}

.ev-grid{display:grid;grid-template-columns:1fr 1fr;gap:.2rem 1rem;}
.ev-row{padding:.32rem .5rem;border-radius:5px;}
.ev-row:nth-child(odd){background:rgba(27,46,75,.03);}
.ev-label{font-size:.62rem;font-weight:500;letter-spacing:.05em;text-transform:uppercase;color:rgba(27,46,75,.42);margin-bottom:.1rem;}
.ev-value{font-size:.85rem;color:#1B2E4B;}

.ev-hint{font-size:.8rem;line-height:1.55;padding:.6rem .85rem;background:rgba(109,191,74,.10);border-left:2.5px solid #6DBF4A;border-radius:0 7px 7px 0;margin-top:.85rem;color:rgba(27,46,75,.7);}
.ev-hint.warn{background:rgba(229,160,0,.08);border-left-color:#e5a000;}

.ev-footnote{font-size:.75rem;color:rgba(27,46,75,.45);margin-top:.7rem;line-height:1.5;}

.ev-result-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.7rem;margin-top:.2rem;}
.ev-rcard{background:#fff;border:1px solid rgba(27,46,75,.12);border-top:3px solid rgba(27,46,75,.14);border-radius:9px;padding:.85rem 1rem;}
.ev-rcard.total{border-top-color:#1B2E4B;background:rgba(27,46,75,.03);}
.ev-rc-label{font-size:.62rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:rgba(27,46,75,.4);margin-bottom:.3rem;}
.ev-rc-val{font-family:'Syne',sans-serif;font-size:1.25rem;font-weight:700;color:#1B2E4B;line-height:1.1;}
.ev-rc-sub{font-size:.66rem;color:rgba(27,46,75,.4);margin-top:.25rem;line-height:1.4;}

.ev-comparisons{display:flex;flex-direction:column;gap:.5rem;margin-top:.9rem;}
.ev-difference{background:rgba(109,191,74,.10);border:.5px solid rgba(109,191,74,.28);border-radius:9px;padding:.65rem .9rem;font-size:.85rem;color:rgba(27,46,75,.75);}
.ev-difference.neutral{background:rgba(27,46,75,.04);border-color:rgba(27,46,75,.12);}
.ev-difference strong{color:#3a8820;font-family:'Syne',sans-serif;}
.ev-difference.neutral strong{color:#1B2E4B;}

.chart-wrap{overflow-x:auto;margin-top:.2rem;}

.ev-footer{margin-top:1.4rem;padding-top:.7rem;border-top:.5px solid rgba(27,46,75,.10);font-size:.65rem;color:rgba(27,46,75,.35);}

@media(max-width:640px){
  .ev-grid,.ev-result-grid{grid-template-columns:1fr;}
  .wrap{padding:1rem .85rem 2.5rem;}
}
</style>
</head>
<body>
<div class="wrap">

  <div class="ev-topbar">
    <div>
      <div class="ev-topbar-brand">De Schakelaar</div>
      <div class="ev-topbar-title">Energierapport: huidig, nieuw vast en dynamisch contract</div>
    </div>
    <div class="ev-topbar-date">Gegenereerd op ${esc(generatedAt)}<br>${esc(consumptionPath)} &middot; ${esc(format)}</div>
  </div>

  <div class="ev-section">
    ${sectionHead('01', 'Dekking en aannames')}
    ${dekkingRows}
    ${limitationBox}
    ${warningsBox}
  </div>

  <div class="ev-section">
    ${sectionHead('02', 'Gebruikte tarieven (per klant aangeleverd)')}
    <div class="ev-subhead">Huidig contract (${esc(tariffs.currentContractType)})</div>
    ${currentTariefRows}
    <div class="ev-subhead">Nieuw vast contract</div>
    ${newTariefRows}
    <div class="ev-subhead">Nieuw dynamisch contract</div>
    ${dynamicTariefRows}
    <p class="ev-footnote">Vaste maandkosten zijn geprorateerd over de exacte gemeten periode (${result.periodDays.toFixed(2)} dagen, gemiddelde maandlengte 30,44 dagen), niet over een aangenomen vaste maand.</p>
  </div>

  <div class="ev-section">
    ${sectionHead('03', 'Resultaat over de gemeten periode')}
    <div class="ev-result-grid">
      <div class="ev-rcard">
        <div class="ev-rc-label">Huidig vast</div>
        <div class="ev-rc-val">${eur(result.current.totalEur)}</div>
        <div class="ev-rc-sub">variabel ${eur(result.current.variableCostEur)} + vast ${eur(result.current.fixedCostEur)} + terugleverkosten ${eur(result.current.fixedFeedInCostEur)}</div>
      </div>
      <div class="ev-rcard">
        <div class="ev-rc-label">Nieuw vast</div>
        <div class="ev-rc-val">${eur(result.newFixed.totalEur)}</div>
        <div class="ev-rc-sub">variabel ${eur(result.newFixed.variableCostEur)} + vast ${eur(result.newFixed.fixedCostEur)} + terugleverkosten ${eur(result.newFixed.fixedFeedInCostEur)}</div>
      </div>
      <div class="ev-rcard total">
        <div class="ev-rc-label">Nieuw dynamisch</div>
        <div class="ev-rc-val">${eur(result.dynamic.totalEur)}</div>
        <div class="ev-rc-sub">variabel ${eur(result.dynamic.variableCostEur)} + vast ${eur(result.dynamic.fixedCostEur)}</div>
      </div>
    </div>
    <div class="ev-comparisons">${comparisonBoxes}</div>
    <p class="ev-footnote">Dit zijn de bedragen over de gemeten periode, geen jaarindicatie. Een negatief bedrag betekent dat de teruglevering de afname overtreft: per saldo een tegoed in plaats van een rekening.</p>
  </div>

  <div class="ev-section">
    ${sectionHead('04', 'Verbruik en prijs over de gemeten periode')}
    <div class="chart-wrap">${chartSvg}</div>
  </div>

  <div class="ev-footer">De Schakelaar &middot; onafhankelijk EV- en energieadvies</div>

</div>
</body>
</html>
`;
}

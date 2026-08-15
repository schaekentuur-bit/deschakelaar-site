// Pure functie: data in, HTML-string uit. Geen fs/netwerk/Date.now() —
// generatedAt komt als parameter binnen zodat dit deterministisch en
// testbaar blijft (zelfde inputs -> zelfde output).
'use strict';

import { buildConsumptionPriceChartSvg } from './chartSvg.js';

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

/**
 * Bouwt het volledige, zelfstandige HTML-rapport: dekkingsgegevens (stap 1+2,
 * inclusief de EnergyZero-uurgemiddelde-beperking indien van toepassing),
 * alle acht gebruikte tariefvelden, het eindbedrag per scenario en het
 * verschil, en de verbruik/prijs-grafiek — alles in één oogopslag, zonder in
 * de code te hoeven kijken.
 *
 * @param {object} input
 * @param {string} input.generatedAt - ISO-timestamp, door de aanroeper bepaald
 * @param {string} input.consumptionPath
 * @param {string} input.format
 * @param {object} input.consumptionSummary - uit core/validate.js
 * @param {string[]} input.consumptionWarnings
 * @param {string} input.priceSource
 * @param {object} input.coverage - uit core/priceCoverage.js
 * @param {object} input.result - uit core/tariffCalculation.js
 * @returns {string} volledig HTML-document
 */
export function buildHtmlReport(input) {
  const { generatedAt, consumptionPath, format, consumptionSummary, consumptionWarnings, priceSource, coverage, result } =
    input;
  const { tariffs } = result;

  const chartSvg = buildConsumptionPriceChartSvg(result.perInterval);

  const differenceLabel =
    result.differenceEur > 0
      ? `Overstappen naar dynamisch bespaart <strong>${eur(result.differenceEur)}</strong> over deze periode.`
      : result.differenceEur < 0
        ? `Overstappen naar dynamisch kost <strong>${eur(-result.differenceEur)}</strong> extra over deze periode.`
        : 'Geen verschil tussen beide scenario\'s over deze periode.';

  const limitationBox = coverage.limitationNote
    ? `<div class="warning">&#9888; ${esc(coverage.limitationNote)}</div>`
    : '';

  const warningsBox =
    consumptionWarnings.length > 0
      ? `<div class="warning">&#9888; ${consumptionWarnings.length} waarschuwing(en) bij het inlezen van het verbruiksbestand.</div>`
      : '';

  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<title>Energierapport — ${esc(consumptionPath)}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 1000px; margin: 2rem auto; padding: 0 1rem; color: #1e293b; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.05rem; margin-top: 2rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.25rem; }
  .meta { color: #64748b; font-size: 0.9rem; margin-bottom: 1.5rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  td, th { text-align: left; padding: 0.3rem 0.6rem; border-bottom: 1px solid #f1f5f9; }
  th { color: #64748b; font-weight: 600; width: 45%; }
  .warning { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 0.75rem 1rem; border-radius: 6px; margin: 0.75rem 0; font-size: 0.9rem; }
  .totals { display: flex; gap: 1.5rem; flex-wrap: wrap; margin: 1rem 0; }
  .total-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem 1.25rem; min-width: 220px; }
  .total-card .amount { font-size: 1.6rem; font-weight: 700; }
  .difference { font-size: 1.1rem; margin: 1rem 0; padding: 0.9rem 1.1rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; }
  .chart-wrap { overflow-x: auto; }
  .footnote { color: #64748b; font-size: 0.85rem; margin-top: 0.75rem; }
</style>
</head>
<body>
  <h1>Energierapport: dynamisch vs. huidig contract</h1>
  <div class="meta">Gegenereerd op ${esc(generatedAt)} &middot; verbruiksbestand: ${esc(consumptionPath)} &middot; format: ${esc(format)}</div>

  <h2>Dekking en aannames (stap 1 &amp; 2)</h2>
  <table>
    <tr><th>Periode</th><td>${esc(consumptionSummary.firstTimestamp)} t/m ${esc(consumptionSummary.lastTimestamp)} (${result.periodDays.toFixed(2)} dagen)</td></tr>
    <tr><th>Intervallen gevonden</th><td>${consumptionSummary.actualCount} van ${consumptionSummary.expectedCount} verwacht (intervalduur: ${consumptionSummary.intervalMinutes} min)</td></tr>
    <tr><th>Ontbrekende intervallen (gaten)</th><td>${consumptionSummary.missingCount} (${pct(consumptionSummary.missingPercentage)})</td></tr>
    <tr><th>Totale afname / teruglevering</th><td>${consumptionSummary.totalImportKwh.toFixed(3)} kWh / ${consumptionSummary.totalExportKwh.toFixed(3)} kWh</td></tr>
    <tr><th>Prijsbron</th><td>${esc(priceSource)}</td></tr>
    <tr><th>Prijsintervalduur</th><td>${coverage.priceIntervalMinutes} min (verbruik: ${coverage.consumptionIntervalMinutes} min)</td></tr>
    <tr><th>Prijzen gekoppeld</th><td>${coverage.matchedCount} van ${coverage.totalCount} intervallen (${pct(coverage.missingPercentage)} ontbreekt)</td></tr>
  </table>
  ${limitationBox}
  ${warningsBox}

  <h2>Gebruikte tarieven (per klant aangeleverd)</h2>
  <table>
    <tr><th>Huidig contracttype</th><td>${esc(tariffs.currentContractType)}</td></tr>
    <tr><th>Huidig leveringstarief incl. btw</th><td>${tariffs.currentSupplyRateInclVatEurPerKwh} EUR/kWh</td></tr>
    <tr><th>Huidige terugleververgoeding</th><td>${tariffs.currentFeedInRateEurPerKwh} EUR/kWh</td></tr>
    <tr><th>Huidige vaste terugleverkosten</th><td>${tariffs.currentFixedFeedInCostsPerMonth} EUR/maand</td></tr>
    <tr><th>Huidige vaste leveringskosten</th><td>${tariffs.currentFixedSupplyCostsPerMonth} EUR/maand</td></tr>
    <tr><th>Dynamische opslag op afname</th><td>${tariffs.dynamicMarkupEurPerKwh} EUR/kWh (bij de spotprijs opgeteld)</td></tr>
    <tr><th>Dynamische opslag op teruglevering</th><td>${tariffs.dynamicFeedInMarkupEurPerKwh} EUR/kWh (van de spotprijs afgetrokken)</td></tr>
    <tr><th>Dynamische vaste leveringskosten</th><td>${tariffs.dynamicFixedSupplyCostsPerMonth} EUR/maand</td></tr>
  </table>
  <p class="footnote">Vaste maandkosten zijn geprorateerd over de exacte gemeten periode (${result.periodDays.toFixed(2)} dagen, gemiddelde maandlengte 30,44 dagen), niet over een aangenomen vaste maand.</p>

  <h2>Resultaat over de gemeten periode</h2>
  <div class="totals">
    <div class="total-card">
      <div>Huidig contract (${esc(tariffs.currentContractType)})</div>
      <div class="amount">${eur(result.current.totalEur)}</div>
      <div class="footnote">variabel ${eur(result.current.variableCostEur)} + vast ${eur(result.current.fixedCostEur)} + terugleverkosten ${eur(result.current.fixedFeedInCostEur)}</div>
    </div>
    <div class="total-card">
      <div>Dynamisch contract</div>
      <div class="amount">${eur(result.dynamic.totalEur)}</div>
      <div class="footnote">variabel ${eur(result.dynamic.variableCostEur)} + vast ${eur(result.dynamic.fixedCostEur)}</div>
    </div>
  </div>
  <div class="difference">${differenceLabel}</div>
  <p class="footnote">Dit is het bedrag over de gemeten periode, geen jaarindicatie.</p>

  <h2>Verbruik en prijs over de gemeten periode</h2>
  <div class="chart-wrap">${chartSvg}</div>
</body>
</html>
`;
}

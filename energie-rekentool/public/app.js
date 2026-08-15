// Browserschil rond de ongewijzigde src/core/-rekenkern. Doet alleen DOM- en
// fetch-orkestratie; alle daadwerkelijke logica (parsen, koppelen, rekenen,
// rapport bouwen) draait in dezelfde pure functies als de CLI.
'use strict';

import { detectFormat } from '../src/core/formatDetect.js';
import { parseHomeWizardCsv, toIntervalReadings } from '../src/core/homewizardCsv.js';
import { parseInternalCsv } from '../src/core/internalCsv.js';
import { computeCoverageSummary } from '../src/core/validate.js';
import { parsePriceCsv } from '../src/core/priceCsv.js';
import { matchIntervalsToPrices } from '../src/core/priceMatching.js';
import { computePriceCoverage, assertPriceCoverageSufficient } from '../src/core/priceCoverage.js';
import { checkPriceDataAvailability } from '../src/core/priceDataAvailability.js';
import { calculateScenarioComparison } from '../src/core/tariffCalculation.js';
import { buildHtmlReport } from '../src/core/htmlReport.js';
import { checkTariffDefaultsFreshness } from '../src/core/tariffDefaultsFreshness.js';

const NUMERIC_TARIFF_FIELDS = [
  'currentSupplyRateInclVatEurPerKwh',
  'currentFeedInRateEurPerKwh',
  'currentFixedFeedInCostsPerMonth',
  'dynamicMarkupEurPerKwh',
  'dynamicFeedInMarkupEurPerKwh',
  'currentFixedSupplyCostsPerMonth',
  'dynamicFixedSupplyCostsPerMonth'
];

const state = {
  intervals: null,
  consumptionWarnings: null,
  consumptionSummary: null,
  format: null,
  consumptionFileName: null,
  matchResult: null,
  coverage: null,
  priceSource: null
};

function el(id) {
  return document.getElementById(id);
}

function addMessage(container, className, text) {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = text;
  container.appendChild(div);
  return div;
}

function clear(container) {
  container.innerHTML = '';
}

/**
 * Markeert een tarief-veld dat een grote spreiding tussen leveranciers heeft
 * (zie config/tariff-defaults.json's "bandbreedte") zichtbaar prominenter dan
 * de andere velden: de vooringevulde marktgemiddelde is hier geen veilige
 * aanname — bij een individuele klant kan de werkelijke waarde een veelvoud
 * schelen, en dat werkt direct door in het eindresultaat.
 */
function markFieldAsHighVariance(field, bandbreedte, defaultValue) {
  const fieldDiv = el(`f-${field}`).closest('.field');
  fieldDiv.classList.add('field-caution');
  const hint = document.createElement('p');
  hint.className = 'field-caution-hint';
  hint.textContent =
    `⚠ Grote spreiding tussen leveranciers: €${bandbreedte.min}–€${bandbreedte.max}/kWh. ` +
    `De vooringevulde €${defaultValue} is een marktgemiddelde, geen veilige aanname zoals bijvoorbeeld ` +
    'het leveringstarief — controleer dit altijd tegen het echte contract van de klant.';
  fieldDiv.appendChild(hint);
}

async function loadTariffDefaults() {
  const res = await fetch('config/tariff-defaults.json');
  if (!res.ok) throw new Error(`Kan config/tariff-defaults.json niet laden (HTTP ${res.status})`);
  const config = await res.json();

  el('f-currentContractType').value = config.velden.currentContractType.waarde;
  for (const field of NUMERIC_TARIFF_FIELDS) {
    const info = config.velden[field];
    el(`f-${field}`).value = info.waarde;
    if (info.bandbreedte) markFieldAsHighVariance(field, info.bandbreedte, info.waarde);
  }

  const peildatums = Object.values(config.velden)
    .map((v) => v.peildatum)
    .filter(Boolean)
    .sort();
  if (peildatums.length > 0) {
    el('tariff-defaults-note').textContent =
      `Deze velden staan vooringevuld op marktgemiddelden (peildatum vanaf ${peildatums[0]}) — ` +
      'pas ze aan naar het eigen contract van de klant.';
  }

  const freshness = checkTariffDefaultsFreshness(config, Date.now());
  if (freshness.isStale) {
    const banner = el('tariff-defaults-warning');
    banner.style.display = '';
    clear(banner);
    addMessage(
      banner,
      'warning',
      `⚠ De marktgemiddelden zijn niet meer actueel: ${freshness.staleFields
        .map((f) => `${f.field} (${f.ageDays} dagen oud)`)
        .join(', ')}. Vooringevulde waarden kunnen verouderd zijn — controleer ze voordat je rekent.`
    );
  }
}

function normalizeConsumption(text) {
  const format = detectFormat(text);
  if (format === 'homewizard') {
    const rows = parseHomeWizardCsv(text);
    const { intervals, warnings } = toIntervalReadings(rows);
    return { format, intervals, warnings };
  }
  const { intervals, warnings } = parseInternalCsv(text);
  return { format, intervals, warnings };
}

function renderConsumptionSummary(container, format, summary, warnings) {
  addMessage(
    container,
    'ok',
    `Herkend als ${format}-format. Periode ${summary.firstTimestamp} t/m ${summary.lastTimestamp}, ` +
      `${summary.actualCount} van ${summary.expectedCount} intervallen ` +
      `(${summary.missingPercentage.toFixed(2)}% ontbrekende intervallen).`
  );
  if (warnings.length > 0) {
    addMessage(container, 'warning', `${warnings.length} waarschuwing(en) bij het inlezen van het verbruiksbestand.`);
  }
}

async function loadAndMatchPrices(container) {
  addMessage(container, 'info', 'Prijzen ophalen...');

  const manifestRes = await fetch('data/prices/energyzero/index.json');
  if (!manifestRes.ok) throw new Error(`Kan het prijzenmanifest niet laden (HTTP ${manifestRes.status})`);
  const manifest = await manifestRes.json();

  const availability = checkPriceDataAvailability(state.consumptionSummary, manifest);
  if (!availability.isFullyAvailable) {
    throw new Error(
      'De geüploade periode valt buiten de beschikbare prijsdata. ' +
        `Beschikbaar: ${availability.earliestAvailable ?? '(nog geen data gepubliceerd)'} t/m ` +
        `${availability.latestAvailable ?? '(nog geen data gepubliceerd)'}. ` +
        `Ontbrekende maand(en): ${availability.missingMonths.join(', ') || '—'}.`
    );
  }

  const pricesPerMonth = await Promise.all(
    availability.neededMonths.map(async (month) => {
      const res = await fetch(`data/prices/energyzero/${month}.csv`);
      if (!res.ok) throw new Error(`Kan prijsbestand voor ${month} niet laden (HTTP ${res.status})`);
      return parsePriceCsv(await res.text());
    })
  );
  const allPrices = pricesPerMonth.flat();

  const matchResult = matchIntervalsToPrices(state.intervals, allPrices);
  const coverage = computePriceCoverage(matchResult);

  state.matchResult = matchResult;
  state.coverage = coverage;
  state.priceSource = `EnergyZero-uurprijzen (statisch gepubliceerd, laatst bijgewerkt ${manifest.lastUpdatedUtc})`;

  addMessage(
    container,
    'ok',
    `Prijzen gekoppeld: ${coverage.matchedCount} van ${coverage.totalCount} intervallen ` +
      `(${coverage.missingPercentage.toFixed(2)}% ontbreekt).`
  );
  if (coverage.limitationNote) {
    addMessage(container, 'warning', coverage.limitationNote);
  }

  // Gooit bij >5% ontbrekende prijzen — zelfde weigeringsregel als de CLI.
  assertPriceCoverageSufficient(coverage);
}

function readTariffForm() {
  const tariffs = { currentContractType: el('f-currentContractType').value };
  for (const field of NUMERIC_TARIFF_FIELDS) {
    const raw = el(`f-${field}`).value;
    const num = Number(raw);
    if (raw === '' || !Number.isFinite(num)) {
      throw new Error(`Veld "${field}" moet een geldig getal zijn`);
    }
    tariffs[field] = num;
  }
  return tariffs;
}

async function handleFileChange(event) {
  const file = event.target.files[0];
  if (!file) return;

  el('calculate-button').disabled = true;
  el('tariffs-section').dataset.disabled = 'true';
  el('calculate-section').dataset.disabled = 'true';
  el('report-frame').style.display = 'none';

  const statusEl = el('upload-status');
  clear(statusEl);
  addMessage(statusEl, 'info', 'Bestand wordt ingelezen...');

  try {
    const text = await file.text();
    const { format, intervals, warnings } = normalizeConsumption(text);
    const consumptionSummary = computeCoverageSummary(intervals);

    state.intervals = intervals;
    state.consumptionWarnings = warnings;
    state.consumptionSummary = consumptionSummary;
    state.format = format;
    state.consumptionFileName = file.name;

    clear(statusEl);
    renderConsumptionSummary(statusEl, format, consumptionSummary, warnings);

    await loadAndMatchPrices(statusEl);

    el('tariffs-section').dataset.disabled = 'false';
    el('calculate-section').dataset.disabled = 'false';
    el('calculate-button').disabled = false;
  } catch (err) {
    addMessage(statusEl, 'error', `Fout: ${err.message}`);
  }
}

function handleCalculate() {
  const statusEl = el('calculate-status');
  clear(statusEl);
  try {
    const tariffs = readTariffForm();
    const result = calculateScenarioComparison(state.matchResult.matched, tariffs);
    const html = buildHtmlReport({
      generatedAt: new Date().toISOString(),
      consumptionPath: state.consumptionFileName,
      format: state.format,
      consumptionSummary: state.consumptionSummary,
      consumptionWarnings: state.consumptionWarnings,
      priceSource: state.priceSource,
      coverage: state.coverage,
      result
    });

    const frame = el('report-frame');
    frame.srcdoc = html;
    frame.style.display = 'block';
    frame.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    addMessage(statusEl, 'error', `Fout bij berekenen: ${err.message}`);
  }
}

el('consumption-file').addEventListener('change', handleFileChange);
el('calculate-button').addEventListener('click', handleCalculate);

loadTariffDefaults().catch((err) => {
  const banner = el('tariff-defaults-warning');
  banner.style.display = '';
  addMessage(banner, 'error', `Kan de standaard-tariefwaarden niet laden: ${err.message}`);
});

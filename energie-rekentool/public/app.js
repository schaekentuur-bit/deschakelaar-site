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
import { estimateAnnualImportKwh } from '../src/core/annualConsumptionEstimate.js';
import { convertXlsxToCsvText } from '../src/io/xlsxToCsv.js';

const NUMERIC_TARIFF_FIELDS = [
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

// Boven welk geëxtrapoleerd jaarverbruik (kWh) de vlakke energiebelasting-
// aanname (schijf 1+2, tot 10.000 kWh/jaar) een waarschuwing verdient — zie
// config/tariff-defaults.json (dynamicEnergyTaxEurPerKwh) voor de tarieven.
const ENERGY_TAX_BRACKET_LIMIT_KWH = 10000;
const ENERGY_TAX_BRACKET_NEARING_KWH = 8000;

// Velden met een eigen "bandbreedte" in de config krijgen een zichtbaar
// prominentere aansporing dan de rest (zie loadTariffDefaults), in het
// bijbehorende containerelement op de pagina.
const HIGH_VARIANCE_FIELD_CONTAINERS = {
  currentFeedInRateEurPerKwh: 'feed-in-rate-caution',
  newFeedInRateEurPerKwh: 'new-feed-in-rate-caution'
};

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

function clear(container) {
  container.innerHTML = '';
}

/** Voegt een hint-box toe, zelfde visuele taal als het situatieschets-hulpmiddel. */
function addHint(container, variant, text) {
  const div = document.createElement('div');
  div.className = variant ? `hint ${variant}` : 'hint';
  div.textContent = text;
  container.appendChild(div);
  return div;
}

async function loadTariffDefaults() {
  const res = await fetch('config/tariff-defaults.json');
  if (!res.ok) throw new Error(`Kan config/tariff-defaults.json niet laden (HTTP ${res.status})`);
  const config = await res.json();

  el('f-currentContractType').value = config.velden.currentContractType.waarde;
  for (const field of NUMERIC_TARIFF_FIELDS) {
    el(`f-${field}`).value = config.velden[field].waarde;
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

  // Terugleververgoeding (huidig én nieuw) heeft een grote spreiding tussen
  // leveranciers: het marktgemiddelde is hier geen veilige aanname, dus
  // krijgen deze velden een zichtbaar prominentere aansporing dan de rest
  // (zelfde hint.warn-stijl, maar altijd zichtbaar, niet alleen bij een
  // verouderde peildatum) — gestuurd door "bandbreedte" in de config, niet
  // hardcoded, zodat een toekomstig ander hoog-variant veld dezelfde
  // behandeling automatisch meekrijgt.
  for (const [field, containerId] of Object.entries(HIGH_VARIANCE_FIELD_CONTAINERS)) {
    const info = config.velden[field];
    if (!info?.bandbreedte) continue;
    addHint(
      el(containerId),
      'warn',
      `⚠ Grote spreiding tussen leveranciers: €${info.bandbreedte.min}–€${info.bandbreedte.max}/kWh. ` +
        `De vooringevulde €${info.waarde} is een marktgemiddelde, geen offerte en geen veilige aanname zoals ` +
        'bijvoorbeeld het leveringstarief — controleer dit altijd tegen het echte contract van de klant.'
    );
  }

  const freshness = checkTariffDefaultsFreshness(config, Date.now());
  if (freshness.isStale) {
    const banner = el('tariff-defaults-warning');
    clear(banner);
    addHint(
      banner,
      'warn',
      `⚠ De marktgemiddelden zijn niet meer actueel: ${freshness.staleFields
        .map((f) => `${f.field} (${f.ageDays} dagen oud)`)
        .join(', ')}. Vooringevulde waarden kunnen verouderd zijn — controleer ze voordat je rekent.`
    );
  }
}

function isXlsxFile(file) {
  return (
    /\.xlsx$/i.test(file.name) ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}

async function readConsumptionFileText(file) {
  if (!isXlsxFile(file)) {
    return { text: await file.text(), xlsxNotice: null };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { csvText, sheetCount, usedSheetName } = convertXlsxToCsvText(bytes);
  const xlsxNotice =
    sheetCount > 1
      ? `Xlsx-bestand bevat ${sheetCount} sheets; alleen de eerste ("${usedSheetName}") is gebruikt.`
      : null;
  return { text: csvText, xlsxNotice };
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
  addHint(
    container,
    '',
    `Herkend als ${format}-format. Periode ${summary.firstTimestamp} t/m ${summary.lastTimestamp}, ` +
      `${summary.actualCount} van ${summary.expectedCount} intervallen ` +
      `(${summary.missingPercentage.toFixed(2)}% ontbrekende intervallen).`
  );
  for (const warning of warnings) {
    addHint(container, 'warn', warning);
  }
}

/**
 * Waarschuwt zichtbaar naast het energiebelastingveld wanneer het
 * geëxtrapoleerde jaarverbruik van de geüploade periode richting (of over)
 * de 10.000 kWh-grens van schijf 1+2 gaat, i.p.v. een statische kanttekening
 * die voor iedere klant hetzelfde zou zijn.
 */
function renderEnergyTaxScopeWarning(consumptionSummary) {
  const container = el('energy-tax-caution');
  clear(container);
  const annualKwh = estimateAnnualImportKwh(consumptionSummary);
  const rounded = Math.round(annualKwh).toLocaleString('nl-NL');

  if (annualKwh >= ENERGY_TAX_BRACKET_LIMIT_KWH) {
    addHint(
      container,
      'warn',
      `⚠ Geëxtrapoleerd jaarverbruik op basis van deze periode: ~${rounded} kWh — dat ligt boven de 10.000 kWh-grens ` +
        'van energiebelastingschijf 1+2. Vanaf daar geldt een lager tarief (schijf 3), dat het vooringevulde tarief ' +
        'hierboven niet dekt — pas dit handmatig aan voor deze klant. (Ruwe schatting op basis van de gemeten ' +
        'periode, geen jaarmeting.)'
    );
  } else if (annualKwh >= ENERGY_TAX_BRACKET_NEARING_KWH) {
    addHint(
      container,
      'warn',
      `⚠ Geëxtrapoleerd jaarverbruik op basis van deze periode: ~${rounded} kWh — dat nadert de 10.000 kWh-grens ` +
        'van energiebelastingschijf 1+2. Bij overschrijding geldt vanaf dat punt een lager tarief (schijf 3) — ' +
        'controleer het werkelijke jaarverbruik van de klant. (Ruwe schatting op basis van de gemeten periode, ' +
        'geen jaarmeting.)'
    );
  }
}

async function loadAndMatchPrices(container) {
  addHint(container, 'info', 'Prijzen ophalen...');

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

  addHint(
    container,
    '',
    `Prijzen gekoppeld: ${coverage.matchedCount} van ${coverage.totalCount} intervallen ` +
      `(${coverage.missingPercentage.toFixed(2)}% ontbreekt).`
  );
  if (coverage.limitationNote) {
    addHint(container, 'warn', coverage.limitationNote);
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
  el('tariffs-step').dataset.disabled = 'true';
  el('calculate-step').dataset.disabled = 'true';
  el('report-frame').style.display = 'none';

  const statusEl = el('upload-status');
  clear(statusEl);
  addHint(statusEl, 'info', 'Bestand wordt ingelezen...');

  try {
    const { text, xlsxNotice } = await readConsumptionFileText(file);
    const { format, intervals, warnings } = normalizeConsumption(text);
    const consumptionSummary = computeCoverageSummary(intervals);

    state.intervals = intervals;
    state.consumptionWarnings = warnings;
    state.consumptionSummary = consumptionSummary;
    state.format = format;
    state.consumptionFileName = file.name;

    clear(statusEl);
    if (xlsxNotice) {
      addHint(statusEl, 'info', xlsxNotice);
    }
    renderConsumptionSummary(statusEl, format, consumptionSummary, warnings);
    renderEnergyTaxScopeWarning(consumptionSummary);

    await loadAndMatchPrices(statusEl);

    el('tariffs-step').dataset.disabled = 'false';
    el('calculate-step').dataset.disabled = 'false';
    el('calculate-button').disabled = false;
  } catch (err) {
    addHint(statusEl, 'error', `Fout: ${err.message}`);
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
    addHint(statusEl, 'error', `Fout bij berekenen: ${err.message}`);
  }
}

function handleReset() {
  el('consumption-file').value = '';
  clear(el('upload-status'));
  clear(el('calculate-status'));
  clear(el('energy-tax-caution'));
  el('tariffs-step').dataset.disabled = 'true';
  el('calculate-step').dataset.disabled = 'true';
  el('calculate-button').disabled = true;
  const frame = el('report-frame');
  frame.style.display = 'none';
  frame.srcdoc = '';

  state.intervals = null;
  state.consumptionWarnings = null;
  state.consumptionSummary = null;
  state.format = null;
  state.consumptionFileName = null;
  state.matchResult = null;
  state.coverage = null;
  state.priceSource = null;
}

el('consumption-file').addEventListener('change', handleFileChange);
el('calculate-button').addEventListener('click', handleCalculate);
el('reset-button').addEventListener('click', handleReset);

loadTariffDefaults().catch((err) => {
  addHint(el('tariff-defaults-warning'), 'error', `Kan de standaard-tariefwaarden niet laden: ${err.message}`);
});

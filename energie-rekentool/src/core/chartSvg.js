// Pure functie: data in, SVG-string uit. Geen fs/netwerk/DOM — werkt
// ongewijzigd in Node of een browser.
'use strict';

const MONTHS_NL = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function round(n, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

function linearScale(domainMin, domainMax, rangeMin, rangeMax) {
  const span = domainMax - domainMin;
  if (span === 0) {
    const mid = (rangeMin + rangeMax) / 2;
    return () => mid;
  }
  return (value) => rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

/** "YYYY-MM-DDTHH:MM:SS+HH:MM" -> "20 jul" of "14:30", afhankelijk van de periodelengte. */
function formatTick(isoTimestamp, showTimeOnly) {
  const day = Number(isoTimestamp.slice(8, 10));
  const month = Number(isoTimestamp.slice(5, 7)) - 1;
  const time = isoTimestamp.slice(11, 16);
  return showTimeOnly ? time : `${day} ${MONTHS_NL[month]}`;
}

function pickTickIndices(count, maxTicks) {
  if (count <= maxTicks) return Array.from({ length: count }, (_, i) => i);
  const indices = [];
  for (let i = 0; i < maxTicks; i++) {
    indices.push(Math.round((i * (count - 1)) / (maxTicks - 1)));
  }
  return [...new Set(indices)];
}

/**
 * Bouwt een SVG-grafiek: bovenin de prijs over tijd (met nullijn en
 * roodgetinte vlakken bij negatieve prijzen), onderin verbruik als
 * tweezijdig diagram (afname omhoog, teruglevering omlaag) op dezelfde
 * tijdas — zodat piekmomenten direct tegen dure/goedkope prijsmomenten
 * afgezet kunnen worden.
 *
 * @param {Array<{timestamp: string, importKwh: number, exportKwh: number, priceEurKwh: number}>} perInterval
 * @param {object} [opts]
 * @returns {string} een <svg>...</svg>-fragment
 */
export function buildConsumptionPriceChartSvg(perInterval, opts = {}) {
  if (perInterval.length === 0) {
    throw new Error('Kan geen grafiek bouwen: geen intervallen');
  }

  const width = opts.width ?? 1000;
  const margin = { top: 30, right: 60, bottom: 40, left: 60 };
  const gapBetweenPanels = 20;
  const pricePanelHeight = opts.pricePanelHeight ?? 130;
  const consumptionPanelHeight = opts.consumptionPanelHeight ?? 190;

  const plotLeft = margin.left;
  const plotRight = width - margin.right;
  const pricePanelTop = margin.top;
  const pricePanelBottom = pricePanelTop + pricePanelHeight;
  const consumptionPanelTop = pricePanelBottom + gapBetweenPanels;
  const consumptionPanelBottom = consumptionPanelTop + consumptionPanelHeight;
  const height = consumptionPanelBottom + margin.bottom;

  const n = perInterval.length;
  const xScale = linearScale(0, Math.max(n - 1, 1), plotLeft, plotRight);

  const prices = perInterval.map((d) => d.priceEurKwh);
  const priceMin = Math.min(0, ...prices);
  const priceMax = Math.max(0, ...prices);
  const pricePad = (priceMax - priceMin) * 0.1 || 0.01;
  const yPriceScale = linearScale(priceMin - pricePad, priceMax + pricePad, pricePanelBottom, pricePanelTop);
  const priceZeroY = yPriceScale(0);

  const maxImport = Math.max(0.0001, ...perInterval.map((d) => d.importKwh));
  const maxExport = Math.max(0.0001, ...perInterval.map((d) => d.exportKwh));
  const consumptionMidY = consumptionPanelTop + consumptionPanelHeight / 2;
  const yImportScale = linearScale(0, maxImport, consumptionMidY, consumptionPanelTop);
  const yExportScale = linearScale(0, maxExport, consumptionMidY, consumptionPanelBottom);

  // Prijslijn + vlak onder de nullijn (negatieve-prijsmomenten direct zichtbaar).
  let pricePathD = '';
  let priceAreaD = '';
  perInterval.forEach((d, i) => {
    const x = round(xScale(i));
    const y = round(yPriceScale(d.priceEurKwh));
    pricePathD += `${i === 0 ? 'M' : 'L'}${x},${y} `;
    priceAreaD += `${i === 0 ? 'M' : 'L'}${x},${y} `;
  });
  priceAreaD += `L${round(xScale(n - 1))},${round(priceZeroY)} L${round(xScale(0))},${round(priceZeroY)} Z`;

  // Verbruiksstaven als één compact path (dunne verticale lijnstukken i.p.v.
  // duizenden losse <rect>-elementen — zelfde visuele effect, veel kleiner bestand).
  let importBarsD = '';
  let exportBarsD = '';
  perInterval.forEach((d, i) => {
    const x = round(xScale(i));
    if (d.importKwh > 0) importBarsD += `M${x},${round(consumptionMidY)} L${x},${round(yImportScale(d.importKwh))} `;
    if (d.exportKwh > 0) exportBarsD += `M${x},${round(consumptionMidY)} L${x},${round(yExportScale(d.exportKwh))} `;
  });
  const barStrokeWidth = Math.max(0.5, ((plotRight - plotLeft) / n) * 0.9);

  // Tijdas: gedeeld tussen beide panelen, met verticale hulplijnen om
  // prijs- en verbruikspieken op dezelfde x-positie te kunnen aflezen.
  const totalSpanMs = Date.parse(perInterval[n - 1].timestamp) - Date.parse(perInterval[0].timestamp);
  const showTimeOnly = totalSpanMs <= 2 * 86400000;
  const tickIndices = pickTickIndices(n, opts.maxTicks ?? 8);

  let gridAndTicks = '';
  for (const i of tickIndices) {
    const x = round(xScale(i));
    const label = esc(formatTick(perInterval[i].timestamp, showTimeOnly));
    gridAndTicks +=
      `<line x1="${x}" y1="${pricePanelTop}" x2="${x}" y2="${consumptionPanelBottom}" stroke="#e2e8f0" stroke-width="1" />` +
      `<text x="${x}" y="${consumptionPanelBottom + 16}" font-size="11" fill="#475569" text-anchor="middle">${label}</text>`;
  }

  const svg = `
<svg viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />

  <!-- Legenda -->
  <g font-size="12" fill="#334155">
    <rect x="${plotLeft}" y="6" width="10" height="10" fill="#d97706" />
    <text x="${plotLeft + 16}" y="15">Prijs (EUR/kWh)</text>
    <rect x="${plotLeft + 150}" y="6" width="10" height="10" fill="#2563eb" />
    <text x="${plotLeft + 166}" y="15">Afname (kWh)</text>
    <rect x="${plotLeft + 280}" y="6" width="10" height="10" fill="#16a34a" />
    <text x="${plotLeft + 296}" y="15">Teruglevering (kWh)</text>
  </g>

  ${gridAndTicks}

  <!-- Prijspaneel (titel niet herhaald: staat al in de legenda hierboven) -->
  <defs>
    <clipPath id="below-zero-clip">
      <rect x="${plotLeft}" y="${round(priceZeroY)}" width="${plotRight - plotLeft}" height="${round(Math.max(0, pricePanelBottom - priceZeroY))}" />
    </clipPath>
  </defs>
  <line x1="${plotLeft}" y1="${round(priceZeroY)}" x2="${plotRight}" y2="${round(priceZeroY)}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3,3" />
  <path d="${priceAreaD}" fill="#dc2626" fill-opacity="0.12" stroke="none" clip-path="url(#below-zero-clip)" />
  <path d="${pricePathD.trim()}" fill="none" stroke="#d97706" stroke-width="1.5" />
  <text x="${plotRight + 6}" y="${pricePanelTop + 4}" font-size="10" fill="#64748b">${round(priceMax + pricePad, 3)}</text>
  <text x="${plotRight + 6}" y="${round(priceZeroY) + 4}" font-size="10" fill="#64748b">0</text>
  <text x="${plotRight + 6}" y="${pricePanelBottom}" font-size="10" fill="#64748b">${round(priceMin - pricePad, 3)}</text>

  <!-- Verbruikspaneel -->
  <text x="${plotLeft}" y="${consumptionPanelTop - 8}" font-size="12" fill="#475569">Verbruik (kWh) — afname boven, teruglevering onder</text>
  <line x1="${plotLeft}" y1="${round(consumptionMidY)}" x2="${plotRight}" y2="${round(consumptionMidY)}" stroke="#94a3b8" stroke-width="1" />
  <path d="${importBarsD.trim()}" stroke="#2563eb" stroke-width="${round(barStrokeWidth, 2)}" />
  <path d="${exportBarsD.trim()}" stroke="#16a34a" stroke-width="${round(barStrokeWidth, 2)}" />
  <text x="${plotRight + 6}" y="${consumptionPanelTop + 4}" font-size="10" fill="#64748b">${round(maxImport, 2)}</text>
  <text x="${plotRight + 6}" y="${round(consumptionMidY) + 4}" font-size="10" fill="#64748b">0</text>
  <text x="${plotRight + 6}" y="${consumptionPanelBottom}" font-size="10" fill="#64748b">${round(maxExport, 2)}</text>
</svg>`.trim();

  return svg;
}

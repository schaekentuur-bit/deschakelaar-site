import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConsumptionPriceChartSvg } from '../src/core/chartSvg.js';

function iv(timestamp, importKwh, exportKwh, priceEurKwh) {
  return { timestamp, importKwh, exportKwh, priceEurKwh };
}

test('throws on an empty dataset', () => {
  assert.throws(() => buildConsumptionPriceChartSvg([]), /geen intervallen/i);
});

test('produces a valid, well-formed svg fragment', () => {
  const svg = buildConsumptionPriceChartSvg([
    iv('2025-06-01T00:15:00+02:00', 1, 0, 0.2),
    iv('2025-06-01T00:30:00+02:00', 0, 1, 0.25)
  ]);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
});

test('does not render overlapping duplicate text labels (e.g. the price legend vs. a redundant panel title)', () => {
  const svg = buildConsumptionPriceChartSvg([
    iv('2025-06-01T00:15:00+02:00', 1, 0, 0.2),
    iv('2025-06-01T00:30:00+02:00', 0, 1, 0.25)
  ]);
  const labels = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    text: m[3]
  }));
  assert.ok(labels.length > 5, 'sanity check: verwacht meerdere tekstlabels in de svg');

  // Twee labels met dezelfde tekst mogen bestaan (bv. "0" op zowel de prijs-
  // als de verbruiksas), zolang ze niet dicht genoeg bij elkaar staan om
  // elkaar te overlappen. Bij gelijke tekst én een afstand kleiner dan een
  // regelhoogte (~16px) is dat een overlappende duplicaat, zoals eerder
  // "Prijs (EUR/kWh)" tweemaal vlak boven elkaar.
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (labels[i].text !== labels[j].text) continue;
      const dx = Math.abs(labels[i].x - labels[j].x);
      const dy = Math.abs(labels[i].y - labels[j].y);
      assert.ok(
        dx > 16 || dy > 16,
        `label "${labels[i].text}" komt tweemaal voor op bijna dezelfde positie: ` +
          `(${labels[i].x},${labels[i].y}) en (${labels[j].x},${labels[j].y})`
      );
    }
  }
});

test('is deterministic: identical input produces identical output', () => {
  const data = [iv('2025-06-01T00:15:00+02:00', 1, 0, 0.2), iv('2025-06-01T00:30:00+02:00', 0, 1, 0.25)];
  assert.equal(buildConsumptionPriceChartSvg(data), buildConsumptionPriceChartSvg(data));
});

test('the below-zero clip region is much taller when a negative price is present', () => {
  // De rode vlakvulling wordt geclipt tot het gebied ónder de nullijn, zodat
  // bij uitsluitend positieve prijzen niet per ongeluk het gebied erboven
  // rood kleurt. Bij negatieve prijzen moet er dus een substantieel gebied
  // onder de nullijn geclipt worden; bij enkel positieve prijzen nauwelijks.
  const withNegative = buildConsumptionPriceChartSvg([
    iv('2025-06-01T00:15:00+02:00', 1, 0, -0.05),
    iv('2025-06-01T00:30:00+02:00', 1, 0, 0.10)
  ]);
  const allPositive = buildConsumptionPriceChartSvg([
    iv('2025-06-01T00:15:00+02:00', 1, 0, 0.05),
    iv('2025-06-01T00:30:00+02:00', 1, 0, 0.10)
  ]);

  const clipHeight = (svg) => Number(svg.match(/<clipPath id="below-zero-clip">\s*<rect[^>]*height="([\d.]+)"/)[1]);
  assert.ok(clipHeight(withNegative) > clipHeight(allPositive) * 3);
});

test('omits import/export bar strokes when a series is entirely zero', () => {
  const onlyImport = buildConsumptionPriceChartSvg([
    iv('2025-06-01T00:15:00+02:00', 1, 0, 0.2),
    iv('2025-06-01T00:30:00+02:00', 2, 0, 0.2)
  ]);
  const exportPath = onlyImport.match(/<path d="([^"]*)" stroke="#6DBF4A"/)[1];
  assert.equal(exportPath.trim(), '');
  const importPath = onlyImport.match(/<path d="([^"]*)" stroke="#1B2E4B"/)[1];
  assert.notEqual(importPath.trim(), '');
});

test('uses time-only tick labels for a short (<=2 day) span, and date labels for a longer span', () => {
  const shortSpan = buildConsumptionPriceChartSvg([
    iv('2025-06-01T00:15:00+02:00', 1, 0, 0.2),
    iv('2025-06-01T23:45:00+02:00', 1, 0, 0.2)
  ]);
  assert.match(shortSpan, />\d{2}:\d{2}</);

  const longSpan = buildConsumptionPriceChartSvg([
    iv('2025-06-01T00:15:00+02:00', 1, 0, 0.2),
    iv('2025-06-20T00:15:00+02:00', 1, 0, 0.2)
  ]);
  assert.match(longSpan, />\d{1,2} jun</);
});

test('handles a large number of intervals without error (year-scale smoke test)', () => {
  const intervals = [];
  const start = Date.parse('2025-01-01T00:00:00+01:00');
  for (let i = 0; i < 35040; i++) {
    intervals.push({
      timestamp: new Date(start + i * 15 * 60000).toISOString(),
      importKwh: i % 4 === 0 ? 0.5 : 0,
      exportKwh: i % 4 === 2 ? 0.3 : 0,
      priceEurKwh: Math.sin(i / 100) * 0.1
    });
  }
  const svg = buildConsumptionPriceChartSvg(intervals);
  assert.match(svg, /^<svg /);
});

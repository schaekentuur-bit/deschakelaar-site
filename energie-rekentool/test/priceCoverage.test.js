import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePriceCoverage, assertPriceCoverageSufficient } from '../src/core/priceCoverage.js';

function matchResult({ matched, consumptionIntervalMinutes, priceIntervalMinutes }) {
  return { matched, consumptionIntervalMinutes, priceIntervalMinutes };
}

test('full coverage, quarter-hour prices: no limitation note', () => {
  const coverage = computePriceCoverage(
    matchResult({
      matched: [{ priceEurKwh: 0.1 }, { priceEurKwh: 0.2 }],
      consumptionIntervalMinutes: 15,
      priceIntervalMinutes: 15
    })
  );
  assert.equal(coverage.matchedCount, 2);
  assert.equal(coverage.missingCount, 0);
  assert.equal(coverage.missingPercentage, 0);
  assert.equal(coverage.isHourlyApproximation, false);
  assert.equal(coverage.limitationNote, null);
});

test('hourly prices against quarter-hour consumption: flags the known limitation', () => {
  const coverage = computePriceCoverage(
    matchResult({
      matched: [{ priceEurKwh: 0.1 }, { priceEurKwh: 0.1 }, { priceEurKwh: 0.1 }, { priceEurKwh: 0.1 }],
      consumptionIntervalMinutes: 15,
      priceIntervalMinutes: 60
    })
  );
  assert.equal(coverage.isHourlyApproximation, true);
  assert.match(coverage.limitationNote, /bekende beperking/i);
  assert.match(coverage.limitationNote, /4 kwartieren/i);
});

test('computes missing count and percentage', () => {
  const coverage = computePriceCoverage(
    matchResult({
      matched: [{ priceEurKwh: 0.1 }, { priceEurKwh: null }, { priceEurKwh: null }, { priceEurKwh: 0.2 }],
      consumptionIntervalMinutes: 60,
      priceIntervalMinutes: 60
    })
  );
  assert.equal(coverage.matchedCount, 2);
  assert.equal(coverage.missingCount, 2);
  assert.equal(coverage.missingPercentage, 50);
});

test('assertPriceCoverageSufficient passes under the 5% threshold', () => {
  assert.doesNotThrow(() => assertPriceCoverageSufficient({ missingPercentage: 4.9 }));
});

test('assertPriceCoverageSufficient throws over the 5% threshold', () => {
  assert.throws(() => assertPriceCoverageSufficient({ missingPercentage: 5.1 }), /te veel ontbrekende prijzen/i);
});

test('assertPriceCoverageSufficient respects a custom threshold', () => {
  assert.throws(() => assertPriceCoverageSufficient({ missingPercentage: 1 }, 0.5), /te veel ontbrekende prijzen/i);
});

// Pure functies: data in, samenvatting uit.
'use strict';

import { detectIntervalMs } from './amsterdamTime.js';

/**
 * Berekent de verplichte validatiegegevens over een reeks intervallen:
 * totalen, dekking t.o.v. verwacht aantal, gaten, eerste/laatste tijdstip.
 * Bevat nog geen prijsdekking — dat komt in stap 3, samen met de prijsdata.
 */
export function computeCoverageSummary(intervals) {
  if (intervals.length === 0) {
    throw new Error('Kan geen validatiesamenvatting maken: geen intervallen');
  }

  const sorted = [...intervals].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const timestampsMs = sorted.map((iv) => Date.parse(iv.timestamp));

  const uniqueMs = [...new Set(timestampsMs)];
  if (uniqueMs.length !== timestampsMs.length) {
    throw new Error('Dataset bevat dubbele timestamps voor hetzelfde interval');
  }

  const intervalMs = detectIntervalMs(uniqueMs);
  const intervalMinutes = intervalMs / 60000;
  if (intervalMinutes !== 15 && intervalMinutes !== 60) {
    throw new Error(
      `Onverwachte intervalduur van ${intervalMinutes} minuten gedetecteerd; alleen kwartier- en uurintervallen worden ondersteund`
    );
  }

  const first = uniqueMs[0];
  const last = uniqueMs[uniqueMs.length - 1];
  const expectedCount = Math.round((last - first) / intervalMs) + 1;
  const actualCount = uniqueMs.length;
  const missingCount = expectedCount - actualCount;

  let totalImportKwh = 0;
  let totalExportKwh = 0;
  for (const iv of sorted) {
    totalImportKwh += iv.importKwh;
    totalExportKwh += iv.exportKwh;
  }

  return {
    intervalMinutes,
    firstTimestamp: sorted[0].timestamp,
    lastTimestamp: sorted[sorted.length - 1].timestamp,
    expectedCount,
    actualCount,
    missingCount,
    missingPercentage: (missingCount / expectedCount) * 100,
    totalImportKwh,
    totalExportKwh
  };
}

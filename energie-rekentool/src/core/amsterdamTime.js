// Platformonafhankelijk: gebruikt alleen Intl, geen fs/netwerk. Werkt zowel in
// Node als in de browser, zodat de rekenkern later ongewijzigd hergebruikt kan worden.
'use strict';

const WALL_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;
const AMSTERDAM_OFFSETS_MIN = [120, 60]; // CEST (+02:00), CET (+01:00) — de enige twee mogelijke offsets

// Eén herbruikte formatter (i.p.v. per aanroep aanmaken) scheelt aanzienlijk
// bij datasets van een jaar of meer op kwartierresolutie.
const OFFSET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Amsterdam',
  timeZoneName: 'longOffset',
  hour12: false
});

function amsterdamOffsetMinutesAt(utcMs) {
  const part = OFFSET_FORMATTER.formatToParts(new Date(utcMs)).find((p) => p.type === 'timeZoneName');
  const match = /GMT([+-]\d+)(?::(\d+))?/.exec(part ? part.value : '');
  if (!match) throw new Error(`Kon Europe/Amsterdam-offset niet bepalen voor ${new Date(utcMs).toISOString()}`);
  const hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  return hours * 60 + (hours < 0 ? -minutes : minutes);
}

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function parseWallTime(wallTime) {
  const match = WALL_TIME_RE.exec(wallTime.trim());
  if (!match) {
    throw new Error(`Onherkenbare tijdnotatie: "${wallTime}" (verwacht "YYYY-MM-DD HH:MM")`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5])
  };
}

/**
 * Zet een absoluut UTC-instant (ms sinds epoch) om naar een ISO 8601-string
 * met het Europe/Amsterdam-offset op dat instant. In tegenstelling tot de
 * wandkloktijd-functies hierboven is dit ondubbelzinnig: een echt UTC-instant
 * kan nooit in het overgeslagen of herhaalde DST-uur vallen.
 */
export function utcMsToAmsterdamIso(utcMs) {
  const offset = amsterdamOffsetMinutesAt(utcMs);
  // Lokale wandkloktijd = UTC-instant + offset; UTC-getters op die verschoven
  // waarde geven direct de lokale kalendercijfers, zonder extra Intl-call.
  const d = new Date(utcMs + offset * 60000);
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const offsetStr = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${offsetStr}`
  );
}

/**
 * Zet een naïeve lokale wandkloktijd ("2025-06-01 14:30" of ISO-achtig met T)
 * om naar een ISO 8601-string met het correcte Europe/Amsterdam-offset.
 *
 * Losstaand (zonder omringende rijen) is een tijdstip in het herhaalde
 * najaars-DST-uur ambigu — gebruik in dat geval localAmsterdamWallTimesToIso
 * met de volledige, chronologisch gesorteerde reeks om correct te disambigueren.
 */
export function localAmsterdamWallTimeToIso(wallTime) {
  const { year, month, day, hour, minute } = parseWallTime(wallTime);
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  const guessOffset = amsterdamOffsetMinutesAt(guessUtcMs);
  const candidateUtcMs = guessUtcMs - guessOffset * 60000;
  // Herbevestig op de kandidaat-instant, voor het geval de gok net over een
  // DST-grens heen viel.
  const offset = amsterdamOffsetMinutesAt(candidateUtcMs);
  return utcMsToAmsterdamIso(guessUtcMs - offset * 60000);
}

/**
 * Zet een chronologisch gesorteerde reeks naïeve lokale wandkloktijden om naar
 * ISO 8601-strings, met correcte afhandeling van DST-overgangen:
 *  - het herhaalde uur bij de najaarsovergang (bv. twee keer "02:15") wordt
 *    ondubbelzinnig aan de vroegere (CEST) en latere (CET) instant toegekend
 *    op basis van de volgorde in de reeks;
 *  - het overgeslagen uur bij de lenteovergang bestaat niet in de praktijk op
 *    een echte meter en hoeft hier niet apart afgehandeld te worden.
 */
export function localAmsterdamWallTimesToIso(wallTimes) {
  const results = [];
  let previousUtcMs = -Infinity;

  for (const wallTime of wallTimes) {
    const { year, month, day, hour, minute } = parseWallTime(wallTime);
    const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute);

    const validCandidates = [];
    for (const offsetMin of AMSTERDAM_OFFSETS_MIN) {
      const candidateUtcMs = guessUtcMs - offsetMin * 60000;
      if (amsterdamOffsetMinutesAt(candidateUtcMs) === offsetMin) {
        validCandidates.push(candidateUtcMs);
      }
    }
    validCandidates.sort((a, b) => a - b);

    let chosenUtcMs;
    if (validCandidates.length === 0) {
      // Niet-bestaande lokale tijd (lenteovergang-gat): beste-poging fallback.
      const offset = amsterdamOffsetMinutesAt(guessUtcMs);
      chosenUtcMs = guessUtcMs - offset * 60000;
    } else {
      chosenUtcMs = validCandidates.find((c) => c > previousUtcMs);
      if (chosenUtcMs === undefined) chosenUtcMs = validCandidates[validCandidates.length - 1];
    }

    results.push(utcMsToAmsterdamIso(chosenUtcMs));
    previousUtcMs = chosenUtcMs;
  }

  return results;
}

const WALL_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

/** Formatteert een UTC-epoch (ms) als naïeve lokale Amsterdam-wandkloktijd "YYYY-MM-DD HH:MM". */
export function formatAmsterdamWallTime(utcMs) {
  const parts = Object.fromEntries(WALL_TIME_FORMATTER.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}`;
}

/**
 * Bepaalt de meest voorkomende afstand (in ms) tussen opeenvolgende, oplopend
 * gesorteerde epoch-timestamps. Gebruikt de modus in plaats van het eerste
 * verschil, zodat een gat aan het begin van de dataset de detectie niet verstoort.
 */
export function detectIntervalMs(sortedTimestampsMs) {
  if (sortedTimestampsMs.length < 2) {
    throw new Error('Kan intervalduur niet bepalen: minstens twee tijdstippen nodig');
  }
  const counts = new Map();
  let best = null;
  for (let i = 1; i < sortedTimestampsMs.length; i++) {
    const delta = sortedTimestampsMs[i] - sortedTimestampsMs[i - 1];
    if (delta <= 0) continue; // duplicaten/onsortering worden elders gevalideerd
    const count = (counts.get(delta) || 0) + 1;
    counts.set(delta, count);
    if (!best || count > best.count) best = { delta, count };
  }
  if (!best) {
    throw new Error('Kan intervalduur niet bepalen: geen oplopende tijdstippen gevonden');
  }
  return best.delta;
}

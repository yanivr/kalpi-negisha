/**
 * Street names: normalisation shared by the build-time matcher (official street list ↔ OpenStreetMap)
 * and the in-page street suggestions. Deterministic, no fuzzy guessing beyond these explicit rules.
 */

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/(^| )שד(?:'|׳)?(?= |$)/g, '$1שדרות'],
  [/(^| )שדר(?:'|׳)(?= |$)/g, '$1שדרות'],
  [/(^| )סמ(?:'|׳)(?= |$)/g, '$1סמטת'],
  [/(^| )סמטה(?= |$)/g, '$1סמטת'],
  [/(^| )רח(?:'|׳)(?= |$)/g, '$1'],
  [/(^| )כ(?:'|׳)(?= |$)/g, '$1כיכר'],
  [/(^| )ככר(?= |$)/g, '$1כיכר'],
  [/(^| )הרב(?= |$)/g, '$1הרב'],
  [/(^| )ד"ר(?= |$)/g, '$1דר'],
  [/(^| )דוקטור(?= |$)/g, '$1דר'],
  [/(^| )פרופ(?:'|׳)?(?= |$)/g, '$1פרופסור'],
];

/** Normalised comparison form of a Hebrew street name. */
export function normaliseStreet(name: string): string {
  let s = ` ${name} `
    .replace(/[֑-ׇ]/g, '') // niqqud and cantillation
    .replace(/[״“”]/g, '"')
    .replace(/[׳‘’`]/g, "'")
    .replace(/[-–—־_.,()/\\]/g, ' ')
    .replace(/\s+/g, ' ');
  s = s.replace(/^ רחוב /, ' ').replace(/^ רח' /, ' ');
  for (const [re, rep] of ABBREVIATIONS) s = s.replace(re, rep);
  return s
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Order-independent form ("חנה אברך" ≡ "אברך חנה"), used only as a secondary match. */
export function tokenKey(name: string): string {
  return normaliseStreet(name).split(' ').filter(Boolean).sort().join(' ');
}

export interface OfficialStreet {
  code: number;
  nameHe: string;
  aliases: string[];
}

/** Suggestions for what the user typed: prefix matches first, then contains; each street listed once. */
export function suggestStreets(streets: OfficialStreet[], typed: string, limit = 8): OfficialStreet[] {
  const q = normaliseStreet(typed);
  if (!q) return [];
  const scored: Array<[number, OfficialStreet]> = [];
  for (const s of streets) {
    let best = Infinity;
    for (const n of [s.nameHe, ...s.aliases]) {
      const k = normaliseStreet(n);
      if (k === q) best = Math.min(best, 0);
      else if (k.startsWith(q)) best = Math.min(best, 1);
      else if (k.split(' ').some((w) => w.startsWith(q))) best = Math.min(best, 2);
      else if (k.includes(q)) best = Math.min(best, 3);
    }
    if (best < Infinity) scored.push([best, s]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].nameHe.length - b[1].nameHe.length || a[1].nameHe.localeCompare(b[1].nameHe, 'he'))
    .slice(0, limit)
    .map(([, s]) => s);
}

/** Exact match of the typed text to one official street (name or alias), else null. */
export function exactStreet(streets: OfficialStreet[], typed: string): OfficialStreet | null {
  const q = normaliseStreet(typed);
  if (!q) return null;
  const hits = streets.filter((s) => [s.nameHe, ...s.aliases].some((n) => normaliseStreet(n) === q));
  return hits.length === 1 ? hits[0]! : null;
}

/** "12", "12א", "12 א" → "12א"; anything else → null. */
export function normaliseHouse(h: string): string | null {
  const m = /^\s*(\d{1,4})\s*([א-ת])?\s*$/.exec(h);
  return m ? `${Number(m[1])}${m[2] ?? ''}` : null;
}

/**
 * Locates a house number from the known numbers on the same street: exact match, else linear interpolation between
 * the nearest lower and higher numbers on the same side (same parity, at most 40 apart), else the nearest number on
 * the same side within 6. Returns null when the street has no usable neighbours.
 */
export function locateHouse(
  numbers: Record<string, { lat: number; lon: number }> | null,
  house: string,
): { point: { lat: number; lon: number }; kind: 'exact' | 'interpolated' | 'nearby' } | null {
  if (!numbers) return null;
  if (numbers[house]) return { point: numbers[house]!, kind: 'exact' };
  const n = Number(/^\d+/.exec(house)?.[0]);
  if (!Number.isFinite(n)) return null;
  const known = Object.entries(numbers)
    .map(([k, p]) => ({ n: Number(/^\d+/.exec(k)?.[0]), p, plain: /^\d+$/.test(k) }))
    .filter((x) => Number.isFinite(x.n) && x.plain && x.n % 2 === n % 2);
  const lower = known.filter((x) => x.n < n).sort((a, b) => b.n - a.n)[0];
  const higher = known.filter((x) => x.n > n).sort((a, b) => a.n - b.n)[0];
  if (lower && higher && higher.n - lower.n <= 40) {
    const f = (n - lower.n) / (higher.n - lower.n);
    return { point: { lat: lower.p.lat + (higher.p.lat - lower.p.lat) * f, lon: lower.p.lon + (higher.p.lon - lower.p.lon) * f }, kind: 'interpolated' };
  }
  const near = [lower, higher].filter((x): x is NonNullable<typeof x> => !!x && Math.abs(x.n - n) <= 6).sort((a, b) => Math.abs(a.n - n) - Math.abs(b.n - n))[0];
  return near ? { point: near.p, kind: 'nearby' } : null;
}

/** Comparison form of a locality name: street normalisation plus spelling variants (קריית/קרית, תקווה/תקוה) and case. */
export function localityKey(name: string): string {
  return normaliseStreet(name).replace(/יי/g, 'י').replace(/וו/g, 'ו').toLowerCase();
}

export interface LocalityOption {
  code: string;
  name: string;
  /** Other accepted names: the official English name and common abbreviations. */
  aliases: string[];
}

/** Suggestions for a typed locality: exact, then prefix, then word-start, then contains; each locality once. */
export function suggestLocalities(list: LocalityOption[], typed: string, limit = 8): LocalityOption[] {
  const q = localityKey(typed);
  if (!q) return [];
  const scored: Array<[number, LocalityOption]> = [];
  for (const l of list) {
    let best = Infinity;
    for (const n of [l.name, ...l.aliases]) {
      const k = localityKey(n);
      if (k === q) best = Math.min(best, 0);
      else if (k.startsWith(q)) best = Math.min(best, 1);
      else if (k.split(' ').some((w) => w.startsWith(q))) best = Math.min(best, 2);
      else if (q.length >= 2 && k.includes(q)) best = Math.min(best, 3);
    }
    if (best < Infinity) scored.push([best, l]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length || a[1].name.localeCompare(b[1].name, 'he'))
    .slice(0, limit)
    .map(([, l]) => l);
}

/** The one locality whose name or alias equals the typed text, else null. */
export function exactLocality(list: LocalityOption[], typed: string): LocalityOption | null {
  const q = localityKey(typed);
  if (!q) return null;
  const hits = list.filter((l) => [l.name, ...l.aliases].some((n) => localityKey(n) === q));
  return hits.length === 1 ? hits[0]! : null;
}

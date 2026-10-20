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

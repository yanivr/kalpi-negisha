/**
 * Matches OpenStreetMap streets (already assigned to localities by build-street-index.ts) to the official street
 * list, and writes the per-locality geo files plus an accuracy report.
 *
 *   tsx scripts/geo/match.ts --assigned geo-index/osm-assigned.json.gz --georef state/geo-ref.json --out geo-index
 *
 * Matching rules, in order (each only within one locality; a rule that yields more than one official street is skipped):
 *   1. exact normalised name (official name or synonym ↔ any OSM name variant)
 *   2. same words in any order
 *   3. same words after removing titles (רב אלוף, פרופ', ד"ר, הרב …) and a leading definite article
 *   4. all words of exactly one official street appear in the OSM name (e.g. official "גולומב" ↔ OSM "אליהו גולומב"),
 *      choosing the official street with the most shared words; ties are skipped.
 * Accuracy is measured against official CEC compound addresses (street + house + coordinates), which are not copied.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { airDistanceMeters } from '../../src/domain/geo';
import { normaliseHouse, normaliseStreet, type OfficialStreet } from '../../src/domain/streets';

const { values } = parseArgs({ options: { assigned: { type: 'string' }, georef: { type: 'string' }, out: { type: 'string' }, streets: { type: 'string' } } });
const OUT = path.resolve(values.out ?? 'geo-index');
const STREETS_DIR = values.streets ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../node_modules/@il-address/data/generated/streets');

type Pt = [number, number];
interface Assigned {
  osmTimestamp: number | null;
  assigned: Record<string, { ways: Array<[string[], Pt[]]>; addrs: Array<[string, string, number, number]> }>;
}
const data = JSON.parse(gunzipSync(await readFile(values.assigned!)).toString()) as Assigned;
const georef = JSON.parse(await readFile(values.georef!, 'utf8')) as {
  localities: Record<string, unknown>;
  compounds: Array<{ loc: string; street: string | null; house: string | null; lat: number; lon: number }>;
};

const TITLES = new Set([
  'רב', 'אלוף', 'רבאלוף', 'ראל', 'תאל', 'אלם', 'סאל', 'פרופסור', 'פרופ', 'פרופסורית', 'דר', 'דוקטור', 'הרב', 'הרבנית', 'רבי', 'ר',
  'השופט', 'השופטת', 'המשורר', 'המשוררת', 'הסופר', 'הנשיא', 'הגאון', 'האדמור', 'אדמור', 'מרן', 'רבנו', 'רבינו', 'החכם', 'חכם',
  'שדרות', 'שדרת', 'סמטת', 'רחוב', 'כיכר', 'מעלה', 'משעול', 'מבוא', 'מדרחוב', 'טיילת', 'גן', 'שכונת', 'שכ', 'ש',
  'האחים', 'אחים', 'ושרה',
]);
function words(name: string): string[] {
  return normaliseStreet(name).split(' ').filter(Boolean);
}
function core(name: string): string[] {
  const w = words(name).filter((x) => !TITLES.has(x));
  return w.map((x, i) => (i === 0 && x.length >= 4 && x.startsWith('ה') ? x.slice(1) : x));
}
const key = (ws: string[]) => [...ws].sort().join(' ');

interface Index {
  exact: Map<string, Set<number>>;
  tokens: Map<string, Set<number>>;
  core: Map<string, Set<number>>;
  coreWords: Array<{ code: number; words: Set<string> }>;
}
function buildIndex(list: OfficialStreet[]): Index {
  const idx: Index = { exact: new Map(), tokens: new Map(), core: new Map(), coreWords: [] };
  const add = (m: Map<string, Set<number>>, k: string, c: number) => k && (m.get(k) ?? m.set(k, new Set()).get(k)!).add(c);
  for (const s of list) {
    const all = new Set<string>();
    for (const n of [s.nameHe, ...s.aliases]) {
      add(idx.exact, normaliseStreet(n), s.code);
      add(idx.tokens, key(words(n)), s.code);
      const c = core(n);
      add(idx.core, key(c), s.code);
      c.forEach((w) => all.add(w));
      if (c.length) idx.coreWords.push({ code: s.code, words: new Set(c) });
    }
    void all;
  }
  return idx;
}
let lastLevel = 0;
const unique = (s: Set<number> | undefined) => (s && s.size === 1 ? [...s][0]! : null);

function match(idx: Index, names: string[], stats: { exact: number; tokens: number; core: number; subset: number }): number | null {
  lastLevel = 0;
  for (const n of names) {
    const c = unique(idx.exact.get(normaliseStreet(n)));
    if (c) return stats.exact++, (lastLevel = 1), c;
  }
  for (const n of names) {
    const c = unique(idx.tokens.get(key(words(n))));
    if (c) return stats.tokens++, (lastLevel = 1), c;
  }
  for (const n of names) {
    const c = unique(idx.core.get(key(core(n))));
    if (c) return stats.core++, (lastLevel = 2), c;
  }
  for (const n of names) {
    const osm = new Set(core(n));
    if (osm.size === 0) continue;
    let best: number | null = null;
    let bestSize = 0;
    let tie = false;
    for (const { code, words: w } of idx.coreWords) {
      if (w.size === 0 || w.size > osm.size) continue;
      let all = true;
      for (const x of w) if (!osm.has(x)) all = false;
      if (!all) continue;
      // a single short generic word (e.g. "הגפן") must equal the whole OSM core, not just be part of it
      if (w.size === 1 && osm.size > 1 && [...w][0]!.length < 4) continue;
      if (w.size > bestSize) {
        best = code;
        bestSize = w.size;
        tie = false;
      } else if (w.size === bestSize && code !== best) tie = true;
    }
    if (best !== null && !tie) return stats.subset++, (lastLevel = 3), best;
  }
  return null;
}

const official = new Map<string, OfficialStreet[]>();
for (const f of await readdir(STREETS_DIR)) if (f.endsWith('.json')) official.set(f.replace('.json', ''), JSON.parse(await readFile(path.join(STREETS_DIR, f), 'utf8')));

const stats = { exact: 0, tokens: 0, core: 0, subset: 0, unmatchedWays: 0 };
const out = new Map<string, Map<number, { pts: Pt[]; nums: Record<string, Pt>; strong: Pt[]; weak: Pt[] }>>();
const entry = (loc: string, code: number) => {
  const m = out.get(loc) ?? out.set(loc, new Map()).get(loc)!;
  return m.get(code) ?? m.set(code, { pts: [], nums: {}, strong: [], weak: [] }).get(code)!;
};
const indexes = new Map<string, Index>();
const indexFor = (loc: string) => {
  if (!indexes.has(loc)) indexes.set(loc, buildIndex(official.get(loc) ?? []));
  return indexes.get(loc)!;
};
for (const [loc, a] of Object.entries(data.assigned)) {
  const idx = indexFor(loc);
  for (const [names, pts] of a.ways) {
    const code = match(idx, names, stats);
    if (!code) {
      stats.unmatchedWays++;
      continue;
    }
    const e = entry(loc, code);
    (lastLevel === 1 ? e.strong : e.weak).push(...pts);
  }
  for (const [street, house, lat, lon] of a.addrs) {
    const code = match(idx, [street], { exact: 0, tokens: 0, core: 0, subset: 0 });
    const h = normaliseHouse(house);
    if (code && h) entry(loc, code).nums[h] ??= [lat, lon];
  }
}

// Where a street has exact-name matches, looser matches far from them belong to other streets: drop those.
for (const m of out.values())
  for (const e of m.values()) {
    const keepWeak = e.strong.length === 0 ? e.weak : e.weak.filter((p) => e.strong.some((q) => airDistanceMeters({ lat: p[0], lon: p[1] }, { lat: q[0], lon: q[1] }) <= 1000));
    e.pts = [...e.strong, ...keepWeak];
  }

// House-number points must lie near their street's line (else they belong to a same-named street elsewhere).
for (const m of out.values())
  for (const e of m.values()) {
    if (!e.pts.length) continue;
    for (const [h, p] of Object.entries(e.nums)) {
      const near = e.pts.some((q) => airDistanceMeters({ lat: p[0], lon: p[1] }, { lat: q[0], lon: q[1] }) <= 1500);
      if (!near) delete e.nums[h];
    }
  }

// A "street" named like its locality (common in villages without street names) is not a street: no geometry.
for (const [loc, m] of out) {
  const locName = normaliseStreet(String((georef.localities[loc] as { name?: string } | undefined)?.name ?? ''));
  if (!locName) continue;
  for (const s of official.get(loc) ?? []) {
    if ([s.nameHe, ...s.aliases].some((n) => normaliseStreet(n) === locName || locName.startsWith(normaliseStreet(n) + ' '))) m.delete(s.code);
  }
}

// Streets known only from address points still get a location: use those points as the street's points.
for (const m of out.values())
  for (const e of m.values()) if (e.pts.length === 0 && Object.keys(e.nums).length) e.pts = Object.values(e.nums);

// Outlier guard: drop street points far from the street's own median (a mis-assigned piece of a same-named street).
for (const m of out.values())
  for (const e of m.values()) {
    if (e.pts.length < 3) continue;
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const c = { lat: med(e.pts.map((p) => p[0])), lon: med(e.pts.map((p) => p[1])) };
    e.pts = e.pts.filter((p) => airDistanceMeters(c, { lat: p[0], lon: p[1] }) <= 6000);
  }

await mkdir(path.join(OUT, 'geo'), { recursive: true });
const coverage: Record<string, { streets: number; withGeometry: number; withNumbers: number }> = {};
for (const loc of new Set([...Object.keys(georef.localities), ...official.keys()])) {
  const list = official.get(loc) ?? [];
  const geo = out.get(loc) ?? new Map();
  const streets = list.map((s) => {
    const g = geo.get(s.code);
    return [s.code, s.nameHe, s.aliases, g && g.pts.length ? g.pts : null, g && Object.keys(g.nums).length ? g.nums : null];
  });
  coverage[loc] = { streets: list.length, withGeometry: streets.filter((s) => s[3]).length, withNumbers: streets.filter((s) => s[4]).length };
  await writeFile(path.join(OUT, 'geo', `${loc}.json`), JSON.stringify({ v: 1, loc, streets }));
}

// Accuracy on official compound addresses.
const errors: number[] = [];
let unresolvedStreet = 0;
let noGeometry = 0;
let byNumber = 0;
const bad: Array<[string, string, string | null, number]> = [];
for (const c of georef.compounds) {
  if (!c.street) continue;
  const code = match(indexFor(c.loc), [c.street], { exact: 0, tokens: 0, core: 0, subset: 0 });
  if (!code) {
    unresolvedStreet++;
    continue;
  }
  const g = out.get(c.loc)?.get(code);
  if (!g || !g.pts.length) {
    noGeometry++;
    continue;
  }
  const h = c.house ? normaliseHouse(c.house) : null;
  const t = { lat: c.lat, lon: c.lon };
  const p = h && g.nums[h] ? g.nums[h]! : null;
  if (p) byNumber++;
  const d = p ? airDistanceMeters(t, { lat: p[0], lon: p[1] }) : Math.min(...g.pts.map((q) => airDistanceMeters(t, { lat: q[0], lon: q[1] })));
  errors.push(d);
  if (d > 500) bad.push([c.loc, c.street, c.house, Math.round(d)]);
}
errors.sort((a, b) => a - b);
const q = (f: number) => Math.round(errors[Math.floor(errors.length * f)] ?? NaN);
const totals = Object.values(coverage).reduce((a, c) => ({ streets: a.streets + c.streets, withGeometry: a.withGeometry + c.withGeometry, withNumbers: a.withNumbers + c.withNumbers }), { streets: 0, withGeometry: 0, withNumbers: 0 });
const report = {
  osmTimestamp: data.osmTimestamp ? new Date(data.osmTimestamp * 1000).toISOString() : null,
  officialStreetsSource: 'data.gov.il רשימת רחובות בישראל (resource bf185c7f-1a4e-4662-88c5-fa118a244bda) via @il-address/data',
  matchStats: stats,
  totals,
  accuracy: {
    compoundsWithStreet: errors.length + unresolvedStreet + noGeometry,
    resolved: errors.length,
    resolvedByHouseNumber: byNumber,
    streetNotInOfficialList: unresolvedStreet,
    streetWithoutGeometry: noGeometry,
    medianM: q(0.5),
    p90M: q(0.9),
    p95M: q(0.95),
    p99M: q(0.99),
    within300m: errors.filter((e) => e <= 300).length,
    over500m: bad.length,
  },
  over500mSample: bad.slice(0, 40),
  coverage,
};
await writeFile(path.join(OUT, 'geo-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ matchStats: stats, totals, accuracy: report.accuracy }, null, 2));

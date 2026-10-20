/**
 * Builds the per-locality street geometry index used for "type your street" search.
 *
 *   tsx scripts/geo/build-street-index.ts --pbf israel-and-palestine-latest.osm.pbf --out geo-index
 *
 * Inputs
 *  - OpenStreetMap extract (Geofabrik, ODbL) — street lines and address points.
 *  - Official street list per locality (data.gov.il via @il-address/data) — names, codes and synonyms.
 *  - Official CEC compounds (state/geo-ref.json) — locality extents, and official (street, house, point) triples
 *    used ONLY to measure accuracy, never copied into the index.
 *
 * Locality assignment: every OSM street/address is assigned to the locality whose official compound is nearest,
 * among localities whose extent (+ margin) contains it. Names are then matched within that locality only.
 * Output per locality: geo/<code>.json — official streets with sampled points and known house numbers.
 */
import { createOSMStream } from 'osm-pbf-parser-node';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { airDistanceMeters } from '../../src/domain/geo';
import { normaliseHouse, normaliseStreet, tokenKey, type OfficialStreet } from '../../src/domain/streets';

const { values } = parseArgs({ options: { pbf: { type: 'string' }, out: { type: 'string' }, georef: { type: 'string' }, streets: { type: 'string' } } });
const PBF = values.pbf!;
const OUT = path.resolve(values.out ?? 'geo-index');
const GEOREF = values.georef ?? path.join(process.env.STATE_DIR ?? 'state', 'geo-ref.json');
const STREETS_DIR = values.streets ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../node_modules/@il-address/data/generated/streets');
const MARGIN_DEG = 0.012; // ≈ 1.3 km
const SAMPLE_M = 120;

interface GeoRef {
  localities: Record<string, { name: string; bbox: [number, number, number, number]; n: number }>;
  compounds: Array<{ loc: string; street: string | null; house: string | null; lat: number; lon: number }>;
}
const georef = JSON.parse(await readFile(GEOREF, 'utf8')) as GeoRef;

// ---- spatial helper: nearest compound's locality (grid bucketed) ----
const CELL = 0.02;
const grid = new Map<string, Array<{ loc: string; lat: number; lon: number }>>();
const cellKey = (lat: number, lon: number) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;
for (const c of georef.compounds) {
  const k = cellKey(c.lat, c.lon);
  (grid.get(k) ?? grid.set(k, []).get(k)!).push(c);
}
function assignLocality(lat: number, lon: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  const ci = Math.floor(lat / CELL);
  const cj = Math.floor(lon / CELL);
  for (let di = -2; di <= 2; di++)
    for (let dj = -2; dj <= 2; dj++)
      for (const c of grid.get(`${ci + di}:${cj + dj}`) ?? []) {
        const b = georef.localities[c.loc]!.bbox;
        if (lat < b[0] - MARGIN_DEG || lat > b[2] + MARGIN_DEG || lon < b[1] - MARGIN_DEG || lon > b[3] + MARGIN_DEG) continue;
        const d = (c.lat - lat) ** 2 + ((c.lon - lon) * 0.85) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c.loc;
        }
      }
  return best;
}

// ---- pass 1: collect named streets and address features ----
const HIGHWAY_OK = /^(residential|living_street|tertiary|secondary|primary|unclassified|pedestrian|service|footway|path|steps|road|trunk|cycleway|track)(_link)?$/;
const streetWays: Array<{ names: string[]; refs: number[] }> = [];
const addrNodes = new Map<number, { street: string; house: string }>();
const addrWays: Array<{ street: string; house: string; ref: number }> = [];
const neededNodes = new Set<number>();

const nameTags = (t: Record<string, string>) =>
  [t['name:he'], t.name, t['alt_name:he'], t.alt_name, t['old_name:he'], t.old_name, t['official_name:he'], t.official_name]
    .filter((x): x is string => !!x)
    .flatMap((x) => x.split(';'))
    .filter((x) => /[א-ת]/.test(x));

let header: unknown = null;
for await (const item of createOSMStream(PBF, { withInfo: false, withTags: true }) as AsyncGenerator<any>) {
  if (!item.type) {
    header = item;
    continue;
  }
  const t = item.tags ?? {};
  if (item.type === 'way' && t.highway && HIGHWAY_OK.test(t.highway)) {
    const names = nameTags(t);
    if (names.length) {
      streetWays.push({ names, refs: item.refs });
      for (const r of item.refs) neededNodes.add(r);
    }
  }
  const street = t['addr:street'];
  const house = t['addr:housenumber'] ? normaliseHouse(t['addr:housenumber']) : null;
  if (street && house && /[א-ת]/.test(street)) {
    if (item.type === 'node') addrNodes.set(item.id, { street, house });
    else if (item.type === 'way' && item.refs?.length) {
      addrWays.push({ street, house, ref: item.refs[0] });
      neededNodes.add(item.refs[0]);
    }
  }
}
console.log(`pass1: ${streetWays.length} named ways, ${addrNodes.size} address nodes, ${addrWays.length} address ways`);

// ---- pass 2: node coordinates ----
const coords = new Map<number, [number, number]>();
for await (const item of createOSMStream(PBF, { withInfo: false, withTags: false }) as AsyncGenerator<any>) {
  if (item.type === 'node' && (neededNodes.has(item.id) || addrNodes.has(item.id))) coords.set(item.id, [item.lat, item.lon]);
}
console.log(`pass2: ${coords.size} coordinates`);

// ---- official streets per locality ----
const official = new Map<string, OfficialStreet[]>();
for (const f of await readdir(STREETS_DIR)) {
  if (!f.endsWith('.json')) continue;
  official.set(f.replace('.json', ''), JSON.parse(await readFile(path.join(STREETS_DIR, f), 'utf8')));
}

// name index per locality: normalised name → official street code (ambiguous names are dropped)
function buildNameIndex(list: OfficialStreet[]) {
  const exact = new Map<string, number | null>();
  const tokens = new Map<string, number | null>();
  const put = (m: Map<string, number | null>, k: string, code: number) => {
    if (!k) return;
    const prev = m.get(k);
    m.set(k, prev === undefined || prev === code ? code : null);
  };
  for (const s of list) for (const n of [s.nameHe, ...s.aliases]) {
    put(exact, normaliseStreet(n), s.code);
    put(tokens, tokenKey(n), s.code);
  }
  return { exact, tokens };
}
const nameIndex = new Map([...official].map(([loc, list]) => [loc, buildNameIndex(list)]));
function matchName(loc: string, names: string[]): number | null {
  const idx = nameIndex.get(loc);
  if (!idx) return null;
  for (const n of names) {
    const c = idx.exact.get(normaliseStreet(n));
    if (c) return c;
  }
  for (const n of names) {
    const c = idx.tokens.get(tokenKey(n));
    if (c) return c;
  }
  return null;
}

// ---- build ----
type Pt = [number, number];
const out = new Map<string, Map<number, { pts: Pt[]; nums: Record<string, Pt> }>>();
const entry = (loc: string, code: number) => {
  const m = out.get(loc) ?? out.set(loc, new Map()).get(loc)!;
  return m.get(code) ?? m.set(code, { pts: [], nums: {} }).get(code)!;
};
const round = (p: Pt): Pt => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

let matchedWays = 0;
for (const w of streetWays) {
  const pts = w.refs.map((r) => coords.get(r)).filter((p): p is Pt => !!p);
  if (pts.length === 0) continue;
  const mid = pts[Math.floor(pts.length / 2)]!;
  const loc = assignLocality(mid[0], mid[1]);
  if (!loc) continue;
  const code = matchName(loc, w.names);
  if (!code) continue;
  matchedWays++;
  const e = entry(loc, code);
  // sample along the line every ~SAMPLE_M metres (always keep both ends)
  let last: Pt | null = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (!last || i === pts.length - 1 || airDistanceMeters({ lat: last[0], lon: last[1] }, { lat: p[0], lon: p[1] }) >= SAMPLE_M) {
      e.pts.push(round(p));
      last = p;
    }
  }
}
let matchedAddr = 0;
const addAddr = (street: string, house: string, p: Pt | undefined) => {
  if (!p) return;
  const loc = assignLocality(p[0], p[1]);
  if (!loc) return;
  const code = matchName(loc, [street]);
  if (!code) return;
  matchedAddr++;
  entry(loc, code).nums[house] ??= round(p);
};
for (const [id, a] of addrNodes) addAddr(a.street, a.house, coords.get(id));
for (const a of addrWays) addAddr(a.street, a.house, coords.get(a.ref));
console.log(`matched: ${matchedWays}/${streetWays.length} ways, ${matchedAddr} address points`);

// ---- write per-locality files (all official streets; geometry where matched) ----
await mkdir(path.join(OUT, 'geo'), { recursive: true });
const osmTimestamp = (header as any)?.osmosis_replication_timestamp ? new Date((header as any).osmosis_replication_timestamp * 1000).toISOString() : null;
const coverage: Record<string, { streets: number; withGeometry: number; withNumbers: number }> = {};
for (const loc of new Set([...Object.keys(georef.localities), ...official.keys()])) {
  const list = official.get(loc) ?? [];
  const geo = out.get(loc) ?? new Map();
  const streets = list.map((s) => {
    const g = geo.get(s.code);
    return [s.code, s.nameHe, s.aliases, g && g.pts.length ? g.pts : null, g && Object.keys(g.nums).length ? g.nums : null];
  });
  coverage[loc] = {
    streets: list.length,
    withGeometry: streets.filter((s) => s[3]).length,
    withNumbers: streets.filter((s) => s[4]).length,
  };
  await writeFile(path.join(OUT, 'geo', `${loc}.json`), JSON.stringify({ v: 1, loc, streets }));
}

// ---- accuracy against official compound addresses (never copied into the index) ----
const errors: number[] = [];
let unresolved = 0;
for (const c of georef.compounds) {
  if (!c.street) continue;
  const code = matchName(c.loc, [c.street]);
  const g = code ? out.get(c.loc)?.get(code) : undefined;
  if (!g || g.pts.length === 0) {
    unresolved++;
    continue;
  }
  const house = c.house ? normaliseHouse(c.house) : null;
  const target = { lat: c.lat, lon: c.lon };
  const p = house && g.nums[house] ? g.nums[house]! : null;
  const d = p
    ? airDistanceMeters(target, { lat: p[0], lon: p[1] })
    : Math.min(...g.pts.map((q) => airDistanceMeters(target, { lat: q[0], lon: q[1] })));
  errors.push(d);
}
errors.sort((a, b) => a - b);
const q = (f: number) => Math.round(errors[Math.floor(errors.length * f)] ?? NaN);
const totals = Object.values(coverage).reduce((a, c) => ({ streets: a.streets + c.streets, withGeometry: a.withGeometry + c.withGeometry, withNumbers: a.withNumbers + c.withNumbers }), { streets: 0, withGeometry: 0, withNumbers: 0 });
const report = {
  osmTimestamp,
  officialStreetsSource: 'data.gov.il רשימת רחובות בישראל (resource bf185c7f-1a4e-4662-88c5-fa118a244bda) via @il-address/data',
  totals,
  accuracy: { compoundsWithStreet: errors.length + unresolved, resolved: errors.length, unresolved, medianM: q(0.5), p90M: q(0.9), p95M: q(0.95), within300m: errors.filter((e) => e <= 300).length },
  coverage,
};
await writeFile(path.join(OUT, 'geo-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ totals, accuracy: report.accuracy }, null, 2));

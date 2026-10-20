import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { normaliseStreet } from '../../src/domain/streets';
const [assignedPath, outDir, georefPath] = process.argv.slice(2);
const g = JSON.parse(readFileSync(georefPath!, 'utf8'));
const a = JSON.parse(gunzipSync(readFileSync(assignedPath!)).toString()).assigned;
const byLoc = new Map<string, { n: number; miss: string[] }>();
for (const c of g.compounds) {
  if (!c.street) continue;
  const f = JSON.parse(readFileSync(`${outDir}/geo/${c.loc}.json`, 'utf8'));
  const k = normaliseStreet(c.street);
  const row = f.streets.find((s: any) => [s[1], ...s[2]].some((n: string) => normaliseStreet(n) === k));
  const e = byLoc.get(c.loc) ?? { n: 0, miss: [] };
  e.n++;
  if (!row || !row[3]) e.miss.push(c.street);
  byLoc.set(c.loc, e);
}
const rows = [...byLoc.entries()].map(([loc, e]) => ({ loc, name: g.localities[loc]?.name, n: e.n, miss: e.miss.length, osmWays: a[loc]?.ways.length ?? 0, sample: e.miss.slice(0, 5) }));
rows.sort((x, y) => y.miss - x.miss);
for (const r of rows.slice(0, 30)) console.log(`${r.loc} ${r.name} compounds=${r.n} missing=${r.miss} osmWays=${r.osmWays} | ${r.sample.join(' ; ')}`);
const totalMiss = rows.reduce((s, r) => s + r.miss, 0);
const noOsm = rows.filter((r) => r.osmWays === 0).reduce((s, r) => s + r.miss, 0);
console.log('total missing', totalMiss, 'in localities with zero OSM named ways', noOsm);

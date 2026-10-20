import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { normaliseStreet, tokenKey } from '../../src/domain/streets';
const d = JSON.parse(gunzipSync(readFileSync(process.argv[2]!)).toString());
const loc = process.argv[3]!;
const off = JSON.parse(readFileSync(`node_modules/@il-address/data/generated/streets/${loc}.json`, 'utf8'));
const osmNames = new Map<string, string>();
for (const [names] of d.assigned[loc].ways) for (const n of names) osmNames.set(normaliseStreet(n), n);
for (const [n] of d.assigned[loc].addrs) osmNames.set(normaliseStreet(n), n);
const osmTok = new Set([...osmNames.keys()].map((k) => k.split(' ').sort().join(' ')));
let matched = 0; const un: string[] = [];
for (const s of off) {
  const ok = [s.nameHe, ...s.aliases].some((n: string) => osmNames.has(normaliseStreet(n)) || osmTok.has(tokenKey(n)));
  if (ok) matched++; else un.push(s.nameHe + (s.aliases.length ? ` [${s.aliases.join('|')}]` : ''));
}
console.log(loc, 'official', off.length, 'matched', matched);
console.log('UNMATCHED official sample:', un.slice(0, 60).join(' ; '));
const offKeys = new Set(off.flatMap((s: any) => [s.nameHe, ...s.aliases].map((n: string) => normaliseStreet(n))));
console.log('OSM names not in official sample:', [...osmNames.entries()].filter(([k]) => !offKeys.has(k)).slice(0, 60).map(([, v]) => v).join(' ; '));

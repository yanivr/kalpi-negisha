// How many displayed places merge official compounds with different names or addresses?
import { readFileSync, readdirSync } from 'node:fs';
import { searchByLocality } from '../../src/domain/match';
const f = readdirSync('public/data').find((x) => x.startsWith('dataset-'))!;
const d = JSON.parse(readFileSync(`public/data/${f}`, 'utf8'));
let places = 0, multi = 0, diffName = 0, diffAddr = 0;
const ex: string[] = [];
for (const l of d.localities) {
  for (const p of searchByLocality(d.sites, l.code).results) {
    places++;
    if (p.sites.length > 1) {
      multi++;
      const names = new Set(p.sites.map((s: any) => s.officialName));
      const addrs = new Set(p.sites.map((s: any) => s.address.raw.replace(/\s+/g, ' ').trim()));
      if (names.size > 1) { diffName++; if (ex.length < 8) ex.push(`${l.name}: ${[...names].join(' | ')} @ ${[...addrs].join(' | ')}`); }
      if (addrs.size > 1) diffAddr++;
    }
  }
}
console.log({ places, multiCompound: multi, differentNames: diffName, differentAddresses: diffAddr });
console.log(ex.join('\n'));

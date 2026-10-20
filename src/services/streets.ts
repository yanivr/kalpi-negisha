import type { LatLon } from '../domain/geo';
import type { OfficialStreet } from '../domain/streets';

/**
 * Per-locality street data: official street names (data.gov.il) and, where the build matched them,
 * points along the street and known house numbers (OpenStreetMap). Loaded on demand, entirely local:
 * the typed street never leaves the device.
 */
export interface LocalityStreets {
  list: OfficialStreet[];
  geo: Map<number, { points: LatLon[]; numbers: Record<string, LatLon> | null }>;
}

type Row = [number, string, string[], Array<[number, number]> | null, Record<string, [number, number]> | null];

function parse(json: { streets: Row[] }): LocalityStreets {
  const list: OfficialStreet[] = [];
  const geo: LocalityStreets['geo'] = new Map();
  for (const [code, nameHe, aliases, pts, nums] of json.streets) {
    list.push({ code, nameHe, aliases });
    if (pts && pts.length) {
      geo.set(code, {
        points: pts.map(([lat, lon]) => ({ lat, lon })),
        numbers: nums ? Object.fromEntries(Object.entries(nums).map(([k, [lat, lon]]) => [k, { lat, lon }])) : null,
      });
    }
  }
  return { list, geo };
}

let embeddedAll: Promise<Record<string, { streets: Row[] }> | null> | null = null;

/** Hosted build: all localities in one gzip blob inside the page (decompressed once, on first use). */
function embeddedGeo(): Promise<Record<string, { streets: Row[] }> | null> {
  if (embeddedAll) return embeddedAll;
  embeddedAll = (async () => {
    const el = document.getElementById('kalpi-embedded-geo');
    if (!el?.textContent) return null;
    const bin = atob(el.textContent.trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  })();
  return embeddedAll;
}

const cache = new Map<string, Promise<LocalityStreets>>();

export function loadLocalityStreets(code: string): Promise<LocalityStreets> {
  if (!/^\d+$/.test(code)) return Promise.reject(new Error('bad locality code'));
  const hit = cache.get(code);
  if (hit) return hit;
  const p = (async () => {
    const all = await embeddedGeo();
    if (all) return parse(all[code] ?? { streets: [] });
    const res = await fetch(`${import.meta.env.BASE_URL}data/geo/${code}.json`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for street list`);
    return parse(JSON.parse(await res.text()));
  })();
  cache.set(code, p);
  p.catch(() => cache.delete(code));
  return p;
}

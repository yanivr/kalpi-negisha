/**
 * Emits per-locality street files into the release (public/data/geo/<code>.json) and a summary (geo.json).
 * With a built geometry index (GEO_INDEX_DIR, produced by build-street-index.ts) streets carry points;
 * without it, only the official street names are emitted and the page falls back to locality search.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface GeoSummary {
  source: 'osm+official' | 'official-only';
  osmTimestamp: string | null;
  officialStreetsUpdated: string | null;
  totals: { streets: number; withGeometry: number; withNumbers: number } | null;
  accuracy: Record<string, number> | null;
}

export async function emitGeo(outDir: string, localityCodes: string[]): Promise<GeoSummary> {
  const geoDir = path.join(outDir, 'geo');
  await mkdir(geoDir, { recursive: true });
  const indexDir = process.env.GEO_INDEX_DIR;
  const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../node_modules/@il-address/data');
  const manifest = JSON.parse(await readFile(path.join(pkg, 'manifest.json'), 'utf8'));
  if (indexDir && existsSync(path.join(indexDir, 'geo'))) {
    const report = JSON.parse(await readFile(path.join(indexDir, 'geo-report.json'), 'utf8'));
    for (const f of await readdir(path.join(indexDir, 'geo'))) {
      await writeFile(path.join(geoDir, f), await readFile(path.join(indexDir, 'geo', f)));
    }
    return { source: 'osm+official', osmTimestamp: report.osmTimestamp, officialStreetsUpdated: manifest.sources.streets.lastModified, totals: report.totals, accuracy: report.accuracy };
  }
  let n = 0;
  for (const code of localityCodes) {
    const f = path.join(pkg, 'generated/streets', `${code}.json`);
    const list = existsSync(f) ? (JSON.parse(await readFile(f, 'utf8')) as Array<{ code: number; nameHe: string; aliases: string[] }>) : [];
    n += list.length;
    await writeFile(path.join(geoDir, `${code}.json`), JSON.stringify({ v: 1, loc: code, streets: list.map((s) => [s.code, s.nameHe, s.aliases, null, null]) }));
  }
  return { source: 'official-only', osmTimestamp: null, officialStreetsUpdated: manifest.sources.streets.lastModified, totals: { streets: n, withGeometry: 0, withNumbers: 0 }, accuracy: null };
}

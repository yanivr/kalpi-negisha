import { Dataset, type PollingSite } from '../../src/domain/schema';
import { regularAccessibleStationsOf, specialStationsOf } from '../../src/domain/match';
import { ingestCecK26, type IngestResult, type SourceFile } from '../sources/cec-k26';
import { sha256 } from './xlsx';
import { writeStateFile, type PipelineState } from './state';

export interface RegistrySource {
  sourceId: string;
  role: SourceFile['role'] | null;
  status: 'approved' | 'not-used' | 'rejected';
  title: string;
  publisher: string;
  pageUrl: string;
  downloadUrl: string | null;
  acquisition: 'manual' | 'automatic';
  parser: string | null;
}

/**
 * Builds the shipped dataset from an ingest result: places that have at least one accessible station, with only their
 * accessible stations (special and regular). Non-accessible stations are never shipped. Owner decision 20.10.2026:
 * regular accessible stations are shown separately and clearly marked as being for assigned voters only.
 */
export function toDataset(result: IngestResult, registry: RegistrySource[], releaseId: string, generatedAt: string, acquisition: 'manual' | 'automatic'): Dataset {
  const accessibleOf = (s: PollingSite) => [...specialStationsOf(s), ...regularAccessibleStationsOf(s)];
  const sites: PollingSite[] = result.sites
    .filter((s) => accessibleOf(s).length > 0)
    .map((s) => ({ ...s, stations: s.stations.filter((x) => x.kind === 'accessible_special' || x.kind === 'accessible_assigned') }));
  const sources = registry
    .filter((r) => r.status === 'approved' && r.role)
    .map((r) => {
      const wb = result.workbooks[r.role!];
      return {
        sourceId: r.sourceId,
        title: r.title,
        publisher: r.publisher,
        url: r.downloadUrl ?? r.pageUrl,
        acquisition,
        contentSha256: wb.sha256,
        fileCreatedAt: wb.createdAt,
        fileModifiedAt: wb.modifiedAt,
        rows: wb.sheet.rows.length,
      };
    });
  return Dataset.parse({
    schemaVersion: '1',
    releaseId,
    electionId: result.report.electionId,
    generatedAt,
    sources,
    localities: result.localities,
    sites,
  });
}

/** Runs ingestion and, when it passes every check, writes the dataset into the state directory and updates state. */
export async function ingestAndCommit(opts: {
  files: SourceFile[];
  registry: RegistrySource[];
  state: PipelineState;
  now: string;
  how: 'automatic-download' | 'manual-files';
}): Promise<{ ok: true; changed: boolean; result: IngestResult } | { ok: false; fatal: string[]; result: IngestResult | null }> {
  let result: IngestResult;
  try {
    result = await ingestCecK26(opts.files, opts.now);
  } catch (e) {
    return { ok: false, fatal: [(e as Error).message], result: null };
  }
  await writeStateFile(`reports/ingest-latest.json`, JSON.stringify({ at: opts.now, ...result.report }, null, 2) + '\n');
  if (result.fatal.length > 0) return { ok: false, fatal: result.fatal, result };

  const sourceChecksums = Object.fromEntries(
    opts.files.map((f) => [f.sourceId, result.workbooks[f.role].sha256]),
  );
  const releaseIdBase = Object.values(sourceChecksums).sort().join('|');
  const releaseId = `k26-${sha256(releaseIdBase).slice(0, 12)}`;
  const dataset = toDataset(result, opts.registry, releaseId, opts.now, opts.how === 'automatic-download' ? 'automatic' : 'manual');
  // Deterministic content: exclude generatedAt from the content hash so an identical source yields an identical file name.
  const body = JSON.stringify({ ...dataset, generatedAt: null });
  const datasetSha = sha256(body);
  const file = `dataset-${datasetSha.slice(0, 16)}.json`;
  await writeStateFile(file, body);

  const prev = opts.state.dataset;
  const changed = !prev || prev.sha256 !== datasetSha;
  const specialSites = dataset.sites.filter((s) => specialStationsOf(s).length > 0);
  const recommendable = dataset.sites.filter((s) => s.publicAccess.value === 'yes' && s.blockedReasons.length === 0);
  opts.state.dataset = {
    file,
    sha256: datasetSha,
    releaseId,
    verifiedAt: opts.now,
    verifiedHow: opts.how,
    contentChangedAt: changed ? opts.now : prev!.contentChangedAt,
    sourceChecksums,
    sourceMeta: Object.fromEntries(
      opts.files.map((f) => {
        const wb = result.workbooks[f.role];
        return [f.sourceId, { title: wb.title, createdAt: wb.createdAt, modifiedAt: wb.modifiedAt, rows: wb.sheet.rows.length, bytes: wb.bytes }];
      }),
    ),
    nationwideCoverage: result.report.checks.every((c) => c.ok) ? 'verified' : 'unverified',
    counts: {
      sourceRows: result.workbooks.stations.sheet.rows.length,
      acceptedRows: result.report.totals.stations,
      quarantinedRows: result.workbooks.stations.sheet.rows.length - result.report.totals.stations,
    },
    coverage: {
      specialStations: result.report.totals.specialStations,
      specialSites: specialSites.length,
      localities: new Set(specialSites.map((s) => s.localityCode)).size,
      recommendableSites: recommendable.filter((s) => specialStationsOf(s).length > 0).length,
    },
  };
  opts.state.blockingReasons = [];
  await writeStateFile('geo-ref.json', JSON.stringify(buildGeoRef(result)) + '\n');
  return { ok: true, changed, result };
}

/**
 * Reference geography derived from ALL official compounds (not only special ones):
 * per-locality bounding boxes used to match street geometry to the right locality, and official
 * (street, house number, coordinates) triples used to measure geocoding accuracy.
 */
export function buildGeoRef(result: IngestResult) {
  const localities: Record<string, { name: string; bbox: [number, number, number, number]; n: number }> = {};
  const compounds: Array<{ loc: string; street: string | null; house: string | null; lat: number; lon: number }> = [];
  for (const s of result.sites) {
    if (!s.point) continue;
    const l = (localities[s.localityCode] ??= { name: s.localityName, bbox: [90, 180, -90, -180], n: 0 });
    l.bbox = [Math.min(l.bbox[0], s.point.lat), Math.min(l.bbox[1], s.point.lon), Math.max(l.bbox[2], s.point.lat), Math.max(l.bbox[3], s.point.lon)];
    l.n++;
    compounds.push({ loc: s.localityCode, street: s.address.street, house: s.address.house, lat: s.point.lat, lon: s.point.lon });
  }
  return { generatedFrom: 'cec-k26 concentrations', localities, compounds };
}

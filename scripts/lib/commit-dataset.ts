import { Dataset, type PollingSite } from '../../src/domain/schema';
import { specialStationsOf } from '../../src/domain/match';
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
 * Builds the shipped dataset from an ingest result: only places that have at least one special-accessible station,
 * and only their special-accessible stations (the product never offers ordinary stations as alternatives — spec §8.4).
 */
export function toDataset(result: IngestResult, registry: RegistrySource[], releaseId: string, generatedAt: string, acquisition: 'manual' | 'automatic'): Dataset {
  const sites: PollingSite[] = result.sites
    .filter((s) => specialStationsOf(s).length > 0)
    .map((s) => ({ ...s, stations: specialStationsOf(s) }));
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
      specialSites: dataset.sites.length,
      localities: new Set(dataset.sites.map((s) => s.localityCode)).size,
      recommendableSites: recommendable.length,
    },
  };
  opts.state.blockingReasons = [];
  return { ok: true, changed, result };
}

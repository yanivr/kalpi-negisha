import { Dataset, ReleaseManifest, type Dataset as DatasetT, type ReleaseManifest as ManifestT } from '../domain/schema';

/**
 * Loads the pre-verified snapshot published with the site (spec §15: visitors never trigger a pull of the source).
 * The dataset file is identified by its content hash; the hash is re-checked in the browser so a stale/mixed
 * deployment can never show data that does not belong to the manifest (spec §18).
 */

export interface LoadedManifest {
  manifest: ManifestT;
  /** Server time from the HTTP Date header and the device time when the response arrived. */
  serverDate: { serverMs: number; deviceMsAtResponse: number } | null;
}

export interface PublicRules {
  ruleId: string | null;
  version: string | null;
  sources: Array<{ id: string; url: string; role: string }>;
  texts: Partial<Record<string, { title: string; points: string[] }>>;
}

export interface PublicReport {
  generatedAt: string;
  ingest: null | {
    at: string;
    totals: { stations: number; accessibleStations: number; specialStations: number; voters: number; compounds: number; localities: number };
    checks: Array<{ id: string; ok: boolean; detail: string }>;
    siteWarnings: Array<{ siteId: string; reason: string }>;
    quarantinedCount: number;
  };
  sources: Record<string, { title: string | null; createdAt: string | null; modifiedAt: string | null; rows: number; bytes: number }>;
  sourceChecksums: Record<string, string>;
  verifiedHow: 'automatic-download' | 'manual-files' | null;
  attempts: Array<{ at: string; result: string; detail: string[] }>;
}

export class SnapshotError extends Error {
  constructor(
    message: string,
    readonly offline = false,
  ) {
    super(message);
  }
}

function dataUrl(file: string): string {
  return `${import.meta.env.BASE_URL}data/${file}`;
}

async function getJson(url: string): Promise<{ body: unknown; date: string | null }> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch {
    throw new SnapshotError(`network error for ${url}`, typeof navigator !== 'undefined' && navigator.onLine === false);
  }
  if (!res.ok) throw new SnapshotError(`HTTP ${res.status} for ${url}`);
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/html')) throw new SnapshotError(`unexpected HTML for ${url}`);
  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    throw new SnapshotError(`invalid JSON for ${url}`);
  }
  return { body, date: res.headers.get('date') };
}

export async function loadManifest(): Promise<LoadedManifest> {
  const { body, date } = await getJson(dataUrl('manifest.json'));
  const parsed = ReleaseManifest.safeParse(body);
  if (!parsed.success) throw new SnapshotError('manifest failed validation');
  const serverMs = date ? Date.parse(date) : NaN;
  return {
    manifest: parsed.data,
    serverDate: Number.isFinite(serverMs) ? { serverMs, deviceMsAtResponse: Date.now() } : null,
  };
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function loadDataset(manifest: ManifestT): Promise<DatasetT> {
  if (!manifest.datasetFile || !manifest.datasetSha256) throw new SnapshotError('manifest has no dataset');
  if (!/^dataset-[0-9a-f]{16}\.json$/.test(manifest.datasetFile)) throw new SnapshotError('unexpected dataset file name');
  let res: Response;
  try {
    // The file name is content-addressed, so normal HTTP caching is safe.
    res = await fetch(dataUrl(manifest.datasetFile), { credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch {
    throw new SnapshotError('network error loading dataset', typeof navigator !== 'undefined' && navigator.onLine === false);
  }
  if (!res.ok) throw new SnapshotError(`HTTP ${res.status} loading dataset`);
  const buf = await res.arrayBuffer();
  const hash = await sha256Hex(buf);
  if (hash !== manifest.datasetSha256) throw new SnapshotError('dataset hash does not match manifest');
  const parsed = Dataset.safeParse(JSON.parse(new TextDecoder().decode(buf)));
  if (!parsed.success) throw new SnapshotError('dataset failed validation');
  if (parsed.data.releaseId !== manifest.releaseId || parsed.data.electionId !== manifest.electionId) {
    throw new SnapshotError('dataset does not belong to this release');
  }
  return parsed.data;
}

export async function loadRules(): Promise<PublicRules> {
  const { body } = await getJson(dataUrl('rules.json'));
  return body as PublicRules;
}

export async function loadReport(): Promise<PublicReport> {
  const { body } = await getJson(dataUrl('report.json'));
  return body as PublicReport;
}

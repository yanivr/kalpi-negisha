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

/**
 * Some hosts (a hosted artifact) serve the page inside a sandbox where separate data requests may be refused.
 * The hosted build therefore embeds the release files, base64-encoded so the bytes — and their hash — are exact.
 */
interface EmbeddedBundle {
  files: Record<string, string>;
}
let embeddedCache: EmbeddedBundle | null | undefined;
function embedded(): EmbeddedBundle | null {
  if (embeddedCache !== undefined) return embeddedCache;
  const el = typeof document !== 'undefined' ? document.getElementById('kalpi-embedded-data') : null;
  try {
    embeddedCache = el?.textContent ? (JSON.parse(el.textContent) as EmbeddedBundle) : null;
  } catch {
    embeddedCache = null;
  }
  return embeddedCache;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Reads one release file as exact bytes, from the embedded bundle when present, otherwise over HTTP. */
async function readReleaseFile(file: string, opts: { noStore: boolean }): Promise<{ bytes: Uint8Array; date: string | null }> {
  const bundle = embedded();
  if (bundle) {
    const b64 = bundle.files[file];
    if (!b64) throw new SnapshotError(`embedded file missing: ${file}`);
    return { bytes: b64ToBytes(b64), date: null };
  }
  const url = dataUrl(file);
  let res: Response;
  try {
    // Same-origin credentials so hosts that protect published files keep working; nothing personal is sent.
    res = await fetch(url, { cache: opts.noStore ? 'no-store' : 'default', credentials: 'same-origin' });
  } catch {
    throw new SnapshotError(`network error for ${file}`, typeof navigator !== 'undefined' && navigator.onLine === false);
  }
  if (!res.ok) throw new SnapshotError(`HTTP ${res.status} for ${file}`);
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/html')) throw new SnapshotError(`unexpected HTML for ${file}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), date: res.headers.get('date') };
}

async function getJson(file: string): Promise<{ body: unknown; date: string | null }> {
  const { bytes, date } = await readReleaseFile(file, { noStore: true });
  try {
    return { body: JSON.parse(new TextDecoder().decode(bytes)), date };
  } catch {
    throw new SnapshotError(`invalid JSON in ${file}`);
  }
}

export async function loadManifest(): Promise<LoadedManifest> {
  const { body, date } = await getJson('manifest.json');
  const parsed = ReleaseManifest.safeParse(body);
  if (!parsed.success) throw new SnapshotError(`manifest failed validation: ${parsed.error.issues[0]?.path.join('.')}`);
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
  const { bytes } = await readReleaseFile(manifest.datasetFile, { noStore: false });
  const buf = bytes.slice().buffer;
  const hash = await sha256Hex(buf);
  if (hash !== manifest.datasetSha256) throw new SnapshotError('dataset hash does not match manifest');
  const parsed = Dataset.safeParse(JSON.parse(new TextDecoder().decode(buf)));
  if (!parsed.success) throw new SnapshotError(`dataset failed validation: ${parsed.error.issues[0]?.path.join('.')}`);
  if (parsed.data.releaseId !== manifest.releaseId || parsed.data.electionId !== manifest.electionId) {
    throw new SnapshotError('dataset does not belong to this release');
  }
  return parsed.data;
}

export async function loadRules(): Promise<PublicRules> {
  const { body } = await getJson('rules.json');
  return body as PublicRules;
}

export async function loadReport(): Promise<PublicReport> {
  const { body } = await getJson('report.json');
  return body as PublicReport;
}

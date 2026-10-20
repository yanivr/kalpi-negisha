import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Persistent pipeline state (spec §18). In GitHub Actions this directory is the checked-out `data-state` branch,
 * so it survives between runs and is never rebuilt from an Actions cache.
 */
export const STATE_DIR = process.env.STATE_DIR ?? path.resolve('state');

export type AttemptResult = 'verified-unchanged' | 'verified-changed' | 'failed' | 'not-attempted';

export interface PipelineState {
  schemaVersion: '1';
  electionId: string;
  dataset: null | {
    file: string;
    sha256: string;
    releaseId: string;
    /** Last time the dataset content was confirmed against the official files (download or manual ingest). */
    verifiedAt: string;
    verifiedHow: 'automatic-download' | 'manual-files';
    contentChangedAt: string;
    sourceChecksums: Record<string, string>;
    sourceMeta: Record<string, { title: string | null; createdAt: string | null; modifiedAt: string | null; rows: number; bytes: number }>;
    nationwideCoverage: 'verified' | 'unverified';
    counts: { sourceRows: number; acceptedRows: number; quarantinedRows: number };
    coverage: { specialStations: number; specialSites: number; localities: number; recommendableSites: number };
  };
  rules: null | {
    ruleId: string;
    version: string;
    excerptSha256: string;
    /** SHA-256 of the official rule document as last downloaded by the refresh job (null until first success). */
    officialDocSha256?: string | null;
    verifiedAt: string;
  };
  lastAttemptAt: string | null;
  lastAttemptResult: AttemptResult;
  /** Persistent blocking reasons (e.g. official source changed but could not be parsed). Cleared only by a successful ingest. */
  blockingReasons: string[];
  attempts: Array<{ at: string; result: AttemptResult; detail: string[] }>;
}

export function emptyState(electionId: string): PipelineState {
  return {
    schemaVersion: '1',
    electionId,
    dataset: null,
    rules: null,
    lastAttemptAt: null,
    lastAttemptResult: 'not-attempted',
    blockingReasons: [],
    attempts: [],
  };
}

export async function loadState(electionId: string): Promise<PipelineState> {
  const file = path.join(STATE_DIR, 'state.json');
  if (!existsSync(file)) return emptyState(electionId);
  const s = JSON.parse(await readFile(file, 'utf8')) as PipelineState;
  if (s.electionId !== electionId) {
    // Never roll over to another election automatically (spec §18, §21.1).
    throw new Error(`state belongs to ${s.electionId}, configuration is ${electionId}; refusing to mix elections`);
  }
  return s;
}

export async function saveState(state: PipelineState): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  state.attempts = state.attempts.slice(-60);
  await writeFile(path.join(STATE_DIR, 'state.json'), JSON.stringify(state, null, 2) + '\n');
}

export async function writeStateFile(name: string, content: string): Promise<string> {
  const full = path.join(STATE_DIR, name);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
  return full;
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

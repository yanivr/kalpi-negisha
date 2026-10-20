/**
 * Scheduled refresh (spec §15). Runs in GitHub Actions; never on visitor request.
 *
 * 1. For every approved source with a documented downloadUrl: download (limited retries with back-off),
 *    reject non-XLSX bodies (HTML block pages), hash.
 * 2. All hashes equal to the current snapshot → "verified-unchanged" (verification time advances).
 *    Any hash differs → re-ingest. Passing ingest → new snapshot. Failing ingest → BLOCK recommendations,
 *    because the official content changed and we cannot read it (spec §14).
 * 3. Missing URL / network error / partial download → "failed": snapshot and its verification time stay as they were.
 * 4. Official rule page: when an approved rule has a stored excerpt hash, re-check it; a changed excerpt blocks.
 *
 * Nothing here ever invents data or uses a language model.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadState, readJson, saveState, type PipelineState } from './lib/state';
import { ingestAndCommit, type RegistrySource } from './lib/commit-dataset';
import { sha256 } from './lib/xlsx';
import { extractRuleExcerpt } from './lib/rules';
import type { SourceFile } from './sources/cec-k26';

const MAX_BYTES = 30 * 1024 * 1024;
const USER_AGENT = 'kalpi-negisha-refresh/1.0 (+public accessibility service; daily check)';

async function download(url: string, attempts = 3): Promise<Buffer> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: ctrl.signal, redirect: 'follow' });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers.get('content-length') ?? '0');
      if (len > MAX_BYTES) throw new Error(`too large: ${len}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (len && buf.length !== len) throw new Error(`truncated: ${buf.length}/${len}`);
      if (buf.length > MAX_BYTES) throw new Error('too large');
      if (buf.subarray(0, 4).toString('hex') !== '504b0304') {
        throw new Error(`not an XLSX file (content-type ${res.headers.get('content-type')}); possibly a block/error page`);
      }
      return buf;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function refresh(now = new Date().toISOString()): Promise<PipelineState> {
  const election = await readJson<{ electionId: string }>('config/election.json');
  const registry = (await readJson<{ sources: RegistrySource[] }>('config/source-registry.json')).sources;
  const state = await loadState(election.electionId);
  const detail: string[] = [];
  state.lastAttemptAt = now;

  const approved = registry.filter((r) => r.status === 'approved' && r.role);
  const missingUrl = approved.filter((r) => !r.downloadUrl);
  let result: PipelineState['lastAttemptResult'] = 'failed';

  if (missingUrl.length > 0) {
    detail.push(`no documented download URL for: ${missingUrl.map((r) => r.sourceId).join(', ')}`);
  } else {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'kalpi-src-'));
    const files: SourceFile[] = [];
    let downloadOk = true;
    for (const r of approved) {
      try {
        const buf = await download(r.downloadUrl!);
        const p = path.join(dir, `${r.sourceId}.xlsx`);
        await writeFile(p, buf);
        files.push({ role: r.role!, path: p, sourceId: r.sourceId, url: r.downloadUrl });
        detail.push(`${r.sourceId}: downloaded ${buf.length} bytes sha256 ${sha256(buf).slice(0, 12)}`);
      } catch (e) {
        downloadOk = false;
        detail.push(`${r.sourceId}: download failed — ${(e as Error).message}`);
      }
    }
    if (downloadOk) {
      const current = state.dataset?.sourceChecksums ?? {};
      const hashes = Object.fromEntries(
        await Promise.all(files.map(async (f) => [f.sourceId, sha256(await readFile(f.path))] as const)),
      );
      const unchanged = state.dataset && files.every((f) => current[f.sourceId] === hashes[f.sourceId]);
      if (unchanged) {
        state.dataset!.verifiedAt = now;
        state.dataset!.verifiedHow = 'automatic-download';
        result = 'verified-unchanged';
      } else {
        const out = await ingestAndCommit({ files, registry, state, now, how: 'automatic-download' });
        if (out.ok) {
          result = out.changed ? 'verified-changed' : 'verified-unchanged';
        } else {
          result = 'failed';
          state.blockingReasons = ['dataset:official-source-changed-and-failed-validation'];
          detail.push(...out.fatal.map((f) => `ingest: ${f}`));
        }
      }
    }
  }

  // Official rule text re-check (only meaningful once a rule was approved against the official page).
  const rulesCfg = await readJson<{ rules: Array<{ electionId: string; version: string; status: string; sources: Array<{ id: string; url: string; role: string; anchors?: string[]; excerptStart?: string; excerptEnd?: string }> }> }>('config/rules.json');
  const rule = rulesCfg.rules.find((r) => r.electionId === election.electionId);
  const official = rule?.sources.find((s) => s.role === 'official');
  if (rule?.status === 'approved' && state.rules && official?.excerptStart && official.excerptEnd) {
    try {
      const res = await fetch(official.url, { headers: { 'user-agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const excerpt = extractRuleExcerpt(await res.text(), official.excerptStart, official.excerptEnd);
      if (!excerpt) throw new Error('excerpt anchors not found (page layout changed or content not server-rendered)');
      const h = sha256(excerpt);
      if (h === state.rules.excerptSha256) {
        state.rules.verifiedAt = now;
        detail.push('rules: official excerpt unchanged');
      } else {
        state.blockingReasons = [...new Set([...state.blockingReasons, 'rules:official-text-changed'])];
        detail.push('rules: OFFICIAL TEXT CHANGED — recommendations blocked until reviewed');
      }
    } catch (e) {
      detail.push(`rules: check failed — ${(e as Error).message} (previous verification kept)`);
    }
  }

  state.lastAttemptResult = result;
  state.attempts.push({ at: now, result, detail });
  await saveState(state);
  return state;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await refresh();
  console.log(`refresh result: ${s.lastAttemptResult}`);
  for (const d of s.attempts.at(-1)?.detail ?? []) console.log(`  ${d}`);
}

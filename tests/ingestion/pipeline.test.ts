import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeFixture } from '../fixtures/cec-fixture';

/**
 * End-to-end pipeline behaviour in a temporary working directory with its own config + state:
 * ingest → release → refresh (with mocked downloads). Covers spec §21.1 / §21.3 scenarios.
 */
let cwd: string;
const origCwd = process.cwd();

async function setup(rulesApproved: boolean, downloadUrls: boolean) {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'kalpi-pipe-'));
  await mkdir(path.join(cwd, 'config'));
  await cp(path.join(origCwd, 'config/election.json'), path.join(cwd, 'config/election.json'));
  const reg = JSON.parse(await readFile(path.join(origCwd, 'config/source-registry.json'), 'utf8'));
  for (const s of reg.sources) if (s.status === 'approved') s.downloadUrl = downloadUrls ? `https://example.test/${s.role}.xlsx` : null;
  await writeFile(path.join(cwd, 'config/source-registry.json'), JSON.stringify(reg));
  const rules = JSON.parse(await readFile(path.join(origCwd, 'config/rules.json'), 'utf8'));
  if (rulesApproved) {
    rules.rules[0].status = 'approved';
    rules.rules[0].localeReview.he = { status: 'approved' };
  } else {
    rules.rules[0].status = 'pending-official-text';
  }
  await writeFile(path.join(cwd, 'config/rules.json'), JSON.stringify(rules));
  process.chdir(cwd);
  process.env.STATE_DIR = path.join(cwd, 'state');
  process.env.RELEASE_OUT = path.join(cwd, 'out');
  vi.resetModules();
  return rules.rules[0].version as string;
}

async function ingest() {
  const { loadState, saveState } = await import('../../scripts/lib/state');
  const { ingestAndCommit } = await import('../../scripts/lib/commit-dataset');
  const reg = JSON.parse(await readFile('config/source-registry.json', 'utf8')).sources;
  const fx = await writeFixture();
  const byRole = Object.fromEntries(reg.filter((r: any) => r.status === 'approved').map((r: any) => [r.role, r.sourceId]));
  const files = fx.map((f) => ({ ...f, sourceId: byRole[f.role] }));
  const state = await loadState('knesset-26');
  const out = await ingestAndCommit({ files, registry: reg, state, now: '2026-10-20T10:00:00Z', how: 'manual-files' });
  state.lastAttemptAt = '2026-10-20T10:00:00Z';
  state.lastAttemptResult = 'verified-changed';
  await saveState(state);
  return { out, files };
}

async function approveRulesInState(version: string) {
  const { loadState, saveState } = await import('../../scripts/lib/state');
  const s = await loadState('knesset-26');
  s.rules = { ruleId: 'k26-special-accessible-mobility', version, excerptSha256: 'x'.repeat(64), verifiedAt: '2026-10-20T10:00:00Z' };
  await saveState(s);
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => {
  process.chdir(origCwd);
  delete process.env.STATE_DIR;
  delete process.env.RELEASE_OUT;
});

describe('release', () => {
  it('is uninitialized with no import ever, and ships no dummy data', async () => {
    await setup(false, false);
    const { buildRelease } = await import('../../scripts/build-release');
    const m = await buildRelease('2026-10-20T12:00:00Z');
    expect(m.status).toBe('uninitialized');
    expect(m.datasetFile).toBeNull();
  });

  it('is blocked while the rule text is not approved against the official source', async () => {
    await setup(false, false);
    await ingest();
    const { buildRelease } = await import('../../scripts/build-release');
    const m = await buildRelease('2026-10-20T12:00:00Z');
    expect(m.status).toBe('blocked');
    expect(m.reasons).toContain('rules:pending-official-text');
    expect(m.ruleVersion).toBeNull();
  });

  it('is healthy when data and rules are verified; locale rule versions follow the review status', async () => {
    const v = await setup(true, false);
    await ingest();
    await approveRulesInState(v);
    const { buildRelease } = await import('../../scripts/build-release');
    const m = await buildRelease('2026-10-20T12:00:00Z');
    expect(m.status).toBe('healthy');
    expect(m.localeRuleVersions).toEqual({ he: v, ar: v, ru: v, am: v });
    const ds = await readFile(path.join(cwd, 'out', m.datasetFile!), 'utf8');
    const { Dataset } = await import('../../src/domain/schema');
    expect(Dataset.safeParse(JSON.parse(ds)).success).toBe(true); // what the browser will validate
    expect(JSON.parse(ds).releaseId).toBe(m.releaseId);
    // Only accessible stations are shipped (special and regular); never non-accessible ones.
    expect(JSON.parse(ds).sites.every((s: any) => s.stations.every((st: any) => st.kind === 'accessible_special' || st.kind === 'accessible_assigned'))).toBe(true);
  });

  it('marks the phase ended after polls close', async () => {
    await setup(false, false);
    const { buildRelease } = await import('../../scripts/build-release');
    const m = await buildRelease('2026-10-27T20:00:01Z');
    expect(m.electionPhase).toBe('ended');
  });

  it('refuses state that belongs to another election (no automatic rollover)', async () => {
    await setup(false, false);
    await mkdir(path.join(cwd, 'state'), { recursive: true });
    await writeFile(path.join(cwd, 'state/state.json'), JSON.stringify({ schemaVersion: '1', electionId: 'knesset-25' }));
    const { buildRelease } = await import('../../scripts/build-release');
    await expect(buildRelease()).rejects.toThrow(/refusing to mix elections/);
  });
});

describe('refresh', () => {
  it('without documented download URLs records a failed attempt and does not advance verification', async () => {
    await setup(true, false);
    await ingest();
    const { refresh } = await import('../../scripts/refresh');
    const s = await refresh('2026-10-21T03:17:00Z');
    expect(s.lastAttemptResult).toBe('failed');
    expect(s.dataset!.verifiedAt).toBe('2026-10-20T10:00:00Z');
  });

  it('an HTML block page with HTTP 200 is a failure, never a verification', async () => {
    await setup(true, true);
    await ingest();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>blocked</html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => (fn(), 0)) as any);
    const { refresh } = await import('../../scripts/refresh');
    const s = await refresh('2026-10-21T03:17:00Z');
    expect(s.lastAttemptResult).toBe('failed');
    expect(s.dataset!.verifiedAt).toBe('2026-10-20T10:00:00Z');
    vi.unstubAllGlobals();
  });

  it('identical official files advance the verification time without changing content time', async () => {
    await setup(true, true);
    const { files } = await ingest();
    const bodies: Record<string, Buffer> = {};
    for (const f of files) bodies[f.role] = await readFile(f.path);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const role = /example\.test\/(\w+)\.xlsx/.exec(String(url))![1]!;
      return new Response(new Uint8Array(bodies[role]!), { status: 200, headers: { 'content-length': String(bodies[role]!.length) } });
    }));
    const { refresh } = await import('../../scripts/refresh');
    const s = await refresh('2026-10-21T03:17:00Z');
    expect(s.lastAttemptResult).toBe('verified-unchanged');
    expect(s.dataset!.verifiedAt).toBe('2026-10-21T03:17:00Z');
    expect(s.dataset!.contentChangedAt).toBe('2026-10-20T10:00:00Z');
    vi.unstubAllGlobals();
  });

  it('a changed official file that fails validation blocks recommendations', async () => {
    await setup(true, true);
    const { files } = await ingest();
    const bad = await writeFixture({ total137Delta: { special: 2 } });
    const bodies: Record<string, Buffer> = {};
    for (const f of files) bodies[f.role] = await readFile(f.path);
    bodies['report137'] = await readFile(bad.find((f) => f.role === 'report137')!.path);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const role = /example\.test\/(\w+)\.xlsx/.exec(String(url))![1]!;
      return new Response(new Uint8Array(bodies[role]!), { status: 200 });
    }));
    const { refresh } = await import('../../scripts/refresh');
    const s = await refresh('2026-10-21T03:17:00Z');
    expect(s.blockingReasons).toContain('dataset:official-source-changed-and-failed-validation');
    const { buildRelease } = await import('../../scripts/build-release');
    expect((await buildRelease('2026-10-21T04:00:00Z')).status).toBe('blocked');
    vi.unstubAllGlobals();
  });
});

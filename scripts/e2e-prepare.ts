/**
 * Prepares an isolated SYNTHETIC release for browser tests (never deployed):
 * fixture workbooks → ingest → rules marked approved in a temp config → release into public-e2e/data.
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const work = await mkdtemp(path.join(os.tmpdir(), 'kalpi-e2e-'));
await mkdir(path.join(work, 'config'));
for (const f of ['election.json', 'source-registry.json']) await cp(path.join(root, 'config', f), path.join(work, 'config', f));
const rules = JSON.parse(await readFile(path.join(root, 'config/rules.json'), 'utf8'));
rules.rules[0].status = 'approved';
rules.rules[0].localeReview.he = { status: 'approved' };
await writeFile(path.join(work, 'config/rules.json'), JSON.stringify(rules));

process.chdir(work);
process.env.STATE_DIR = path.join(work, 'state');
const out = path.join(root, 'public-e2e', 'data');
await rm(path.join(root, 'public-e2e'), { recursive: true, force: true });
process.env.RELEASE_OUT = out;

const { writeFixture } = await import('../tests/fixtures/cec-fixture');
const { loadState, saveState } = await import('./lib/state');
const { ingestAndCommit } = await import('./lib/commit-dataset');
const { buildRelease } = await import('./build-release');

const reg = JSON.parse(await readFile('config/source-registry.json', 'utf8')).sources;
const byRole = Object.fromEntries(reg.filter((r: any) => r.status === 'approved').map((r: any) => [r.role, r.sourceId]));
const files = (await writeFixture()).map((f) => ({ ...f, sourceId: byRole[f.role] }));
const state = await loadState('knesset-26');
const now = new Date().toISOString();
const res = await ingestAndCommit({ files, registry: reg, state, now, how: 'manual-files' });
if (!res.ok) throw new Error('fixture ingest failed: ' + res.fatal.join('; '));
state.rules = { ruleId: rules.rules[0].ruleId, version: rules.rules[0].version, excerptSha256: 'f'.repeat(64), verifiedAt: now };
state.lastAttemptAt = now;
state.lastAttemptResult = 'verified-unchanged';
await saveState(state);
const m = await buildRelease(now);
// SYNTHETIC street files for the fixture localities (not real streets).
{
  const ds = JSON.parse(await readFile(path.join(out, m.datasetFile!), 'utf8'));
  const p = (id: string) => ds.sites.find((x: any) => x.siteId === id)?.point;
  const a = p('k26-9001-1');
  const b = p('k26-9001-2');
  const { writeFile: wf } = await import('node:fs/promises');
  const line = (from: any, to: any) => Array.from({ length: 6 }, (_, i) => [from.lat + ((to.lat - from.lat) * i) / 5, from.lon + ((to.lon - from.lon) * i) / 5]);
  await wf(path.join(out, 'geo', '9001.json'), JSON.stringify({
    v: 1, loc: '9001',
    streets: [
      [1, 'הבדיקה', ['רחוב הבדיקה'], line(a, { lat: a.lat - 0.01, lon: a.lon }), { '1': [a.lat, a.lon], '7': [a.lat - 0.004, a.lon] }],
      [2, 'הניסוי', [], line(b, { lat: b.lat + 0.01, lon: b.lon }), null],
      [3, 'הנעלם', [], null, null],
    ],
  }));
  await wf(path.join(out, 'geo', '9003.json'), JSON.stringify({ v: 1, loc: '9003', streets: [[1, 'השדה', [], [[a.lat + 0.02, a.lon + 0.02]], null]] }));
}
console.log(`e2e release ${m.releaseId} status=${m.status} → ${out}`);
process.chdir(root);

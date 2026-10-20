/**
 * Manual ingest of official files downloaded by the maintainer from the official list page.
 *
 *   npm run ingest:files -- --stations <xlsx> --report104 <xlsx> --concentrations <xlsx> --report137 <xlsx>
 *
 * The raw files are NOT copied into the repository (distribution rights not verified — spec §11–12);
 * only their SHA-256, metadata and the derived dataset are stored.
 */
import { parseArgs } from 'node:util';
import { readJson, loadState, saveState } from './lib/state';
import { ingestAndCommit, type RegistrySource } from './lib/commit-dataset';
import type { SourceFile } from './sources/cec-k26';

const { values } = parseArgs({
  options: {
    stations: { type: 'string' },
    report104: { type: 'string' },
    concentrations: { type: 'string' },
    report137: { type: 'string' },
  },
});

const election = await readJson<{ electionId: string }>('config/election.json');
const registry = (await readJson<{ sources: RegistrySource[] }>('config/source-registry.json')).sources;
const state = await loadState(election.electionId);
const now = new Date().toISOString();

const roles: Array<SourceFile['role']> = ['stations', 'report104', 'concentrations', 'report137'];
const files: SourceFile[] = roles.map((role) => {
  const p = values[role];
  if (!p) throw new Error(`--${role} is required`);
  const reg = registry.find((r) => r.role === role && r.status === 'approved');
  if (!reg) throw new Error(`no approved source registered for role ${role}`);
  return { role, path: p, sourceId: reg.sourceId, url: reg.downloadUrl };
});

const out = await ingestAndCommit({ files, registry, state, now, how: 'manual-files' });
state.lastAttemptAt = now;
if (!out.ok) {
  state.lastAttemptResult = 'failed';
  state.attempts.push({ at: now, result: 'failed', detail: ['manual ingest rejected', ...out.fatal] });
  await saveState(state);
  console.error('INGEST REJECTED — dataset not changed:\n- ' + out.fatal.join('\n- '));
  process.exit(1);
}
state.lastAttemptResult = out.changed ? 'verified-changed' : 'verified-unchanged';
state.attempts.push({ at: now, result: state.lastAttemptResult, detail: ['manual ingest'] });
await saveState(state);

const r = out.result.report;
console.log(`OK ${out.changed ? '(content changed)' : '(content unchanged)'}`);
console.log(`stations ${r.totals.stations}, accessible ${r.totals.accessibleStations}, special ${r.totals.specialStations}, voters ${r.totals.voters}`);
console.log(`checks passed: ${r.checks.filter((c) => c.ok).length}/${r.checks.length}`);
console.log(`site warnings: ${r.siteWarnings.length}`);
for (const w of r.siteWarnings) console.log(`  - ${w.siteId}: ${w.reason}`);

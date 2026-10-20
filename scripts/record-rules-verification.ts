/**
 * Records in the pipeline state that the approved rule version was verified against the official excerpt stored in
 * config/rules.json (role "official"). Run by a person after reviewing the official text.
 */
import { loadState, readJson, saveState } from './lib/state';
import { normaliseText } from './lib/rules';
import { sha256 } from './lib/xlsx';

const election = await readJson<{ electionId: string }>('config/election.json');
const cfg = await readJson<{ rules: Array<any> }>('config/rules.json');
const rule = cfg.rules.find((r) => r.electionId === election.electionId);
if (!rule || rule.status !== 'approved') throw new Error('rule is not approved in config/rules.json');
const official = rule.sources.find((s: any) => s.role === 'official');
if (!official?.excerpt) throw new Error('approved rule has no official excerpt');
const state = await loadState(election.electionId);
const now = new Date().toISOString();
state.rules = { ruleId: rule.ruleId, version: rule.version, excerptSha256: sha256(normaliseText(official.excerpt)), officialDocSha256: state.rules?.officialDocSha256 ?? null, verifiedAt: now };
state.blockingReasons = state.blockingReasons.filter((r) => !r.startsWith('rules:'));
await saveState(state);
console.log(`rules ${rule.ruleId}@${rule.version} recorded as verified at ${now}`);

/**
 * Human step (spec §6.4): after a person has read the CURRENT official text and compared it with the rule texts in
 * config/rules.json, record the official excerpt and approve the rule version.
 *
 *   npm run rules:approve -- --excerpt docs/legal/s1-official-excerpt.txt --start "<first words>" --end "<last words>" --reviewer "<name>"
 *
 * The excerpt file contains the official text exactly as copied from the official page. Its normalised SHA-256 is
 * stored so that the scheduled refresh can detect any later change of the official wording.
 */
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { loadState, readJson, saveState } from './lib/state';
import { extractRuleExcerpt } from './lib/rules';
import { sha256 } from './lib/xlsx';

const { values } = parseArgs({
  options: { excerpt: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, reviewer: { type: 'string' } },
});
if (!values.excerpt || !values.start || !values.end || !values.reviewer) {
  throw new Error('--excerpt, --start, --end and --reviewer are required');
}
const raw = await readFile(values.excerpt, 'utf8');
const excerpt = extractRuleExcerpt(raw, values.start, values.end);
if (!excerpt) throw new Error('start/end anchors not found in the excerpt file');

const election = await readJson<{ electionId: string }>('config/election.json');
const cfgPath = 'config/rules.json';
const cfg = await readJson<{ rules: Array<Record<string, any>> }>(cfgPath);
const rule = cfg.rules.find((r) => r.electionId === election.electionId);
if (!rule) throw new Error('no rule for this election');
const now = new Date().toISOString();
const official = rule.sources.find((s: any) => s.role === 'official');
official.excerptStart = values.start;
official.excerptEnd = values.end;
official.excerptSha256 = sha256(excerpt);
official.checkedAt = now;
rule.status = 'approved';
rule.approvedBy = values.reviewer;
rule.approvedAt = now;
if (rule.localeReview.he.status === 'pending-official-text') rule.localeReview.he = { status: 'approved', reviewedBy: values.reviewer };
await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

const state = await loadState(election.electionId);
state.rules = { ruleId: rule.ruleId, version: rule.version, excerptSha256: sha256(excerpt), verifiedAt: now };
state.blockingReasons = state.blockingReasons.filter((r) => !r.startsWith('rules:'));
await saveState(state);
console.log(`rule ${rule.ruleId}@${rule.version} approved by ${values.reviewer}; excerpt sha256 ${sha256(excerpt)}`);

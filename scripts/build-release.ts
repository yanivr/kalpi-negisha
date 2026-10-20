/**
 * Builds the public release from the pipeline state + configuration:
 *   public/data/manifest.json      – status, verification times, coverage, pointer to the dataset file
 *   public/data/dataset-<hash>.json – validated snapshot (only when the dataset exists)
 *   public/data/rules.json         – approved rule texts per locale (only approved, only accepted locales)
 *   public/data/report.json        – checks and warnings for the sources/status page
 * The manifest and the dataset are always produced together (atomic pair, spec §18).
 */
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ReleaseManifest } from '../src/domain/schema';
import { computeExpiresAt, jerusalemDate } from '../src/domain/freshness';
import { loadState, readJson, STATE_DIR } from './lib/state';
import { sha256 } from './lib/xlsx';
import { readFile } from 'node:fs/promises';

const OUT = path.resolve(process.env.RELEASE_OUT ?? 'public/data');
const LOCALES = ['he', 'ar', 'ru', 'am'] as const;
const ACCEPTED_LOCALE_STATUSES = new Set(['human-reviewed', 'owner-accepted-not-human-reviewed', 'approved']);

interface ElectionConfig {
  electionId: string;
  electionDate: string;
  pollsCloseAt: string;
  officialExtensionUntil: string | null;
  suspended: boolean;
  freshness: { policy: 'ttl' | 'no-expiry'; ttlHours: number | null; electionDayTtlHours: number | null };
}
interface RuleConfig {
  ruleId: string;
  electionId: string;
  version: string;
  status: string;
  texts: Record<string, { title: string; points: string[] }>;
  localeReview: Record<string, { status: string }>;
  sources: Array<{ id: string; url: string; role: string }>;
}

export async function buildRelease(nowIso = new Date().toISOString()): Promise<ReleaseManifest> {
  const election = await readJson<ElectionConfig>('config/election.json');
  const rulesCfg = await readJson<{ rules: RuleConfig[] }>('config/rules.json');
  const state = await loadState(election.electionId);
  const rule = rulesCfg.rules.find((r) => r.electionId === election.electionId);
  const nowMs = Date.parse(nowIso);

  const reasons: string[] = [...state.blockingReasons];
  const pollsCloseAt = election.officialExtensionUntil ?? election.pollsCloseAt;

  // ---- rules gate ----
  const ruleApproved = !!rule && rule.status === 'approved' && !!state.rules && state.rules.version === rule.version;
  if (!rule) reasons.push('rules:missing');
  else if (rule.status !== 'approved') reasons.push(`rules:${rule.status}`);
  else if (!state.rules || state.rules.version !== rule.version) reasons.push('rules:not-verified-against-official-source');

  const localeRuleVersions: Record<string, string | null> = {};
  for (const l of LOCALES) {
    localeRuleVersions[l] = ruleApproved && rule && ACCEPTED_LOCALE_STATUSES.has(rule.localeReview[l]?.status ?? '') && rule.texts[l] ? rule.version : null;
  }

  // ---- dataset ----
  let status: ReleaseManifest['status'];
  if (!state.dataset) {
    status = 'uninitialized';
    reasons.push('dataset:never-imported');
  } else if (reasons.length > 0) {
    status = 'blocked';
  } else if (state.lastAttemptResult === 'failed') {
    status = 'degraded';
    reasons.push('refresh:last-attempt-failed');
  } else {
    status = 'healthy';
  }

  const phase: ReleaseManifest['electionPhase'] = election.suspended
    ? 'suspended'
    : nowMs >= Date.parse(pollsCloseAt)
      ? 'ended'
      : jerusalemDate(nowMs) === election.electionDate
        ? 'voting'
        : 'upcoming';

  const expiresAt =
    election.freshness.policy === 'ttl' && election.freshness.ttlHours && election.freshness.electionDayTtlHours
      ? computeExpiresAt([state.dataset?.verifiedAt ?? null, state.rules?.verifiedAt ?? null], {
          ttlHours: election.freshness.ttlHours,
          electionDayTtlHours: election.freshness.electionDayTtlHours,
          electionDate: election.electionDate,
        })
      : null;

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  let datasetFile: string | null = null;
  let datasetSha: string | null = null;
  if (state.dataset) {
    const src = path.join(STATE_DIR, state.dataset.file);
    const body = await readFile(src);
    const actual = sha256(body);
    if (actual !== state.dataset.sha256) throw new Error(`dataset file hash mismatch: ${actual} ≠ ${state.dataset.sha256}`);
    datasetFile = state.dataset.file;
    datasetSha = actual;
    await copyFile(src, path.join(OUT, datasetFile));
  }

  const manifest = ReleaseManifest.parse({
    schemaVersion: '1',
    releaseId: state.dataset?.releaseId ?? 'none',
    electionId: election.electionId,
    electionDate: election.electionDate,
    electionPhase: phase,
    pollsCloseAt,
    lastAttemptAt: state.lastAttemptAt ?? nowIso,
    lastAttemptResult: state.lastAttemptResult,
    lastDatasetVerifiedAt: state.dataset?.verifiedAt ?? null,
    lastRulesVerifiedAt: state.rules?.verifiedAt ?? null,
    lastContentChangedAt: state.dataset?.contentChangedAt ?? null,
    freshnessPolicy: election.freshness.policy,
    expiresAt,
    status,
    nationwideCoverage: state.dataset?.nationwideCoverage ?? 'unverified',
    ruleVersion: ruleApproved ? rule!.version : null,
    localeRuleVersions,
    datasetFile,
    datasetSha256: datasetSha,
    recordCounts: state.dataset?.counts ?? { sourceRows: 0, acceptedRows: 0, quarantinedRows: 0 },
    coverage: state.dataset?.coverage ?? null,
    reasons,
  });

  const publicRules = {
    ruleId: rule?.ruleId ?? null,
    version: ruleApproved ? rule!.version : null,
    sources: rule?.sources.map((s) => ({ id: s.id, url: s.url, role: s.role })) ?? [],
    texts: Object.fromEntries(
      LOCALES.filter((l) => localeRuleVersions[l]).map((l) => [l, rule!.texts[l]]),
    ),
  };

  const reportPath = path.join(STATE_DIR, 'reports/ingest-latest.json');
  const report = existsSync(reportPath) ? await readJson<Record<string, unknown>>(reportPath) : null;
  const publicReport = {
    generatedAt: nowIso,
    ingest: report
      ? {
          at: report.at,
          totals: report.totals,
          checks: report.checks,
          siteWarnings: report.siteWarnings,
          quarantinedCount: (report.quarantined as unknown[]).length,
        }
      : null,
    sources: state.dataset?.sourceMeta ?? {},
    sourceChecksums: state.dataset?.sourceChecksums ?? {},
    verifiedHow: state.dataset?.verifiedHow ?? null,
    attempts: state.attempts.slice(-14),
  };

  await writeFile(path.join(OUT, 'rules.json'), JSON.stringify(publicRules) + '\n');
  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(publicReport) + '\n');
  // Manifest last, so a reader never sees a manifest pointing to a file that is not there yet.
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = await buildRelease();
  console.log(`release ${m.releaseId}: status=${m.status} phase=${m.electionPhase} reasons=${m.reasons.join(',') || '-'}`);
  console.log(`files: ${(await readdir(OUT)).join(', ')}`);
}

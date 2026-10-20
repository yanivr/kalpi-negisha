import { describe, expect, it } from 'vitest';
import { computeExpiresAt, deriveClock, evaluateState, jerusalemDate, startOfJerusalemDay } from '../../src/domain/freshness';
import type { ReleaseManifest } from '../../src/domain/schema';

const base: ReleaseManifest = {
  schemaVersion: '1',
  releaseId: 'k26-test',
  electionId: 'knesset-26',
  electionDate: '2026-10-27',
  electionPhase: 'upcoming',
  pollsCloseAt: '2026-10-27T22:00:00+02:00',
  lastAttemptAt: '2026-10-20T09:00:00Z',
  lastAttemptResult: 'verified-unchanged',
  lastDatasetVerifiedAt: '2026-10-20T09:00:00Z',
  lastRulesVerifiedAt: '2026-10-20T09:00:00Z',
  lastContentChangedAt: '2026-10-20T09:00:00Z',
  freshnessPolicy: 'no-expiry',
  expiresAt: null,
  status: 'healthy',
  nationwideCoverage: 'verified',
  ruleVersion: 'r1',
  localeRuleVersions: { he: 'r1', ar: 'r1', ru: 'r1', am: null },
  datasetFile: 'dataset-0123456789abcdef.json',
  datasetSha256: 'a'.repeat(64),
  recordCounts: { sourceRows: 1, acceptedRows: 1, quarantinedRows: 0 },
  coverage: null,
  reasons: [],
};
const at = (iso: string) => ({ nowMs: Date.parse(iso), unreliable: false });

describe('evaluateState', () => {
  it('is uninitialized without a manifest or a first import', () => {
    expect(evaluateState(null, at('2026-10-21T00:00:00Z'), 'he').kind).toBe('uninitialized');
    expect(evaluateState({ ...base, status: 'uninitialized' }, at('2026-10-21T00:00:00Z'), 'he').kind).toBe('uninitialized');
  });

  it('is active and healthy with verified data and rules', () => {
    expect(evaluateState(base, at('2026-10-21T00:00:00Z'), 'he')).toMatchObject({ kind: 'active', degraded: false });
  });

  it('is blocked when the manifest says so (e.g. rules pending or official source changed)', () => {
    expect(evaluateState({ ...base, status: 'blocked', reasons: ['rules:pending-official-text'] }, at('2026-10-21T00:00:00Z'), 'he').kind).toBe('blocked');
  });

  it('marks degraded when the last refresh failed but data is otherwise valid', () => {
    expect(evaluateState({ ...base, status: 'degraded' }, at('2026-10-21T00:00:00Z'), 'he')).toMatchObject({ kind: 'active', degraded: true });
  });

  it('stops recommending at polls close in Israel time, computed in the page (no new deployment needed)', () => {
    expect(evaluateState(base, at('2026-10-27T19:59:59Z'), 'he').kind).toBe('active');
    expect(evaluateState(base, at('2026-10-27T20:00:00Z'), 'he').kind).toBe('ended');
  });

  it('enforces TTL when the policy is ttl — even while the page stays open', () => {
    const m = { ...base, freshnessPolicy: 'ttl' as const, expiresAt: '2026-10-21T11:00:00Z' };
    expect(evaluateState(m, at('2026-10-21T10:59:00Z'), 'he').kind).toBe('active');
    expect(evaluateState(m, at('2026-10-21T11:00:00Z'), 'he').kind).toBe('expired');
  });

  it('with the owner-chosen no-expiry policy, age alone does not block', () => {
    expect(evaluateState(base, at('2026-10-26T23:00:00Z'), 'he').kind).toBe('active');
  });

  it('blocks a locale whose rule translation is not accepted', () => {
    expect(evaluateState(base, at('2026-10-21T00:00:00Z'), 'am').kind).toBe('rules-unavailable-for-locale');
  });

  it('blocks when rules were never verified', () => {
    expect(evaluateState({ ...base, lastRulesVerifiedAt: null }, at('2026-10-21T00:00:00Z'), 'he').kind).toBe('expired');
  });

  it('is suspended on an official postponement', () => {
    expect(evaluateState({ ...base, electionPhase: 'suspended' }, at('2026-10-21T00:00:00Z'), 'he').kind).toBe('suspended');
  });

  it('refuses when the clock is unreliable', () => {
    expect(evaluateState(base, { nowMs: Date.parse('2026-10-21T00:00:00Z'), unreliable: true }, 'he').kind).toBe('clock-unreliable');
  });
});

describe('deriveClock', () => {
  it('uses server time so a device clock set to the past cannot extend validity', () => {
    const server = Date.parse('2026-10-28T10:00:00Z');
    const deviceAtResponse = Date.parse('2026-10-20T10:00:00Z'); // device a week behind
    const c = deriveClock(deviceAtResponse + 5000, { serverMs: server, deviceMsAtResponse: deviceAtResponse });
    expect(c.nowMs).toBe(server + 5000);
    expect(evaluateState(base, c, 'he').kind).toBe('ended');
  });
});

describe('computeExpiresAt', () => {
  const policy = { ttlHours: 26, electionDayTtlHours: 3, electionDate: '2026-10-27' };
  it('is null when any mandatory component was never verified', () => {
    expect(computeExpiresAt(['2026-10-20T00:00:00Z', null], policy)).toBeNull();
  });
  it('uses the earliest verification + 26h on a normal day', () => {
    expect(computeExpiresAt(['2026-10-20T10:00:00Z', '2026-10-20T08:00:00Z'], policy)).toBe('2026-10-21T10:00:00.000Z');
  });
  it('uses 3h on election day', () => {
    expect(computeExpiresAt(['2026-10-27T08:00:00Z', '2026-10-27T08:00:00Z'], policy)).toBe('2026-10-27T11:00:00.000Z');
  });
  it('caps a previous-day verification early on election day', () => {
    const e = computeExpiresAt(['2026-10-26T12:00:00Z', '2026-10-26T12:00:00Z'], policy)!;
    expect(Date.parse(e)).toBe(startOfJerusalemDay('2026-10-27') + 3 * 3600_000);
  });
});

describe('Jerusalem calendar', () => {
  it('handles winter time (UTC+2) after 25.10.2026', () => {
    expect(jerusalemDate(Date.parse('2026-10-26T22:30:00Z'))).toBe('2026-10-27');
    expect(new Date(startOfJerusalemDay('2026-10-27')).toISOString()).toBe('2026-10-26T22:00:00.000Z');
  });
});

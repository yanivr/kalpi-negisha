import type { ReleaseManifest } from './schema';

export type ServiceState =
  | { kind: 'uninitialized' }
  | { kind: 'blocked'; reasons: string[] }
  | { kind: 'expired'; lastVerifiedAt: string | null }
  | { kind: 'ended' }
  | { kind: 'suspended' }
  | { kind: 'rules-unavailable-for-locale' }
  | { kind: 'clock-unreliable' }
  | { kind: 'active'; degraded: boolean; lastVerifiedAt: string; reasons: string[] };

export interface ClockInfo {
  /** Trusted "now" in ms (device clock corrected by server Date header when available). */
  nowMs: number;
  /** True when the device clock could not be checked or differs from the server by too much and no correction exists. */
  unreliable: boolean;
}

/** Maximum tolerated difference between device clock and the server Date header before we distrust the device. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Derives a trusted clock. When a server Date header is available we use server time plus the time elapsed
 * on the device since the response, so a wrong device clock can never extend validity (spec §15).
 */
export function deriveClock(deviceNowMs: number, serverDate: { serverMs: number; deviceMsAtResponse: number } | null): ClockInfo {
  if (!serverDate || !Number.isFinite(serverDate.serverMs)) return { nowMs: deviceNowMs, unreliable: false };
  const elapsed = deviceNowMs - serverDate.deviceMsAtResponse;
  if (elapsed < -MAX_CLOCK_SKEW_MS) return { nowMs: deviceNowMs, unreliable: true }; // device clock went backwards
  return { nowMs: serverDate.serverMs + Math.max(0, elapsed), unreliable: false };
}

/**
 * Decides whether recommendations may be shown (spec §15–16). Pure function: called on load, on return to the page,
 * before showing results, before opening navigation and periodically while the page is open.
 */
export function evaluateState(manifest: ReleaseManifest | null, clock: ClockInfo, locale: string): ServiceState {
  if (!manifest) return { kind: 'uninitialized' };
  if (clock.unreliable) return { kind: 'clock-unreliable' };
  if (manifest.electionPhase === 'suspended') return { kind: 'suspended' };

  const closeMs = Date.parse(manifest.pollsCloseAt);
  if (!Number.isFinite(closeMs) || clock.nowMs >= closeMs) return { kind: 'ended' };

  if (manifest.status === 'uninitialized') return { kind: 'uninitialized' };
  if (manifest.status === 'blocked') return { kind: 'blocked', reasons: manifest.reasons };
  if (!manifest.datasetFile || !manifest.datasetSha256 || !manifest.ruleVersion) {
    return { kind: 'blocked', reasons: [...manifest.reasons, 'manifest-incomplete'] };
  }

  const lastVerifiedAt = oldest(manifest.lastDatasetVerifiedAt, manifest.lastRulesVerifiedAt);
  if (!lastVerifiedAt) return { kind: 'expired', lastVerifiedAt };
  if (manifest.freshnessPolicy === 'ttl') {
    const expiresMs = manifest.expiresAt ? Date.parse(manifest.expiresAt) : NaN;
    if (!Number.isFinite(expiresMs) || clock.nowMs >= expiresMs) return { kind: 'expired', lastVerifiedAt };
  }

  const localeVersion = manifest.localeRuleVersions[locale];
  if (!localeVersion || localeVersion !== manifest.ruleVersion) return { kind: 'rules-unavailable-for-locale' };

  return {
    kind: 'active',
    degraded: manifest.status === 'degraded',
    lastVerifiedAt,
    reasons: manifest.reasons,
  };
}

function oldest(a: string | null, b: string | null): string | null {
  if (!a || !b) return null;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

export interface FreshnessPolicy {
  ttlHours: number;
  electionDayTtlHours: number;
  /** ISO date (YYYY-MM-DD) of election day, interpreted in Asia/Jerusalem. */
  electionDate: string;
}

/** Calendar date (YYYY-MM-DD) of an instant in Asia/Jerusalem. */
export function jerusalemDate(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * expiresAt = (earliest successful verification of every mandatory component) + TTL, where TTL shortens on election day.
 * Returns null when any mandatory component was never verified.
 */
export function computeExpiresAt(
  verifications: Array<string | null>,
  policy: FreshnessPolicy,
): string | null {
  if (verifications.length === 0 || verifications.some((v) => !v)) return null;
  const earliest = Math.min(...verifications.map((v) => Date.parse(v as string)));
  if (!Number.isFinite(earliest)) return null;
  let expires = earliest + policy.ttlHours * 3600_000;
  // If the validity window reaches into election day, cap it at electionDayTtl after verification
  // or at the start of the window on election day, whichever is later — never longer than the normal TTL.
  const dayTtlEnd = earliest + policy.electionDayTtlHours * 3600_000;
  if (jerusalemDate(earliest) === policy.electionDate) {
    expires = Math.min(expires, dayTtlEnd);
  } else if (jerusalemDate(expires) === policy.electionDate) {
    const electionDayStart = startOfJerusalemDay(policy.electionDate);
    expires = Math.min(expires, Math.max(dayTtlEnd, electionDayStart + policy.electionDayTtlHours * 3600_000));
  }
  return new Date(expires).toISOString();
}

/** UTC ms of 00:00 Asia/Jerusalem on the given date (search within ±3h of UTC midnight; Israel is UTC+2/+3). */
export function startOfJerusalemDay(date: string): number {
  const base = Date.parse(`${date}T00:00:00Z`);
  for (let offsetH = 4; offsetH >= -1; offsetH--) {
    const candidate = base - offsetH * 3600_000;
    if (jerusalemDate(candidate) === date && jerusalemDate(candidate - 1) !== date) return candidate;
  }
  throw new Error(`cannot resolve start of day for ${date}`);
}

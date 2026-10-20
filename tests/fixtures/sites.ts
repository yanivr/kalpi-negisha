/**
 * SYNTHETIC TEST DATA — NOT REAL POLLING STATIONS. Never used in production builds.
 * Names start with "בדיקה" and coordinates are arbitrary points.
 */
import type { PollingSite, Station } from '../../src/domain/schema';

let seq = 0;
export function station(num: string, kind: Station['kind'] = 'accessible_special', instructions: string | null = null): Station {
  return { officialNumber: num, kind, active: 'yes', accessInstructions: instructions, evidence: { sourceId: 'fixture', recordLocator: `row:${++seq}` } };
}

export function site(p: Partial<PollingSite> & { id: string; lat?: number | null; lon?: number }): PollingSite {
  const point =
    p.lat === null || p.lat === undefined
      ? null
      : { lat: p.lat, lon: p.lon ?? 34.8, accuracy: 'building' as const, evidence: { sourceId: 'fixture', recordLocator: 'row:1' } };
  return {
    siteId: p.id,
    officialCompoundId: p.id,
    electionId: 'knesset-26',
    localityCode: p.localityCode ?? '9999',
    localityName: p.localityName ?? 'בדיקה-עיר',
    officialName: p.officialName ?? `בדיקה ${p.id}`,
    placeType: p.placeType ?? 'בית ספר ממלכתי',
    address: p.address ?? { locality: 'בדיקה-עיר', street: `רחוב ${p.id}`, house: '1', raw: `רחוב ${p.id},1` },
    point: p.point !== undefined ? p.point : point,
    publicAccess: p.publicAccess ?? { value: 'yes', reason: 'fixture' },
    stations: p.stations ?? [station('1')],
    blockedReasons: p.blockedReasons ?? [],
    evidence: [{ sourceId: 'fixture', recordLocator: 'row:1' }],
  };
}

/** A point used as "the searched address" in tests. */
export const HOME = { lat: 31.9, lon: 34.8 };
/** ≈ metres north of HOME. */
export const north = (meters: number) => HOME.lat + meters / 111_195;

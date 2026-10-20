import { airDistanceMeters, type LatLon } from './geo';
import type { PollingSite, Station } from './schema';

/**
 * Deterministic filtering, grouping and ranking (spec §8). No AI score, no invented "match %".
 */

export interface PlaceResult {
  /** Stable key of the physical place (one card per building). */
  placeKey: string;
  /** Representative site (first in stable order); `sites` holds every official compound merged into this place. */
  site: PollingSite;
  sites: PollingSite[];
  specialStations: Station[];
  distanceMeters: number | null;
  /** True only when both the searched point and the site point are precise enough to compare distances. */
  distanceReliable: boolean;
}

export interface SearchOutcome {
  results: PlaceResult[];
  /** Special-accessible places in the searched area that we do not recommend (institutions / unconfirmed public access). */
  excludedInstitutional: number;
  /** Places in the area excluded because of a conflict between official files. */
  excludedConflict: number;
  /** Special-accessible places in the searched locality that have no official coordinates (point mode only). */
  withoutCoordinatesInLocality: number;
}

export const MAX_RESULTS = 3;
export const RADIUS_STEPS_KM = [10, 25, 50] as const;

export function specialStationsOf(site: PollingSite): Station[] {
  return site.stations.filter((s) => s.kind === 'accessible_special' && s.active === 'yes');
}

function isCandidate(site: PollingSite): boolean {
  return specialStationsOf(site).length > 0;
}

function isRecommendable(site: PollingSite): boolean {
  return isCandidate(site) && site.publicAccess.value === 'yes' && site.blockedReasons.length === 0;
}

/** Physical-place key: identical official coordinates, or identical locality + official address string. */
export function placeKeysOf(site: PollingSite): string[] {
  const keys = [`addr:${site.localityCode}|${normaliseAddress(site.address.raw)}`];
  if (site.point) keys.push(`pt:${site.point.lat.toFixed(5)},${site.point.lon.toFixed(5)}`);
  return keys;
}

function normaliseAddress(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim();
}

/** Groups sites into places with union-find over shared keys, preserving the input order. */
function groupIntoPlaces(sites: PollingSite[]): PollingSite[][] {
  const parent = sites.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const owner = new Map<string, number>();
  sites.forEach((site, i) => {
    for (const key of placeKeysOf(site)) {
      const j = owner.get(key);
      if (j === undefined) owner.set(key, i);
      else {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  });
  const groups = new Map<number, PollingSite[]>();
  sites.forEach((site, i) => {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(site);
    groups.set(root, list);
  });
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
}

function toPlace(group: PollingSite[], distanceMeters: number | null, distanceReliable: boolean): PlaceResult {
  const site = group[0]!;
  return {
    placeKey: placeKeysOf(site)[0]!,
    site,
    sites: group,
    specialStations: group.flatMap(specialStationsOf),
    distanceMeters,
    distanceReliable,
  };
}

export interface PointQuery {
  point: LatLon;
  /** True when the address was resolved to a building / interpolated address, not a locality or street centroid. */
  precise: boolean;
  radiusKm: number;
  /** Official locality code of the searched address when it could be matched, used only for the "no coordinates" note. */
  localityCode: string | null;
}

export function searchByPoint(sites: PollingSite[], q: PointQuery): SearchOutcome {
  return searchNearPoints(sites, { ...q, points: [q.point] });
}

/**
 * Same as searchByPoint, but the searched location is a set of points (e.g. sampled along the user's street when no
 * house number is known); a place's distance is its distance to the nearest of those points.
 */
export function searchNearPoints(sites: PollingSite[], q: Omit<PointQuery, 'point'> & { points: LatLon[] }): SearchOutcome {
  const radiusM = q.radiusKm * 1000;
  const dist = (s: PollingSite) => {
    let best = Infinity;
    for (const p of q.points) {
      const d = airDistanceMeters(p, s.point!);
      if (d < best) best = d;
    }
    return best;
  };
  const withDist = sites.filter((s) => s.point !== null && isCandidate(s)).map((s) => ({ s, d: dist(s) }));
  const candidates = withDist.filter((x) => x.d <= radiusM).map((x) => x.s);
  const recommendable = candidates.filter(isRecommendable);
  const dOf = new Map(withDist.map((x) => [x.s.siteId, x.d]));
  const sorted = recommendable
    .map((s) => ({ s, d: dOf.get(s.siteId)! }))
    .sort((a, b) => a.d - b.d || compareIds(a.s.siteId, b.s.siteId));

  const places = groupIntoPlaces(sorted.map((x) => x.s));
  const distanceOf = new Map(sorted.map((x) => [x.s.siteId, x.d]));
  const results = places.slice(0, MAX_RESULTS).map((group) => {
    const d = distanceOf.get(group[0]!.siteId) ?? null;
    const reliable = q.precise && group.every((s) => s.point !== null && s.point.accuracy !== 'approximate');
    return toPlace(group, d, reliable);
  });

  return {
    results,
    excludedInstitutional: countPlaces(candidates.filter((s) => s.publicAccess.value !== 'yes')),
    excludedConflict: countPlaces(candidates.filter((s) => s.publicAccess.value === 'yes' && s.blockedReasons.length > 0)),
    withoutCoordinatesInLocality: q.localityCode
      ? countPlaces(sites.filter((s) => s.localityCode === q.localityCode && s.point === null && isRecommendable(s)))
      : 0,
  };
}

/**
 * Locality-only search (spec §7.2): every recommendable place in the chosen locality, ordered by official address,
 * never described as "nearest".
 */
export function searchByLocality(sites: PollingSite[], localityCode: string): SearchOutcome {
  const inLocality = sites.filter((s) => s.localityCode === localityCode && isCandidate(s));
  const recommendable = inLocality
    .filter(isRecommendable)
    .sort((a, b) => a.address.raw.localeCompare(b.address.raw, 'he') || compareIds(a.siteId, b.siteId));
  return {
    results: groupIntoPlaces(recommendable).map((g) => toPlace(g, null, false)),
    excludedInstitutional: countPlaces(inLocality.filter((s) => s.publicAccess.value !== 'yes')),
    excludedConflict: countPlaces(inLocality.filter((s) => s.publicAccess.value === 'yes' && s.blockedReasons.length > 0)),
    withoutCoordinatesInLocality: 0,
  };
}

function countPlaces(sites: PollingSite[]): number {
  return groupIntoPlaces(sites).length;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Natural ordering of official station numbers given as strings ("2" < "11.1" < "11.2"). */
export function compareStationNumbers(a: string, b: string): number {
  const [ai, af = ''] = a.split('.');
  const [bi, bf = ''] = b.split('.');
  return Number(ai) - Number(bi) || Number(af || 0) - Number(bf || 0);
}

/** Localities that have at least one recommendable special-accessible place. */
export function localitiesWithResults(sites: PollingSite[]): Set<string> {
  return new Set(sites.filter(isRecommendable).map((s) => s.localityCode));
}

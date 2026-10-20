import type { LatLon } from '../domain/geo';

/**
 * Optional address → point resolution through the Google Maps Geocoding API (owner decision, 20.10.2026).
 * Enabled only when a browser key restricted to this site's domain is provided at build time
 * (VITE_GOOGLE_MAPS_BROWSER_KEY). Only locality, street and house number are sent — after the user submits,
 * never while typing (spec §11, §20). No silent correction: anything ambiguous goes back to the user.
 */

const KEY: string | undefined = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY;
export const geocodingEnabled = typeof KEY === 'string' && KEY.length > 10;

export interface GeocodeCandidate {
  label: string;
  point: LatLon;
  /** Building-level or interpolated address — suitable for ranking by distance. */
  precise: boolean;
  localityName: string | null;
  /** The resolved locality equals the locality the user chose from the official list (after light normalisation). */
  localityMatches: boolean;
  partial: boolean;
}

export type GeocodeOutcome =
  | { kind: 'ok'; candidates: GeocodeCandidate[] }
  | { kind: 'not-found' }
  | { kind: 'unavailable' };

interface GoogleResult {
  formatted_address: string;
  partial_match?: boolean;
  types: string[];
  geometry: { location: { lat: number; lng: number }; location_type: string };
  address_components: Array<{ long_name: string; types: string[] }>;
}

const IL_BOUNDS = { minLat: 29.4, maxLat: 33.4, minLon: 34.2, maxLon: 35.95 };

export function interpretGoogleResults(results: GoogleResult[], expectedLocality: string): GeocodeCandidate[] {
  const norm = (s: string) => s.replace(/[-־\s'"׳״]/g, '');
  return results
    .filter((r) => {
      const { lat, lng } = r.geometry.location;
      return lat >= IL_BOUNDS.minLat && lat <= IL_BOUNDS.maxLat && lng >= IL_BOUNDS.minLon && lng <= IL_BOUNDS.maxLon;
    })
    .map((r) => {
      const loc = r.address_components.find((c) => c.types.includes('locality'))?.long_name ?? null;
      const buildingLevel = r.types.some((t) => ['street_address', 'premise', 'subpremise'].includes(t));
      const preciseType = ['ROOFTOP', 'RANGE_INTERPOLATED'].includes(r.geometry.location_type);
      return {
        label: r.formatted_address,
        point: { lat: r.geometry.location.lat, lon: r.geometry.location.lng },
        precise: buildingLevel && preciseType && !r.partial_match,
        localityName: loc,
        // A result in a different locality than the one chosen from the official list is never accepted silently:
        // the UI asks the user to confirm it.
        localityMatches: !!loc && norm(loc) === norm(expectedLocality),
        partial: !!r.partial_match,
      };
    });
}

/** Auto-accept only one unambiguous, building-level result in the chosen locality; otherwise the user confirms. */
export function needsConfirmation(candidates: GeocodeCandidate[]): boolean {
  return !(candidates.length === 1 && candidates[0]!.precise && candidates[0]!.localityMatches && !candidates[0]!.partial);
}

export async function geocodeAddress(q: { locality: string; street: string; house: string }): Promise<GeocodeOutcome> {
  if (!geocodingEnabled) return { kind: 'unavailable' };
  const address = `${q.street} ${q.house}`.trim() + `, ${q.locality}, ישראל`;
  const params = new URLSearchParams({ address, components: 'country:IL', language: 'he', region: 'il', key: KEY! });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
      signal: ctrl.signal,
      credentials: 'omit',
      // The key is restricted by HTTP referrer, so the origin must be sent — but never the page path.
      referrerPolicy: 'strict-origin',
    });
    if (!res.ok) return { kind: 'unavailable' };
    const body = (await res.json()) as { status: string; results: GoogleResult[] };
    if (body.status === 'ZERO_RESULTS') return { kind: 'not-found' };
    if (body.status !== 'OK') return { kind: 'unavailable' };
    const candidates = interpretGoogleResults(body.results, q.locality);
    return candidates.length ? { kind: 'ok', candidates } : { kind: 'not-found' };
  } catch {
    return { kind: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

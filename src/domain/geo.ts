export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle ("air line") distance in metres. */
export function airDistanceMeters(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Rounds a distance so it does not imply false precision (spec §7.3):
 * under 1 km → nearest 100 m (minimum 100 m); 1–10 km → one decimal; above 10 km → whole km.
 */
export function roundDistance(meters: number): { value: number; unit: 'm' | 'km' } {
  if (meters < 950) return { value: Math.max(100, Math.round(meters / 100) * 100), unit: 'm' };
  const km = meters / 1000;
  if (km < 10) return { value: Math.round(km * 10) / 10, unit: 'km' };
  return { value: Math.round(km), unit: 'km' };
}

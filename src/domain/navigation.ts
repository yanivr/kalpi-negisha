import type { PollingSite } from './schema';

/**
 * Navigation links (spec §19). Destination only — the user's origin/address is never included.
 * Coordinates are WGS84 converted from the official ITM coordinates of the building.
 */
export interface NavLinks {
  waze: string;
  google: string;
  /** 'coordinates' = navigate to the official building point; 'search' = opens a map search for the official address. */
  target: 'coordinates' | 'search';
}

const ALLOWED_HOSTS = new Set(['waze.com', 'www.google.com']);

export function navigationLinks(site: PollingSite): NavLinks {
  if (site.point) {
    const ll = `${site.point.lat.toFixed(6)},${site.point.lon.toFixed(6)}`;
    return {
      waze: `https://waze.com/ul?ll=${encodeURIComponent(ll)}&navigate=yes`,
      google: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ll)}`,
      target: 'coordinates',
    };
  }
  const q = `${site.address.raw.replace(/\s+/g, ' ').trim()}, ${site.localityName}`;
  return {
    waze: `https://waze.com/ul?q=${encodeURIComponent(q)}`,
    google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
    target: 'search',
  };
}

/** Defence in depth: only https links to the two navigation providers may be rendered. */
export function isAllowedExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

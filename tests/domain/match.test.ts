import { describe, expect, it } from 'vitest';
import { compareStationNumbers, searchByLocality, searchByPoint } from '../../src/domain/match';
import { HOME, north, site, station } from '../fixtures/sites';

const q = (radiusKm = 10, precise = true) => ({ point: HOME, precise, radiusKm, localityCode: '9999' });

describe('searchByPoint', () => {
  it('never offers an ordinary accessible station as an alternative, even when it is closer (spec §21.1)', () => {
    const sites = [
      site({ id: 'near-regular', lat: north(200), stations: [station('1', 'accessible_assigned')] }),
      site({ id: 'far-special', lat: north(3000), stations: [station('2')] }),
    ];
    const out = searchByPoint(sites, q());
    expect(out.results.map((r) => r.site.siteId)).toEqual(['far-special']);
  });

  it('in a building with both kinds, separates special stations from regular accessible ones; regular-only buildings never appear', () => {
    const sites = [
      site({ id: 'mixed', lat: north(300), stations: [station('9'), station('7', 'accessible_assigned'), station('8', 'accessible_assigned')] }),
      site({ id: 'regular-only', lat: north(100), stations: [station('3', 'accessible_assigned')] }),
    ];
    const out = searchByPoint(sites, q());
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.specialStations.map((s) => s.officialNumber)).toEqual(['9']);
    expect(out.results[0]!.regularStations.map((s) => s.officialNumber)).toEqual(['7', '8']);
    expect(searchByLocality(sites, sites[0]!.localityCode).results.map((r) => r.site.siteId)).toEqual(['mixed']);
  });

  it('excludes institutions whose public access is not confirmed and reports them', () => {
    const sites = [
      site({ id: 'home-for-elderly', lat: north(100), publicAccess: { value: 'unknown', reason: 'institution-type:בית אבות' } }),
      site({ id: 'school', lat: north(900) }),
    ];
    const out = searchByPoint(sites, q());
    expect(out.results.map((r) => r.site.siteId)).toEqual(['school']);
    expect(out.excludedInstitutional).toBe(1);
  });

  it('shows three stations in one building as one card and takes alternatives from other places', () => {
    const sites = [
      site({ id: 'b1-a', officialName: 'בדיקה אולם', lat: north(100), address: { locality: 'x', street: 'א', house: '1', raw: 'א,1' }, stations: [station('11.1')] }),
      site({ id: 'b1-b', officialName: 'בדיקה אולם', lat: north(100), address: { locality: 'x', street: 'א', house: '1', raw: 'א,1' }, stations: [station('11.2'), station('11.3')] }),
      site({ id: 'b2', lat: north(500) }),
      site({ id: 'b3', lat: north(800) }),
      site({ id: 'b4', lat: north(1200) }),
    ];
    const out = searchByPoint(sites, q());
    expect(out.results).toHaveLength(3);
    expect(out.results[0]!.specialStations.map((s) => s.officialNumber)).toEqual(['11.1', '11.2', '11.3']);
    expect(out.results.map((r) => r.site.siteId)).toEqual(['b1-a', 'b2', 'b3']);
  });

  it('merges compounds at identical coordinates only when the official place name is the same', () => {
    const sites = [
      site({ id: 'c1', officialName: 'בדיקה מתנ"ס', lat: north(300) }),
      site({ id: 'c2', officialName: 'בדיקה מתנ"ס', lat: north(300) }),
      site({ id: 'c3', lat: north(600) }),
    ];
    expect(searchByPoint(sites, q()).results.map((r) => r.sites.map((s) => s.siteId))).toEqual([['c1', 'c2'], ['c3']]);
  });

  it('never merges differently named compounds, even at the same point or the same address (another wing / school)', () => {
    const same = { locality: 'x', street: null, house: null, raw: 'בדיקה-עיר' } as const;
    const sites = [
      site({ id: 'wing-a', officialName: 'בדיקה תיכון-אגף מינהלה', lat: north(300), address: { ...same }, stations: [station('37'), station('42')] }),
      site({ id: 'wing-b', officialName: 'בדיקה תיכון-אגף מורות', lat: north(300), address: { ...same }, stations: [station('41.1')] }),
    ];
    const out = searchByPoint(sites, q());
    expect(out.results.map((r) => [r.site.officialName, r.specialStations.map((s) => s.officialNumber)])).toEqual([
      ['בדיקה תיכון-אגף מינהלה', ['37', '42']],
      ['בדיקה תיכון-אגף מורות', ['41.1']],
    ]);
  });

  it('does not pad results to three', () => {
    const out = searchByPoint([site({ id: 'only', lat: north(500) })], q());
    expect(out.results).toHaveLength(1);
  });

  it('respects the radius and only widens it when asked', () => {
    const sites = [site({ id: 'far', lat: north(18_000) })];
    expect(searchByPoint(sites, q(10)).results).toHaveLength(0);
    expect(searchByPoint(sites, q(25)).results).toHaveLength(1);
  });

  it('excludes sites blocked by a source conflict', () => {
    const sites = [site({ id: 'conflict', lat: north(100), blockedReasons: ['conflict:x'] }), site({ id: 'ok', lat: north(200) })];
    const out = searchByPoint(sites, q());
    expect(out.results.map((r) => r.site.siteId)).toEqual(['ok']);
    expect(out.excludedConflict).toBe(1);
  });

  it('marks distance unreliable when the searched point is imprecise', () => {
    const out = searchByPoint([site({ id: 's', lat: north(500) })], q(10, false));
    expect(out.results[0]!.distanceReliable).toBe(false);
  });

  it('breaks distance ties by stable id', () => {
    const sites = [site({ id: 'b', lat: north(500), lon: 34.81 }), site({ id: 'a', lat: north(500), lon: 34.79 })];
    const out = searchByPoint(sites, q());
    expect(out.results.map((r) => r.site.siteId)).toEqual(['a', 'b']);
  });

  it('counts places without coordinates in the searched locality', () => {
    const sites = [site({ id: 'nocoord', lat: null }), site({ id: 'withcoord', lat: north(100) })];
    expect(searchByPoint(sites, q()).withoutCoordinatesInLocality).toBe(1);
  });
});

describe('searchByLocality', () => {
  it('returns every recommendable place in the locality, including ones without coordinates, sorted by address', () => {
    const sites = [
      site({ id: '2', lat: null, address: { locality: 'x', street: 'ב', house: '1', raw: 'ב,1' } }),
      site({ id: '1', lat: north(100), address: { locality: 'x', street: 'א', house: '1', raw: 'א,1' } }),
      site({ id: 'other-town', localityCode: '1', lat: north(10) }),
    ];
    const out = searchByLocality(sites, '9999');
    expect(out.results.map((r) => r.site.siteId)).toEqual(['1', '2']);
    expect(out.results.every((r) => r.distanceMeters === null)).toBe(true);
  });
});

describe('compareStationNumbers', () => {
  it('orders official numbers naturally and treats them as strings', () => {
    expect(['11.2', '2', '11.1', '100', '11'].sort(compareStationNumbers)).toEqual(['2', '11', '11.1', '11.2', '100']);
  });
});

import { describe, expect, it } from 'vitest';
import { exactStreet, normaliseHouse, normaliseStreet, suggestStreets, tokenKey } from '../../src/domain/streets';
import { searchNearPoints } from '../../src/domain/match';
import { HOME, north, site } from '../fixtures/sites';

describe('street name normalisation', () => {
  it('unifies abbreviations, punctuation and quotes', () => {
    expect(normaliseStreet("שד' ירושלים")).toBe('שדרות ירושלים');
    expect(normaliseStreet('שד ירושלים')).toBe('שדרות ירושלים');
    expect(normaliseStreet('רחוב הרצל')).toBe('הרצל');
    expect(normaliseStreet('בית"ר')).toBe('ביתר');
    expect(normaliseStreet('בית״ר')).toBe('ביתר');
    expect(normaliseStreet('בן-גוריון')).toBe('בן גוריון');
    expect(normaliseStreet('ככר המדינה')).toBe('כיכר המדינה');
  });
  it('token key ignores word order', () => {
    expect(tokenKey('אברך חנה')).toBe(tokenKey('חנה אברך'));
  });
});

const streets = [
  { code: 1, nameHe: 'הרצל', aliases: [] },
  { code: 2, nameHe: 'הרצוג', aliases: ['הרב הרצוג'] },
  { code: 3, nameHe: 'בן גוריון דוד', aliases: ['דוד בן גוריון', 'בן גוריון'] },
  { code: 4, nameHe: 'שדרות הרצל', aliases: [] },
];

describe('street suggestions', () => {
  it('lists prefix matches first', () => {
    expect(suggestStreets(streets, 'הרצ').map((s) => s.code)).toEqual([1, 2, 4]);
  });
  it('matches aliases and word starts', () => {
    expect(suggestStreets(streets, 'גוריון').map((s) => s.code)).toEqual([3]);
    expect(suggestStreets(streets, 'דוד בן').map((s) => s.code)).toEqual([3]);
  });
  it('exact match resolves a single street, else null', () => {
    expect(exactStreet(streets, 'הרצל')?.code).toBe(1);
    expect(exactStreet(streets, 'בן-גוריון')?.code).toBe(3);
    expect(exactStreet(streets, 'הר')).toBeNull();
  });
});

describe('house numbers', () => {
  it('normalises', () => {
    expect(normaliseHouse(' 12 ')).toBe('12');
    expect(normaliseHouse('12 א')).toBe('12א');
    expect(normaliseHouse('012')).toBe('12');
    expect(normaliseHouse('12/3')).toBeNull();
  });
});

describe('search near a street line', () => {
  it('ranks by distance to the nearest point of the street, not its middle', () => {
    // A long street from HOME to 3km north; place A is next to the far end, place B 1km east of the middle.
    const line = [0, 500, 1000, 1500, 2000, 2500, 3000].map((m) => ({ lat: north(m), lon: HOME.lon }));
    const a = site({ id: 'A', lat: north(3000), lon: HOME.lon + 0.001 }); // ~95 m from the line
    const b = site({ id: 'B', lat: north(1500), lon: HOME.lon + 0.0105 }); // ~1 km from the line
    const out = searchNearPoints([b, a], { points: line, precise: false, radiusKm: 10, localityCode: null });
    expect(out.results.map((r) => r.site.siteId)).toEqual(['A', 'B']);
    expect(out.results[0]!.distanceMeters!).toBeLessThan(150);
  });
});

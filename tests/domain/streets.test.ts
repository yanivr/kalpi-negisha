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

import { locateHouse } from '../../src/domain/streets';
describe('locateHouse', () => {
  const nums = { '2': { lat: 32, lon: 34 }, '10': { lat: 32.008, lon: 34 }, '5': { lat: 31, lon: 35 }, '12א': { lat: 33, lon: 33 } };
  it('exact', () => expect(locateHouse(nums, '10')).toEqual({ point: nums['10'], kind: 'exact' }));
  it('interpolates on the same side of the street', () => {
    const r = locateHouse(nums, '6')!;
    expect(r.kind).toBe('interpolated');
    expect(r.point.lat).toBeCloseTo(32.004, 6);
  });
  it('uses a near number on the same side only', () => {
    expect(locateHouse(nums, '14')).toEqual({ point: nums['10'], kind: 'nearby' });
    expect(locateHouse(nums, '7')).toEqual({ point: nums['5'], kind: 'nearby' });
    expect(locateHouse(nums, '40')).toBeNull();
  });
});

import { exactLocality, suggestLocalities, type LocalityOption } from '../../src/domain/streets';
describe('locality matching', () => {
  const L: LocalityOption[] = [
    { code: '5000', name: 'תל אביב - יפו', aliases: ['Tel Aviv - Yafo', 'ת"א', 'תל אביב'] },
    { code: '2800', name: 'קרית שמונה', aliases: ['Qiryat Shemona'] },
    { code: '7900', name: 'פתח תקווה', aliases: ['Petah Tiqwa'] },
    { code: '1200', name: 'מודיעין-מכבים-רעות', aliases: ['מודיעין'] },
    { code: '3797', name: 'מודיעין עילית', aliases: [] },
  ];
  it('accepts spelling variants and short forms', () => {
    expect(exactLocality(L, 'קריית שמונה')?.code).toBe('2800');
    expect(exactLocality(L, 'פתח תקוה')?.code).toBe('7900');
    expect(exactLocality(L, 'ת"א')?.code).toBe('5000');
    expect(exactLocality(L, 'תל-אביב')?.code).toBe('5000');
    expect(exactLocality(L, 'tel aviv yafo')?.code).toBe('5000');
    expect(exactLocality(L, 'מודיעין')?.code).toBe('1200');
  });
  it('suggests by prefix and word start, exact first', () => {
    expect(suggestLocalities(L, 'מודי').map((l) => l.code).sort()).toEqual(['1200', '3797']);
    expect(suggestLocalities(L, 'יפו').map((l) => l.code)).toEqual(['5000']);
    expect(suggestLocalities(L, 'qir').map((l) => l.code)).toEqual(['2800']);
    expect(suggestLocalities(L, 'xyz')).toEqual([]);
  });
});

describe('English locality spellings', () => {
  const L: LocalityOption[] = [
    { code: '2600', name: 'אילת', aliases: ['Elat'] },
    { code: '2630', name: 'קרית גת', aliases: ['Qiryat Gat'] },
    { code: '7900', name: 'פתח תקווה', aliases: ['Petah Tiqwa'] },
    { code: '3780', name: 'ביתר עילית', aliases: ['Betar Illit'] },
    { code: '2610', name: 'בית שמש', aliases: ['Bet Shemesh'] },
  ];
  it('accepts common spellings of the official transliteration', () => {
    expect(exactLocality(L, 'Eilat')?.code).toBe('2600');
    expect(exactLocality(L, 'kiryat gat')?.code).toBe('2630');
    expect(exactLocality(L, 'Petah Tikva')?.code).toBe('7900');
    expect(exactLocality(L, 'Beitar Ilit')?.code).toBe('3780');
    expect(exactLocality(L, 'Beit Shemesh')?.code).toBe('2610');
  });
});

describe('loose Latin suggestions', () => {
  const L: LocalityOption[] = [{ code: '2800', name: 'קרית שמונה', aliases: ['Qiryat Shemona'] }, { code: '9000', name: 'באר שבע', aliases: ["Be'er Sheva"] }];
  it('suggests (but never auto-picks) when only vowels differ', () => {
    expect(suggestLocalities(L, 'Kiryat Shmona').map((l) => l.code)).toEqual(['2800']);
    expect(exactLocality(L, 'Kiryat Shmona')).toBeNull();
  });
});

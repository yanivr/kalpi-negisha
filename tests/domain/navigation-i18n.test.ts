import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isAllowedExternalUrl, navigationLinks } from '../../src/domain/navigation';
import { DICTS, LOCALES } from '../../src/i18n';
import { roundDistance } from '../../src/domain/geo';
import { site } from '../fixtures/sites';

describe('navigation links', () => {
  it('contain only the destination, never an origin', () => {
    const n = navigationLinks(site({ id: 'x', lat: 31.123456789, lon: 34.987654321 }));
    expect(n.target).toBe('coordinates');
    expect(n.waze).toBe('https://waze.com/ul?ll=31.123457%2C34.987654&navigate=yes');
    expect(n.google).toBe('https://www.google.com/maps/dir/?api=1&destination=31.123457%2C34.987654');
    for (const u of [n.waze, n.google]) {
      expect(u).not.toMatch(/origin|saddr|from=/i);
      expect(u).not.toMatch(/travelmode/);
    }
  });

  it('fall back to an address search (not "navigation to the entrance") without coordinates', () => {
    const n = navigationLinks(site({ id: 'y', lat: null, address: { locality: 'ע', street: 'הרצל', house: '5', raw: 'הרצל,5 ' }, localityName: 'רחובות' }));
    expect(n.target).toBe('search');
    expect(decodeURIComponent(n.google)).toContain('הרצל,5, רחובות');
    expect(n.google.startsWith('https://www.google.com/maps/search/')).toBe(true);
  });

  it('only allow https links to the two providers', () => {
    expect(isAllowedExternalUrl('https://waze.com/ul?ll=1,2')).toBe(true);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('http://waze.com/ul')).toBe(false);
    expect(isAllowedExternalUrl('https://evil.example/maps')).toBe(false);
  });
});

describe('distance rounding', () => {
  it('avoids false precision', () => {
    expect(roundDistance(37)).toEqual({ value: 100, unit: 'm' });
    expect(roundDistance(449)).toEqual({ value: 400, unit: 'm' });
    expect(roundDistance(1234)).toEqual({ value: 1.2, unit: 'km' });
    expect(roundDistance(12_600)).toEqual({ value: 13, unit: 'km' });
  });
});

describe('translations', () => {
  const he = DICTS.he as Record<string, unknown>;
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  for (const l of LOCALES) {
    const d = DICTS[l] as Record<string, unknown>;
    it(`${l}: has exactly the same keys as Hebrew`, () => {
      expect(Object.keys(d).sort()).toEqual(Object.keys(he).sort());
    });
    it(`${l}: same placeholders per key and no empty core strings`, () => {
      for (const [k, v] of Object.entries(he)) {
        const x = d[k];
        if (Array.isArray(v)) {
          expect(Array.isArray(x), k).toBe(true);
          expect((x as string[]).length, k).toBe(v.length);
          continue;
        }
        expect(typeof x, k).toBe('string');
        expect(placeholders(x as string), k).toEqual(placeholders(v as string));
        const mayBeEmpty = ['accessInstructionsOriginal', 'localityHint'];
        if (!mayBeEmpty.includes(k)) expect((x as string).trim().length, `${l}.${k}`).toBeGreaterThan(0);
      }
    });
    it(`${l}: no unprovable absolute claims`, () => {
      const all = JSON.stringify(d);
      expect(all).not.toMatch(/100\s?%|נגיש לחלוטין|fully accessible/);
    });
    it(`${l}: non-Hebrew locales are not silently Hebrew`, () => {
      if (l === 'he') return;
      for (const k of ['h1', 'submit', 'conditionalReminder', 'navNotVerified', 'statusBlocked']) {
        expect(/[֐-׿]/.test(d[k] as string), `${l}.${k}`).toBe(false);
      }
    });
  }

  it('rule texts exist for all four languages with the same number of points', () => {
    const rules = JSON.parse(readFileSync('config/rules.json', 'utf8'));
    const r = rules.rules[0];
    const n = r.texts.he.points.length;
    for (const l of LOCALES) {
      expect(r.texts[l].points).toHaveLength(n);
      expect(r.texts[l].title.length).toBeGreaterThan(0);
    }
  });

  it('directions are correct', () => {
    expect(DICTS.he.dir).toBe('rtl');
    expect(DICTS.ar.dir).toBe('rtl');
    expect(DICTS.ru.dir).toBe('ltr');
    expect(DICTS.am.dir).toBe('ltr');
  });
});

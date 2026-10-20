import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Browser tests against a SYNTHETIC release (scripts/e2e-prepare.ts). Locality names start with "בדיקה".
 * These are automated checks only — they do not replace screen-reader or user testing (spec §21.4).
 */

const LOCALES = [
  { l: 'he', lang: 'he-IL', dir: 'rtl' },
  { l: 'ar', lang: 'ar-IL', dir: 'rtl' },
  { l: 'ru', lang: 'ru', dir: 'ltr' },
  { l: 'am', lang: 'am', dir: 'ltr' },
] as const;

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

async function searchLocality(page: Page, name: string) {
  await page.locator('#f-locality').selectOption({ label: name });
  await page.locator('#search-submit').click();
  await expect(page.locator('#results-h')).toBeFocused();
}

/** Records every request leaving the site's own origin. */
function watchExternal(page: Page): string[] {
  const out: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== '127.0.0.1') out.push(r.url());
  });
  return out;
}

for (const { l, lang, dir } of LOCALES) {
  test(`${l}: correct language/direction and no automated accessibility violations on search and results`, async ({ page }) => {
    await page.goto(`/${l}/`);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.locator('html')).toHaveAttribute('dir', dir);
    await expect(page.locator('#f-locality')).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.locator('details.rules summary').click();
    expect(await axe(page)).toEqual([]);
    await searchLocality(page, 'בדיקה-א');
    await expect(page.locator('.cards > li')).toHaveCount(2);
    expect(await axe(page)).toEqual([]);
  });

  for (const view of ['sources', 'privacy', 'accessibility']) {
    test(`${l}: ${view} page has no automated accessibility violations`, async ({ page }) => {
      await page.goto(`/${l}/${view}/`);
      await expect(page.locator('h1')).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });
  }
}

test('keyboard-only: skip link, choose locality, submit, focus moves to results, links are reachable', async ({ page }) => {
  await page.goto('/he/');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.locator('#f-locality').focus();
  // Choose the option with the keyboard only.
  await page.keyboard.press('ArrowDown');
  const value = await page.locator('#f-locality').inputValue();
  expect(value).not.toBe('');
  await page.keyboard.press('Tab'); // to submit button (no street fields without a geocoding key)
  await expect(page.locator('#search-submit')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#results-h')).toBeFocused();
  // Reach the first navigation link with Tab.
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const href = await page.evaluate(() => (document.activeElement as HTMLAnchorElement | null)?.getAttribute('href') ?? '');
    if (href.startsWith('https://waze.com/')) return;
  }
  throw new Error('navigation link not reachable by keyboard');
});

test('submitting without a locality shows a linked error summary and marks the field invalid', async ({ page }) => {
  await page.goto('/he/');
  await page.locator('#search-submit').click();
  await expect(page.locator('.error-summary')).toBeFocused();
  await expect(page.locator('#f-locality')).toHaveAttribute('aria-invalid', 'true');
  expect(await axe(page)).toEqual([]);
});

test('results: one card per building, institutions excluded, places without coordinates use address search', async ({ page }) => {
  await page.goto('/he/');
  await searchLocality(page, 'בדיקה-א');
  const cards = page.locator('.cards > li');
  await expect(cards).toHaveCount(2);
  await expect(page.getByText('בית אבות בדיקה')).toHaveCount(0);
  await expect(page.locator('.results .note').filter({ hasText: 'בתי אבות' })).toBeVisible();
  // compound 2 has stations 4.1 and 4.2 in a single card
  await expect(page.locator('.card').filter({ hasText: 'מתנ"ס בדיקה' }).locator('.num')).toHaveText(['4.1', '4.2']);
  // official access instructions are shown verbatim
  await expect(page.getByText('כניסה לבדיקה משער צדדי')).toBeVisible();

  await page.getByRole('button', { name: 'שינוי כתובת' }).click();
  await searchLocality(page, 'בדיקה-ב');
  const google = await page.locator('.card a[href*="google.com"]').getAttribute('href');
  expect(google).toContain('/maps/search/');
});

test('locality without a special station suggests nearby places with approximate distance', async ({ page }) => {
  await page.goto('/he/');
  await searchLocality(page, 'בדיקה-ג');
  await expect(page.getByText('ביישוב בדיקה-ג אין קלפי נגישה מיוחדת')).toBeVisible();
  await expect(page.locator('.cards > li').first()).toContainText('מרחק משוער');
  await expect(page.locator('.card-label').first()).toHaveText('אפשרות באזור שחיפשתם');
});

test('privacy: no storage, no address in the URL, no external requests, navigation links carry no origin', async ({ page, context }) => {
  const external = watchExternal(page);
  await page.goto('/he/');
  await searchLocality(page, 'בדיקה-א');
  expect(page.url()).toBe('http://127.0.0.1:4173/he/');
  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    cookie: document.cookie,
    idb: (await indexedDB.databases?.())?.length ?? 0,
    sw: (await navigator.serviceWorker?.getRegistrations?.())?.length ?? 0,
  }));
  expect(storage).toEqual({ local: 0, session: 0, cookie: '', idb: 0, sw: 0 });
  expect(await context.cookies()).toEqual([]);
  expect(external).toEqual([]);
  for (const href of await page.locator('.card a[target=_blank]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!))) {
    expect(href).toMatch(/^https:\/\/(waze\.com|www\.google\.com)\//);
    expect(href).not.toMatch(/origin|saddr/);
  }
  const rel = await page.locator('.card a[target=_blank]').first().getAttribute('rel');
  expect(rel).toContain('noreferrer');
});

test('language switch keeps the search and results, and updates lang/dir', async ({ page }) => {
  await page.goto('/he/');
  await searchLocality(page, 'בדיקה-א');
  await page.getByRole('link', { name: 'Русский' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('#results-h')).toHaveText('Результаты');
  await expect(page.locator('.cards > li')).toHaveCount(2);
  expect(new URL(page.url()).pathname).toBe('/ru/');
});

test('clear search removes the address and results', async ({ page }) => {
  await page.goto('/he/');
  await searchLocality(page, 'בדיקה-א');
  await page.getByRole('button', { name: 'ניקוי החיפוש' }).click();
  await expect(page.locator('#f-locality')).toHaveValue('');
  await expect(page.locator('#results-h')).toHaveCount(0);
});

async function withManifest(page: Page, patch: Record<string, unknown>) {
  await page.route('**/data/manifest.json', async (route) => {
    const res = await route.fetch();
    const body = { ...(await res.json()), ...patch };
    await route.fulfill({ response: res, body: JSON.stringify(body), headers: { ...res.headers(), 'content-type': 'application/json' } });
  });
}

test('blocked release: no search form, explanation and official route shown', async ({ page }) => {
  await withManifest(page, { status: 'blocked', reasons: ['rules:pending-official-text'] });
  await page.goto('/he/');
  await expect(page.getByText('כרגע לא ניתן להציג קלפיות')).toBeVisible();
  await expect(page.locator('form.search')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'בירור רשמי' })).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test('after polls close the page switches to archive mode without a new deployment', async ({ page }) => {
  await withManifest(page, { pollsCloseAt: '2020-01-01T00:00:00Z' });
  await page.goto('/he/');
  await expect(page.getByText('הבחירות לכנסת ה־26 הסתיימו')).toBeVisible();
  await expect(page.locator('form.search')).toHaveCount(0);
});

test('TTL policy: an expired snapshot is not shown even if the page stays open', async ({ page }) => {
  await withManifest(page, { freshnessPolicy: 'ttl', expiresAt: '2020-01-01T00:00:00Z' });
  await page.goto('/he/');
  await expect(page.getByText('המידע לא נבדק לאחרונה')).toBeVisible();
  await expect(page.locator('form.search')).toHaveCount(0);
});

test('a dataset that does not match the manifest hash is rejected', async ({ page }) => {
  await withManifest(page, { datasetSha256: '0'.repeat(64) });
  await page.goto('/he/');
  await expect(page.getByText('לא הצלחנו לטעון את המידע')).toBeVisible();
  await expect(page.locator('form.search')).toHaveCount(0);
});

test('degraded: last refresh failed — results still shown with a visible notice', async ({ page }) => {
  await withManifest(page, { status: 'degraded', lastAttemptResult: 'failed' });
  await page.goto('/he/');
  await expect(page.getByText('הבדיקה האחרונה מול המקור הרשמי לא הושלמה')).toBeVisible();
  await searchLocality(page, 'בדיקה-א');
});

for (const l of ['he', 'ar', 'ru', 'am']) {
  test(`${l}: reflow at 320 CSS px and 200% text — no horizontal scrolling on the main path`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/${l}/`);
    // 200% of the default 125% root size; CSSOM change (the CSP correctly blocks injected <style> tags).
    await page.evaluate(() => document.documentElement.style.setProperty('font-size', '250%', 'important'));
    const overflowNow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflowNow()).toBeLessThanOrEqual(0);
    await searchLocality(page, 'בדיקה-א');
    expect(await overflowNow()).toBeLessThanOrEqual(0);
  });
}

test('primary touch targets are at least 48×48 CSS px', async ({ page }) => {
  await page.goto('/he/');
  await searchLocality(page, 'בדיקה-א');
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.button, .lang-list a, select')]
      .map((el) => ({ t: el.textContent?.trim(), r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 48 || r.height < 48))
      .map(({ t, r }) => `${t} ${Math.round(r.width)}×${Math.round(r.height)}`),
  );
  expect(small).toEqual([]);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('shows a working official route instead of an empty page', async ({ page }) => {
    await page.goto('/ar/');
    await expect(page.locator('h1')).toHaveText('البحث عن صندوق اقتراع متاح خاص');
    await expect(page.locator('a[href*="gov.il"]').first()).toBeVisible();
  });
});

test('works inside a sandboxed frame that forbids form submission (hosted embedding)', async ({ page }) => {
  await page.route('**/__host', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>host</title><iframe id="f" src="/he/" sandbox="allow-scripts allow-same-origin allow-popups" style="width:420px;height:900px"></iframe>',
    }),
  );
  await page.goto('/__host');
  const fr = page.frameLocator('#f');
  await fr.locator('#f-locality').selectOption({ label: 'בדיקה-א' });
  await fr.locator('#search-submit').click();
  await expect(fr.locator('#results-h')).toBeVisible();
  await expect(fr.locator('.cards > li')).toHaveCount(2);
  // Enter in the field also searches
  await fr.getByRole('button', { name: 'שינוי כתובת' }).click();
  await fr.locator('#f-locality').selectOption({ label: 'בדיקה-ב' });
  await fr.locator('#f-locality').press('Enter');
  await expect(fr.locator('#results-h')).toBeVisible();
});

// Mobile + accessibility audit on a built site with real data.
// Checks per device × language × screen: horizontal overflow, axe (WCAG 2.0/2.1/2.2 A+AA), target size (2.5.8),
// input font size (no iOS zoom-on-focus), zoom not disabled, text spacing (1.4.12), 400% zoom reflow (1.4.10).
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
const base = (process.env.BASE || 'http://127.0.0.1:4195/kalpi-negisha/').replace(/\/?$/, '/');
const shots = process.env.SHOTS || '';
if (shots) mkdirSync(shots, { recursive: true });
const devices = [
  ['320x568', 320, 568], ['360x740', 360, 740], ['375x667', 375, 667], ['390x844', 390, 844], ['414x896', 414, 896],
  ['landscape 844x390', 844, 390], ['tablet 768x1024', 768, 1024],
];
const LOCALES = { he: ['ניקוי החיפוש', 'רחובות', 'הרצל', '150'], ar: null, ru: null, am: null };
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--no-zygote'] } : {});
const problems = [];
let checks = 0;
const flag = (where, what) => problems.push(`${where}: ${what}`);

async function inspect(page, where, { axe = true } = {}) {
  checks++;
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const overflow = de.scrollWidth - de.clientWidth;
    const wide = [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > de.clientWidth + 1 || r.left < -1) && !el.closest('.visually-hidden,.sr-live,.skip-link');
    }).slice(0, 3).map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
    const small = [...document.querySelectorAll('a[href],button,input,select,summary,[role=button]')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest('.visually-hidden') || el.classList.contains('skip-link')) return false;
      const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p,li,dd');
      return !inline && (r.width < 24 || r.height < 24);
    }).map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.id).trim().slice(0, 20)}" ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
    const under44 = [...document.querySelectorAll('button,input,select,summary,.button')].filter((el) => { const r = el.getBoundingClientRect(); return r.height && r.height < 44; }).length;
    const smallFont = [...document.querySelectorAll('input,select,textarea')].filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.id);
    const vp = document.querySelector('meta[name=viewport]')?.getAttribute('content') || '';
    return { overflow, wide, small, under44, smallFont, vp };
  });
  if (m.overflow > 0) flag(where, `horizontal overflow ${m.overflow}px (${m.wide.join(', ')})`);
  if (m.small.length) flag(where, `targets under 24px: ${m.small.join('; ')}`);
  if (m.under44) flag(where, `(advisory) ${m.under44} controls under 44px high`);
  if (m.smallFont.length) flag(where, `input font under 16px: ${m.smallFont.join(',')}`);
  if (/user-scalable=no|maximum-scale=1(\D|$)/.test(m.vp)) flag(where, `zoom disabled: ${m.vp}`);
  if (axe) {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    for (const v of r.violations) flag(where, `axe ${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`);
  }
}

for (const [dname, w, h] of devices) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 700, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  for (const l of Object.keys(LOCALES)) {
    const at = (s) => `${dname} ${l} ${s}`;
    await page.goto(`${base}${l}/`);
    await page.locator('#f-locality').waitFor({ timeout: 20000 });
    await inspect(page, at('form'));
    if (shots && l === 'he') await page.screenshot({ path: `${shots}/${dname.replace(/\W+/g, '_')}-form.png`, fullPage: true });
    // error state
    await page.locator('#search-submit').click();
    await page.locator('.error-summary').waitFor();
    await inspect(page, at('error'));
    // locality suggestions
    await page.locator('#f-locality').fill('קרי');
    await page.locator('#locality-suggestions').waitFor();
    await inspect(page, at('locality suggestions'));
    await page.locator('#f-locality').fill('');
    await page.locator('#f-locality').pressSequentially('רחובו');
    await page.locator('#locality-suggestions .suggestion', { hasText: /^רחובות$/ }).tap();
    await page.locator('#f-street').pressSequentially('הרצ');
    await page.locator('#street-suggestions').waitFor();
    await inspect(page, at('street suggestions'));
    if (shots && l === 'he') await page.screenshot({ path: `${shots}/${dname.replace(/\W+/g, '_')}-suggest.png`, fullPage: true });
    await page.locator('#street-suggestions .suggestion', { hasText: /^הרצל$/ }).tap();
    await page.locator('#f-house').fill('150');
    await page.locator('#search-submit').tap();
    await page.locator('#results-h').waitFor();
    await inspect(page, at('results'));
    if (shots && l === 'he') await page.screenshot({ path: `${shots}/${dname.replace(/\W+/g, '_')}-results.png`, fullPage: true });
    await page.locator('details.rules summary').tap();
    await inspect(page, at('rules open'), { axe: false });
    for (const v of ['sources', 'privacy', 'accessibility']) {
      await page.goto(`${base}${l}/${v}/`);
      await page.locator('h1').waitFor();
      await inspect(page, at(v));
      if (shots && l === 'he' && v === 'accessibility') await page.screenshot({ path: `${shots}/${dname.replace(/\W+/g, '_')}-a11y.png`, fullPage: true });
    }
  }
  if (errs.length) flag(dname, `page errors ${JSON.stringify(errs)}`);
  await ctx.close();
}

// 1.4.10 reflow: 1280px at 400% zoom ≈ 320 CSS px; 1.4.12 text spacing at 320px.
{
  const ctx = await b.newContext({ viewport: { width: 320, height: 256 } });
  const page = await ctx.newPage();
  for (const l of Object.keys(LOCALES)) {
    await page.goto(`${base}${l}/`);
    await page.locator('#f-locality').waitFor();
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.textContent = '*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}';
      document.head.appendChild(s);
    }).catch(() => {});
    await page.locator('#f-locality').fill('רחובות');
    await page.locator('#search-submit').click();
    await page.locator('#results-h').waitFor();
    await inspect(page, `reflow 320x256 + text spacing ${l} results`, { axe: false });
  }
  await ctx.close();
}
// 200% text size (browser text zoom) at 360px.
{
  const ctx = await b.newContext({ viewport: { width: 360, height: 740 } });
  const page = await ctx.newPage();
  await page.goto(`${base}he/`);
  await page.locator('#f-locality').waitFor();
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.locator('#f-locality').fill('ירושלים');
  await page.locator('#search-submit').click();
  await page.locator('#results-h').waitFor();
  await inspect(page, '200% text 360px he results', { axe: false });
  if (shots) await page.screenshot({ path: `${shots}/text200-results.png`, fullPage: false });
  await ctx.close();
}
await b.close();
console.log(`checks: ${checks}`);
const hard = problems.filter((p) => !p.includes('(advisory)'));
const adv = problems.filter((p) => p.includes('(advisory)'));
console.log(`problems: ${hard.length}`);
for (const p of hard) console.log(' ✗ ' + p);
console.log(`advisory: ${adv.length}`);
for (const p of [...new Set(adv.map((x) => x.replace(/^\S+( \S+)? /, '')))].slice(0, 10)) console.log(' · ' + p);
if (hard.length) process.exit(1);

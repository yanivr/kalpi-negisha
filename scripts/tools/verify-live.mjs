// Post-deploy check against the live site: real files served, real street searches return nearby verified places.
// Exits non-zero on any failure. Usage: BASE=https://…/kalpi-negisha/ node scripts/tools/verify-live.mjs
import { chromium } from 'playwright';
import { appendFileSync } from 'node:fs';
const base = (process.env.BASE || '').replace(/\/?$/, '/');
if (!/^https?:\/\//.test(base)) throw new Error('BASE is required');
const fails = [];
const lines = [];
const ok = (cond, msg) => { lines.push(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) fails.push(msg); };

const get = async (p) => { const r = await fetch(base + p, { cache: 'no-store' }); return { status: r.status, text: r.ok ? await r.text() : '' }; };
const man = await get('data/manifest.json');
ok(man.status === 200, `manifest.json HTTP ${man.status}`);
const geo = await get('data/geo.json');
const g = geo.status === 200 ? JSON.parse(geo.text) : {};
ok(g.source === 'osm+official', `geo.json source=${g.source} streets=${g.totals?.streets} withGeometry=${g.totals?.withGeometry}`);
const reh = await get('data/geo/8400.json');
ok(reh.status === 200 && JSON.parse(reh.text).streets.some((s) => s[3]), `Rehovot street file HTTP ${reh.status}`);

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const p = await b.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
for (const l of ['he', 'ar', 'ru', 'am']) {
  const r = await p.goto(`${base}${l}/`);
  await p.locator('#f-locality').waitFor({ timeout: 20000 });
  ok(r.status() === 200 && (await p.locator('#f-locality option').count()) > 1000, `/${l}/ loads with the locality list`);
}
await p.goto(`${base}he/`);
await p.locator('#f-locality').waitFor();
const cases = [
  ['רחובות', 'הרצל', '150', 1000], ['ירושלים', 'יפו', '97', 1000], ['תל אביב - יפו', 'דיזנגוף', '100', 1000],
  ['חיפה', 'מוריה', '', 1500], ['באר שבע', 'רגר יצחק', '', 1500], ['בני ברק', 'רבי עקיבא', '100', 1000],
];
for (const [loc, street, house, maxM] of cases) {
  if (await p.locator('#results-h').count()) await p.getByRole('button', { name: 'ניקוי החיפוש' }).click();
  await p.locator('#f-locality').selectOption({ label: loc });
  await p.locator('#f-street').fill(street.slice(0, -1));
  await p.locator('.suggestion', { hasText: new RegExp(`(^| )${street}$`) }).first().click({ timeout: 10000 });
  if (house) await p.locator('#f-house').fill(house);
  await p.locator('#search-submit').click();
  await p.locator('#results-h').waitFor({ timeout: 10000 });
  const cards = await p.locator('.cards > li').count();
  const first = await p.locator('.card').first().innerText();
  const name = await p.locator('.card h3').first().innerText();
  const m = /כ־([\d.,]+)\s*(מטר|ק"מ|ק״מ)/.exec(first);
  const meters = m ? Number(m[1].replace(',', '.')) * (m[2] === 'מטר' ? 1 : 1000) : Infinity;
  ok(cards >= 1 && meters <= maxM, `${loc} · ${street} ${house}: ${cards} places, nearest ≈ ${meters} m — ${name}`);
}
ok(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ''}`);
await b.close();
const out = lines.join('\n');
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Live site check\n\n${lines.join('\n\n')}\n`);
if (fails.length) process.exit(1);

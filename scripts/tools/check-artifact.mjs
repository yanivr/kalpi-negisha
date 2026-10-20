// Deep check of the hosted build under hostile conditions: /data/* is refused (403), page runs inside a sandboxed iframe.
import { chromium } from '/home/claude/kalpi-negisha/node_modules/playwright/index.mjs';
import AxeBuilder from '/home/claude/kalpi-negisha/node_modules/@axe-core/playwright/dist/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = '/home/claude/kalpi-negisha/dist-artifact';
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2', '.woff':'font/woff' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/host') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end('<!doctype html><title>host</title><iframe id="f" src="/" sandbox="allow-scripts allow-same-origin allow-popups" style="width:400px;height:900px"></iframe>'); }
  if (p.startsWith('/data/')) { r.writeHead(403); return r.end('denied'); }
  if (p === '/') p = process.env.PAGE || '/_wrapped.html';
  const f = path.join(root, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(4181);
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox','--no-zygote'] });
const results = []; const errors = [];
const page = await b.newPage({ viewport: { width: 420, height: 950 } });
page.on('pageerror', e => errors.push('pageerror ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console ' + m.text()); });
await page.goto('http://127.0.0.1:4181/host');
const fr = page.frameLocator('#f');
async function search(name) {
  await fr.locator('#f-locality').selectOption({ label: name });
  await fr.locator('#search-submit').click();
  await fr.locator('#results-h').waitFor();
  const cards = await fr.locator('.cards > li').count();
  const text = await fr.locator('.results').innerText();
  return { cards, text };
}
await fr.locator('#f-locality').waitFor({ timeout: 20000 });
results.push(['localities in list', await fr.locator('#f-locality option').count() - 1]);
let r = await search('רחובות'); results.push(['רחובות cards', r.cards]);
const links = await fr.locator('.card a[target=_blank]').evaluateAll(as => as.map(a => a.href));
results.push(['nav links ok', links.length > 0 && links.every(h => /^https:\/\/(waze\.com|www\.google\.com)\//.test(h))]);
await fr.getByRole('button', { name: 'שינוי כתובת' }).click();
r = await search('ירושלים'); results.push(['ירושלים cards', r.cards]);
await fr.locator('#f-filter').fill('שחר');
results.push(['ירושלים filter "שחר"', await fr.locator('.cards > li').count(), await fr.locator('#f-filter-count').innerText()]);
await fr.getByRole('button', { name: 'שינוי כתובת' }).click();
r = await search('אביגיל'); results.push(['אביגיל (no special) nearby', r.cards, r.text.includes('אין קלפי נגישה מיוחדת')]);
await fr.getByRole('button', { name: 'שינוי כתובת' }).click();
r = await search('חיפה'); results.push(['חיפה cards', r.cards, 'address-search links', await fr.locator('.card a[href*="/maps/search/"]').count()]);
await fr.getByRole('button', { name: 'שינוי כתובת' }).click();
r = await search('אשדוד'); results.push(['אשדוד institutions note', r.text.includes('בתי אבות')]);
await fr.locator('details.rules summary').click();
results.push(['rule points shown', await fr.locator('.rules-body li').count()]);
for (const [name, h] of [['العربية','النتائج'], ['Русский','Результаты'], ['አማርኛ','ውጤቶች'], ['עברית','תוצאות']]) {
  await fr.getByRole('link', { name }).click();
  results.push([name, (await fr.locator('#results-h').innerText()) === h, await fr.locator('.cards > li').count(), await fr.locator('.rules-body li').count()]);
}
for (const v of ['מקורות ומצב עדכון', 'פרטיות', 'הצהרת נגישות']) {
  await fr.getByRole('link', { name: v }).click();
  await fr.locator('h1').waitFor();
  results.push([v, await fr.locator('h1').innerText()]);
  if (v === 'מקורות ומצב עדכון') results.push(['sources status', (await fr.locator('.facts').innerText()).slice(0, 200).replace(/\n/g, ' | ')]);
}
const ctx2 = await b.newContext(); const p2 = await ctx2.newPage(); await p2.goto('http://127.0.0.1:4181/'); await p2.locator('#f-locality').selectOption({ label: 'ירושלים' }); await p2.locator('#search-submit').click(); await p2.locator('#results-h').waitFor();
const axe = await new AxeBuilder({ page: p2 }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze().catch(e => ({ violations: [{ id: 'axe-error ' + e.message }] }));
results.push(['axe violations (frame)', axe.violations.map(v => v.id)]);
console.log(JSON.stringify(results, null, 1));
console.log('errors', JSON.stringify(errors));
await b.close(); srv.close();

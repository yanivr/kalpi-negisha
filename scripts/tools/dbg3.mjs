import { chromium } from '/home/claude/kalpi-negisha/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox','--no-zygote'] });
const p = await b.newPage({ viewport: { width: 320, height: 640 } });
for (const l of ['am','he','ru','ar']) {
await p.goto(`http://127.0.0.1:4174/${l}/`);
await p.evaluate(() => document.documentElement.style.setProperty('font-size', '250%', 'important'));
await p.locator('#f-locality').selectOption({ label: 'בדיקה-א' });
await p.locator('form.search button[type=submit]').click();
await p.waitForTimeout(500);
console.log(l, await p.evaluate(() => {
  const w = window.innerWidth; const out = [];
  for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.right > w + 1 || r.left < -1) out.push(`${el.tagName}.${el.className} [${Math.round(r.left)},${Math.round(r.right)}] ${el.textContent.slice(0,40)}`); }
  return [document.documentElement.scrollWidth - w, ...out.slice(0, 8)];
}));
}
await b.close();

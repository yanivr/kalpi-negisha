import { chromium } from '/home/claude/kalpi-negisha/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = '/home/claude/kalpi-negisha/dist-artifact';
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/host') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end('<iframe id="f" src="/" sandbox="allow-scripts allow-same-origin" style="width:400px;height:900px"></iframe>'); }
  if (p.startsWith('/data/')) { r.writeHead(403); return r.end(); }
  if (p === '/') p = '/_wrapped.html'; const f = path.join(root, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(4182);
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox','--no-zygote'] });
const page = await b.newPage();
page.on('pageerror', e => console.log('pageerror', e.message)); page.on('console', m => console.log('console', m.type(), m.text()));
await page.goto('http://127.0.0.1:4182/host');
const fr = page.frameLocator('#f');
await fr.locator('#f-locality').waitFor({ timeout: 20000 });
await fr.locator('#f-locality').selectOption({ label: 'רחובות' });
console.log('value', await fr.locator('#f-locality').inputValue());
await fr.locator('form.search button[type=submit]').click();
await page.waitForTimeout(2000);
console.log((await fr.locator('main').innerText()).slice(0, 800));
await b.close(); srv.close();

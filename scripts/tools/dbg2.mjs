import { chromium } from '/home/claude/kalpi-negisha/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox','--no-zygote'] });
const p = await b.newPage();
p.on('request', r => console.log('req', r.url()));
await p.goto('http://127.0.0.1:4174/he/');
await p.waitForTimeout(3000);
console.log(await p.evaluate(async () => {
  const m = await (await fetch('/data/manifest.json')).json();
  const r = await fetch('/data/' + m.datasetFile);
  const buf = await r.arrayBuffer();
  const d = await crypto.subtle.digest('SHA-256', buf);
  return JSON.stringify({ status: m.status, file: m.datasetFile, ct: r.headers.get('content-type'), len: buf.byteLength, hash: [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('') === m.datasetSha256, rules: m.localeRuleVersions });
}));
await b.close();

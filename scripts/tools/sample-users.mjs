// Runs sample user searches on a built site and records exactly what each card shows.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const base = (process.env.BASE || 'http://127.0.0.1:4195/kalpi-negisha/').replace(/\/?$/, '/');
const users = JSON.parse(process.argv[2]);
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const out = [];
for (const u of users) {
  await p.goto(`${base}he/`);
  await p.locator('#f-locality').waitFor();
  await p.locator('#f-locality').pressSequentially(u.typedLocality);
  if (await p.locator('#locality-suggestions').count()) await p.locator('#locality-suggestions .suggestion', { hasText: new RegExp(`^${u.locality}$`) }).first().click();
  await p.locator('#f-street').pressSequentially(u.typedStreet);
  await p.locator('#street-suggestions .suggestion', { hasText: new RegExp(`^${u.street}$`) }).first().click();
  if (u.house) await p.locator('#f-house').fill(u.house);
  await p.locator('#search-submit').click();
  await p.locator('#results-h').waitFor();
  const cards = await p.locator('.cards > li .card').evaluateAll((cs) => cs.map((c) => ({
    label: c.querySelector('.card-label')?.textContent?.trim() ?? null,
    name: c.querySelector('h3')?.textContent?.trim(),
    address: c.querySelector('.address')?.textContent?.trim(),
    special: [...c.querySelectorAll('.kind-special .num')].map((x) => x.textContent.trim()),
    regular: [...c.querySelectorAll('.kind-regular .num')].map((x) => x.textContent.trim()),
    instructions: [...c.querySelectorAll('.instructions li')].map((x) => x.textContent.trim()),
    distance: [...c.querySelectorAll('p')].map((x) => x.textContent).find((x) => x.includes('מרחק')) ?? null,
    nav: [...c.querySelectorAll('a[target=_blank]')].map((a) => a.href),
  })));
  const notes = await p.locator('.results .note').allInnerTexts();
  out.push({ user: u, searched: await p.locator('.searched').innerText(), notes: notes.filter((n) => !n.startsWith('הניווט')), cards });
}
await b.close();
writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
for (const r of out) {
  console.log(`\n=== ${r.user.id}: ${r.searched}`);
  for (const n of r.notes) console.log('  note:', n);
  for (const c of r.cards) console.log(`  [${c.label}] ${c.name} | ${c.address} | special=${c.special.join(',')} regular=${c.regular.join(',') || '-'} | ${c.distance} | instr=${c.instructions.join(' / ') || '-'}`);
}

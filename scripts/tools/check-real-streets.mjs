// Real-data check: type real addresses, verify the top result is near the address.
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:4190/he/';
const cases = [
  ['רחובות', 'הרצל', '150'], ['רחובות', 'הרצל', ''], ['רחובות', 'ביל"ו', '5'], ['ירושלים', 'יפו', '97'],
  ['ירושלים', 'הרצל', '100'], ['תל אביב - יפו', 'דיזנגוף', '100'], ['חיפה', 'מוריה', '50'], ['באר שבע', 'רגר יצחק', ''],
  ['אשדוד', 'הרצל', '10'], ['נתניה', 'ויצמן', '20'], ['בני ברק', 'רבי עקיבא', '100'], ['אום אל-פחם', '', ''],
];
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox', '--no-zygote'] });
const p = await b.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(base);
await p.locator('#f-locality').waitFor();
for (const [loc, street, house] of cases) {
  if (await p.locator('#results-h').count()) await p.getByRole('button', { name: 'ניקוי החיפוש' }).click();
  await p.locator('#f-locality').selectOption({ label: loc });
  if (street) {
    await p.locator('#f-street').fill(street.slice(0, -1));
    await p.waitForTimeout(150);
    const sugg = await p.locator('.suggestion').allInnerTexts();
    const pick = sugg.find((s) => s === street) ?? null;
    if (pick) await p.locator('.suggestion', { hasText: new RegExp(`^${pick.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&')}$`) }).first().click();
    else await p.locator('#f-street').fill(street);
  }
  if (house) await p.locator('#f-house').fill(house);
  await p.locator('#search-submit').click();
  await p.waitForTimeout(300);
  const err = await p.locator('.error-summary').count();
  if (err) { console.log(loc, street, house, 'ERROR', await p.locator('.error-summary').innerText()); continue; }
  await p.locator('#results-h').waitFor();
  const label = await p.locator('.card-label').first().innerText().catch(() => '-');
  const cards = await p.locator('.cards > li').count();
  const first = await p.locator('.card').first().innerText().catch(() => '');
  const dist = (first.match(/(מרחק[^\n]*)/) || [])[1] || '-';
  const notes = await p.locator('.results .note, .results .notice').allInnerTexts();
  console.log(`${loc} | ${street} ${house} | cards=${cards} | ${label} | ${first.split('\n')[1] ?? ''} ${first.split('\n')[2] ?? ''} | ${dist} | ${notes.join(' / ').slice(0, 120)}`);
}
console.log('errors', JSON.stringify(errors));
await b.close();

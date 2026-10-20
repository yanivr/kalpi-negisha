/**
 * After `vite build`: emits one static HTML entry per language and per info page (spec §18),
 * so direct links like /am/ or /ru/privacy/ work on GitHub Pages without server rewrites,
 * and each page has the correct lang/dir/title and a working no-JavaScript fallback.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DICTS, LOCALES } from '../src/i18n';

const DIST = path.resolve(process.argv[2] ?? 'dist');
const VIEWS = ['', 'sources/', 'privacy/', 'accessibility/'] as const;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const he = DICTS.he;
const template = await readFile(path.join(DIST, 'index.html'), 'utf8');

function localise(html: string, l: (typeof LOCALES)[number]): string {
  const t = DICTS[l];
  let out = html
    .replace('<html lang="he-IL" dir="rtl">', `<html lang="${t.htmlLang}" dir="${t.dir}">`)
    .replace(`<title>${esc(he.docTitle)}</title>`, `<title>${esc(t.docTitle)}</title>`)
    .replace(`content="${esc(he.intro)}"`, `content="${esc(t.intro)}"`);
  const pairs: Array<[string, string]> = [
    [he.h1, t.h1],
    [he.intro, t.intro],
    [he.noscript, t.noscript],
    [he.officialListLink, t.officialListLink],
    [he.officialInfoLink, t.officialInfoLink],
  ];
  for (const [a, b] of pairs) out = out.replace(`>${esc(a)}<`, `>${esc(b)}<`);
  const alternates = LOCALES.map((x) => `<link rel="alternate" hreflang="${DICTS[x].htmlLang}" href="${process.env.BASE_PATH ?? '/'}${x}/" />`).join('\n    ');
  return out.replace('</head>', `    ${alternates}\n  </head>`);
}

// Sanity: placeholders were replaced in the Vite template.
for (const needle of [he.h1, he.noscript]) {
  if (!template.includes(esc(needle))) throw new Error(`template missing expected text: ${needle}`);
}

for (const l of LOCALES) {
  const html = localise(template, l);
  for (const v of VIEWS) {
    const dir = path.join(DIST, l, v);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), html);
  }
}
await writeFile(path.join(DIST, 'index.html'), localise(template, 'he'));
await writeFile(path.join(DIST, '404.html'), localise(template, 'he'));
await writeFile(path.join(DIST, '.nojekyll'), '');
console.log(`static entries written for ${LOCALES.join(', ')}`);

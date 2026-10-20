/**
 * Fails the build if the shipped bundle contains persistent storage, tracking or unexpected external endpoints
 * (spec §11). This is a static guard; runtime behaviour is covered by the e2e privacy test.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve(process.argv[2] ?? 'dist');
const files: string[] = [];
async function walk(d: string) {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) await walk(p);
    else if (/\.(js|html)$/.test(e.name)) files.push(p);
  }
}
await walk(dist);

const forbidden: Array<[RegExp, string]> = [
  [/\blocalStorage\b/, 'localStorage'],
  [/\bsessionStorage\b/, 'sessionStorage'],
  [/\bindexedDB\.open\b/, 'IndexedDB'],
  [/document\.cookie\s*=/, 'cookie write'],
  [/serviceWorker\.register/, 'service worker'],
  [/google-analytics|googletagmanager|gtag\(|hotjar|sentry|facebook\.net|clarity\.ms/i, 'tracking'],
  [/dangerouslySetInnerHTML:\s*\{/, 'raw HTML injection'],
];
const allowedHosts = new Set(['waze.com', 'www.google.com', 'www.gov.il', 'react.dev', 'www.w3.org', 'reactjs.org', 'json-schema.org' /* identifier string inside zod, never fetched */]);
const problems: string[] = [];
for (const f of files) {
  const s = await readFile(f, 'utf8');
  for (const [re, name] of forbidden) if (re.test(s)) problems.push(`${path.relative(dist, f)}: ${name}`);
  for (const m of s.matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
    if (!allowedHosts.has(m[1]!.toLowerCase())) problems.push(`${path.relative(dist, f)}: unexpected host ${m[1]}`);
  }
}
if (problems.length) {
  console.error('bundle privacy check failed:\n- ' + [...new Set(problems)].join('\n- '));
  process.exit(1);
}
console.log(`bundle privacy check passed (${files.length} files)`);

/**
 * Builds a hosted-artifact variant of the site (relative paths, in-memory routing, no own CSP — the host enforces its own).
 * Output: dist-artifact/ with index.html as a body fragment, plus assets/ and data/.
 */
import { execSync } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import he from '../src/i18n/he';

execSync('npx vite build --outDir dist-artifact --emptyOutDir', {
  stdio: 'inherit',
  env: { ...process.env, BASE_PATH: './', VITE_ROUTER: 'memory' },
});
const html = await readFile('dist-artifact/index.html', 'utf8');
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]!.replace(/^\.\//, ''));
const js = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]!.replace(/^\.\//, ''));
if (!css.length || !js.length) throw new Error('could not find built assets in index.html');
const noscript = /<noscript>[\s\S]*<\/noscript>/.exec(html)![0];
// Embed the release files (exact bytes, base64) so the page never depends on separate data requests in the host sandbox.
const files: Record<string, string> = {};
for (const f of (await readdir('dist-artifact/data', { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name)) files[f] = (await readFile(`dist-artifact/data/${f}`)).toString('base64');
if (!files['manifest.json']) throw new Error('release missing: run build-release first');
const embedded = JSON.stringify({ files });
// Street index: every locality's file in one gzip blob (decompressed in the page on first street search).
const geoAll: Record<string, unknown> = {};
for (const f of await readdir('dist-artifact/data/geo').catch(() => [] as string[])) {
  if (f.endsWith('.json')) geoAll[f.slice(0, -5)] = JSON.parse(await readFile(`dist-artifact/data/geo/${f}`, 'utf8'));
}
if (Object.keys(geoAll).length < 1000) throw new Error(`street index missing or partial (${Object.keys(geoAll).length} localities)`);
const geoBlob = gzipSync(Buffer.from(JSON.stringify(geoAll)), { level: 9 }).toString('base64');
await rm('dist-artifact/data/geo', { recursive: true });
const fragment = `<title>קלפי נגישה מיוחדת</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="${he.intro.replace(/"/g, '&quot;')}">
${css.map((c) => `<link rel="stylesheet" href="${c}">`).join('\n')}
<div id="root">
${noscript}
</div>
<script type="application/json" id="kalpi-embedded-data">${embedded}</script>
<script type="application/json" id="kalpi-embedded-geo">${geoBlob}</script>
${js.map((j) => `<script type="module" src="${j}"></script>`).join('\n')}
`;
await writeFile('dist-artifact/index.html', fragment);
console.log('artifact build ready:', { css, js, embedded: Object.keys(files), bytes: embedded.length, geoLocalities: Object.keys(geoAll).length, geoBytes: geoBlob.length });

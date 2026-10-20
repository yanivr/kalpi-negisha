/**
 * Builds a hosted-artifact variant of the site (relative paths, in-memory routing, no own CSP — the host enforces its own).
 * Output: dist-artifact/ with index.html as a body fragment, plus assets/ and data/.
 */
import { execSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
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
for (const f of await readdir('dist-artifact/data')) files[f] = (await readFile(`dist-artifact/data/${f}`)).toString('base64');
if (!files['manifest.json']) throw new Error('release missing: run build-release first');
const embedded = JSON.stringify({ files });
const fragment = `<title>קלפי נגישה מיוחדת</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="${he.intro.replace(/"/g, '&quot;')}">
${css.map((c) => `<link rel="stylesheet" href="${c}">`).join('\n')}
<div id="root">
${noscript}
</div>
<script type="application/json" id="kalpi-embedded-data">${embedded}</script>
${js.map((j) => `<script type="module" src="${j}"></script>`).join('\n')}
`;
await writeFile('dist-artifact/index.html', fragment);
console.log('artifact build ready:', { css, js, embedded: Object.keys(files), bytes: embedded.length });

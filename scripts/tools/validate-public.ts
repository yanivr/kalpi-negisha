import { readFileSync, readdirSync } from 'node:fs';
import { Dataset, ReleaseManifest } from '../../src/domain/schema';
const dir = process.argv[2] ?? 'public/data';
const m = ReleaseManifest.safeParse(JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8')));
console.log('manifest ok', m.success, m.success ? '' : JSON.stringify(m.error.issues.slice(0, 5)));
const f = readdirSync(dir).find((x) => x.startsWith('dataset-'))!;
const d = Dataset.safeParse(JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
console.log('dataset ok', d.success, d.success ? d.data.releaseId : JSON.stringify(d.error.issues.slice(0, 5)));
if (m.success) console.log('manifest releaseId', m.data.releaseId);

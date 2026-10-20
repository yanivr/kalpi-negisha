import ExcelJS from 'exceljs';
import fs from 'node:fs';
const [inp, out] = process.argv.slice(2);
const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(inp);
const ws = wb.worksheets[0];
const header = ws.getRow(1).values.slice(1).map(v => String(v).trim());
const rows = [];
for (let r = 2; r <= ws.rowCount; r++) {
  const v = ws.getRow(r).values.slice(1);
  const o = {}; header.forEach((h, i) => { let x = v[i]; if (x && typeof x === 'object' && 'result' in x) x = x.result; if (x && typeof x === 'object' && 'richText' in x) x = x.richText.map(t=>t.text).join(''); o[h] = x ?? null; });
  rows.push(o);
}
fs.writeFileSync(out, JSON.stringify({header, rows}));
console.log(inp.split('/').pop(), rows.length);

import ExcelJS from 'exceljs';
const files = process.argv.slice(2);
for (const f of files) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(f);
  console.log('=====', f.split('/').pop());
  console.log('props', JSON.stringify({title: wb.title, creator: wb.creator, created: wb.created, modified: wb.modified, lastModifiedBy: wb.lastModifiedBy}));
  wb.eachSheet(ws => {
    console.log('--- sheet', ws.name, 'rows', ws.rowCount, 'cols', ws.columnCount);
    for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const vals = [];
      row.eachCell({includeEmpty: true}, c => vals.push(typeof c.value === 'object' && c.value ? JSON.stringify(c.value).slice(0,80) : c.value));
      console.log(r, JSON.stringify(vals));
    }
    console.log('last', JSON.stringify(ws.getRow(ws.rowCount).values));
  });
}

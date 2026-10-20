/**
 * SYNTHETIC official-format workbooks for ingestion tests. NOT real data.
 * Two localities, a handful of compounds, layout identical to the CEC exports.
 */
import ExcelJS from 'exceljs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HEADERS, type SourceFile } from '../../scripts/sources/cec-k26';

const END = 'סיום מידע טבלה צד שמאל';
const FOOT = 'סיום מידע טבלה';

export interface FixtureStation {
  committee: number;
  locality: number;
  localityName: string;
  number: number | string;
  compound: number;
  address: string;
  place: string;
  accessible: boolean;
  special: boolean;
  voters: number;
  instructions?: string | null;
}
export interface FixtureCompound {
  committee: number;
  locality: number;
  localityName: string;
  compound: number;
  address: string;
  place: string;
  placeType: string;
  x: number;
  y: number;
}

export function defaultFixture(): { stations: FixtureStation[]; compounds: FixtureCompound[] } {
  const compounds: FixtureCompound[] = [
    { committee: 1, locality: 9001, localityName: 'בדיקה-א', compound: 1, address: 'הבדיקה,1 ', place: 'בי"ס בדיקה', placeType: 'בית ספר ממלכתי', x: 182000, y: 645000 },
    { committee: 1, locality: 9001, localityName: 'בדיקה-א', compound: 2, address: 'הניסוי,2 ', place: 'מתנ"ס בדיקה', placeType: 'מרכז קהילתי', x: 182500, y: 645500 },
    { committee: 1, locality: 9001, localityName: 'בדיקה-א', compound: 3, address: 'הזקנים,3 ', place: 'בית אבות בדיקה', placeType: 'בית אבות', x: 183000, y: 646000 },
    { committee: 2, locality: 9002, localityName: 'בדיקה-ב', compound: 1, address: 'הכפר,4 ', place: 'מועדון בדיקה', placeType: 'בית תרבות/מועדון', x: 0, y: 0 },
    { committee: 2, locality: 9003, localityName: 'בדיקה-ג', compound: 1, address: 'השדה,5 ', place: 'גן בדיקה', placeType: 'גן ילדים עירוני', x: 184000, y: 647000 },
  ];
  const s = (c: FixtureCompound, number: number | string, accessible: boolean, special: boolean, instructions: string | null = null): FixtureStation => ({
    committee: c.committee, locality: c.locality, localityName: c.localityName, number, compound: c.compound,
    address: c.address, place: c.place, accessible, special, voters: 500, instructions,
  });
  const [a, b, c, d, e] = compounds as [FixtureCompound, FixtureCompound, FixtureCompound, FixtureCompound, FixtureCompound];
  return {
    compounds,
    stations: [
      s(a, 1, true, true, 'כניסה לבדיקה משער צדדי'),
      s(a, 2, true, false),
      s(a, 3, false, false),
      s(b, 4.1, true, true),
      s(b, 4.2, true, true),
      s(c, 5, true, true),
      s(d, 1, true, true),
      s(e, 1, false, false),
    ],
  };
}

async function writeBook(file: string, title: string, header: readonly string[], rows: Array<Array<string | number | null>>, footer = true) {
  const wb = new ExcelJS.Workbook();
  wb.title = title;
  wb.created = new Date('2026-09-08T09:00:00Z');
  const ws = wb.addWorksheet('DataSheet');
  ws.addRow([...header]);
  for (const r of rows) ws.addRow([...r, END]);
  if (footer) ws.addRow([null, ...header.slice(1, -1).map(() => FOOT), END]);
  await wb.xlsx.writeFile(file);
}

export async function writeFixture(
  opts: {
    stations?: FixtureStation[];
    compounds?: FixtureCompound[];
    /** Override national totals in report 137 to simulate a truncated or inconsistent export. */
    total137Delta?: { stations?: number; special?: number };
    compoundSpecialOverride?: Record<string, number>;
  } = {},
): Promise<SourceFile[]> {
  const def = defaultFixture();
  const stations = opts.stations ?? def.stations;
  const compounds = opts.compounds ?? def.compounds;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cec-fixture-'));
  const yes = (b: boolean) => (b ? 'כ' : ' ');

  const p = (n: string) => path.join(dir, n);
  await writeBook(p('stations.xlsx'), 'קובץ קלפיות סופי', HEADERS.stations,
    stations.map((s, i) => [i + 1, s.committee, `ועדה ${s.committee}`, s.locality, s.localityName, s.number, s.compound, s.address, s.place, yes(s.accessible), yes(s.special), ' ', s.voters]));
  await writeBook(p('r104.xlsx'), 'דוח 104 קלפיות למוגבלי ניידות', HEADERS.report104,
    stations.filter((s) => s.accessible).map((s) => [s.committee, `ועדה ${s.committee}`, s.locality, s.localityName, s.number, s.compound, s.address, s.place, yes(s.special), s.instructions ?? ' ', s.voters]));
  const concRows = compounds.map((c) => {
    const mine = stations.filter((s) => s.locality === c.locality && s.compound === c.compound);
    const key = `${c.locality}#${c.compound}`;
    return [c.committee, `ועדה ${c.committee}`, 0, null, c.locality, c.localityName, 1, 'גוש', c.compound, mine.length, c.address, c.place, c.placeType,
      mine.reduce((a, s) => a + s.voters, 0), c.x, c.y, mine.filter((s) => s.accessible).length, opts.compoundSpecialOverride?.[key] ?? mine.filter((s) => s.special).length];
  });
  concRows.push([null, null, null, null, null, null, null, null, null, stations.length, null, null, null, null, null, null, null, null]);
  await writeBook(p('conc.xlsx'), 'קובץ ריכוזים', HEADERS.concentrations, concRows);
  const committees = [...new Set(stations.map((s) => s.committee))];
  const r137: Array<Array<string | number | null>> = committees.map((c) => {
    const mine = stations.filter((s) => s.committee === c);
    return [c, `ועדה ${c}`, mine.reduce((a, s) => a + s.voters, 0), new Set(mine.map((s) => s.locality)).size,
      compounds.filter((x) => x.committee === c).length, mine.length, mine.filter((s) => s.accessible).length, mine.filter((s) => s.special).length];
  });
  const sum = (i: number) => r137.reduce((a, r) => a + (r[i] as number), 0);
  r137.push([null, null, sum(2), sum(3), sum(4), sum(5) + (opts.total137Delta?.stations ?? 0), sum(6), sum(7) + (opts.total137Delta?.special ?? 0)]);
  await writeBook(p('r137.xlsx'), "דוח 137 טופס ב' סופי", HEADERS.report137, r137);

  return [
    { role: 'stations', path: p('stations.xlsx'), sourceId: 'fx-stations', url: null },
    { role: 'report104', path: p('r104.xlsx'), sourceId: 'fx-104', url: null },
    { role: 'concentrations', path: p('conc.xlsx'), sourceId: 'fx-conc', url: null },
    { role: 'report137', path: p('r137.xlsx'), sourceId: 'fx-137', url: null },
  ];
}

export async function writeHtmlAsXlsx(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cec-html-'));
  const f = path.join(dir, 'blocked.xlsx');
  await writeFile(f, '<!DOCTYPE html><html><body>Access denied</body></html>');
  return f;
}

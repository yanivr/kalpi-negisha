import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { ingestCecK26, normaliseStationNumber, type SourceFile } from '../../scripts/sources/cec-k26';
import { defaultFixture, writeFixture, writeHtmlAsXlsx } from '../fixtures/cec-fixture';

const NOW = '2026-10-20T10:00:00Z';
const site = (r: Awaited<ReturnType<typeof ingestCecK26>>, id: string) => r.sites.find((s) => s.siteId === id)!;

describe('station number normalisation', () => {
  it('keeps official numbers as strings without inventing digits', () => {
    expect(normaliseStationNumber(576)).toBe('576');
    expect(normaliseStationNumber(576.1)).toBe('576.1');
    expect(normaliseStationNumber(11.9)).toBe('11.9');
    expect(normaliseStationNumber('12.1')).toBe('12.1');
    expect(normaliseStationNumber(12.15)).toBeNull(); // unknown format → quarantine, never guessed
    expect(normaliseStationNumber(0)).toBeNull();
    expect(normaliseStationNumber(null)).toBeNull();
  });
});

describe('CEC adapter on synthetic official-format files', () => {
  it('ingests a consistent export and maps every field explicitly', async () => {
    const r = await ingestCecK26(await writeFixture(), NOW);
    expect(r.fatal).toEqual([]);
    expect(r.report.totals).toMatchObject({ stations: 8, accessibleStations: 6, specialStations: 5 });
    const a = site(r, 'k26-9001-1');
    expect(a.stations.find((s) => s.officialNumber === '1')).toMatchObject({ kind: 'accessible_special', accessInstructions: 'כניסה לבדיקה משער צדדי' });
    expect(a.stations.find((s) => s.officialNumber === '2')!.kind).toBe('accessible_assigned');
    expect(a.stations.find((s) => s.officialNumber === '3')!.kind).toBe('other');
    expect(a.address).toMatchObject({ street: 'הבדיקה', house: '1' });
    expect(a.point).not.toBeNull();
    expect(a.point!.lat).toBeGreaterThan(29);
    expect(site(r, 'k26-9001-2').stations.map((s) => s.officialNumber)).toEqual(['4.1', '4.2']);
  });

  it('marks institutions (בית אבות) as public access unknown', async () => {
    const r = await ingestCecK26(await writeFixture(), NOW);
    expect(site(r, 'k26-9001-3').publicAccess).toEqual({ value: 'unknown', reason: 'institution-type:בית אבות' });
  });

  it('withholds the point when official X/Y is 0 and reports it', async () => {
    const r = await ingestCecK26(await writeFixture(), NOW);
    expect(site(r, 'k26-9002-1').point).toBeNull();
    expect(r.report.siteWarnings.some((w) => w.siteId === 'k26-9002-1')).toBe(true);
  });

  it('rejects an HTML block page served instead of the file (HTTP 200 with HTML)', async () => {
    const files = await writeFixture();
    files[0] = { ...files[0]!, path: await writeHtmlAsXlsx() };
    await expect(ingestCecK26(files, NOW)).rejects.toThrow(/not an XLSX file \(looks like an HTML page\)/);
  });

  it('rejects a file with a different column layout (e.g. the 2025 local-elections list)', async () => {
    const files = await writeFixture();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('x');
    ws.addRow(['שם רשות', 'שם קלפי', 'כתובת', 'נגישה']);
    ws.addRow(['בדיקה', '1', 'רחוב', 'כן']);
    const f = path.join(path.dirname(files[0]!.path), 'local2025.xlsx');
    await wb.xlsx.writeFile(f);
    files[0] = { ...files[0]!, path: f };
    await expect(ingestCecK26(files, NOW)).rejects.toThrow(/unrecognised column layout/);
  });

  it('fails when national totals do not match (truncated export / missing page)', async () => {
    const r = await ingestCecK26(await writeFixture({ total137Delta: { stations: 1 } }), NOW);
    expect(r.fatal.some((f) => f.startsWith('stations.total-vs-137'))).toBe(true);
  });

  it('fails when a whole regional committee disappears', async () => {
    const def = defaultFixture();
    // Drop committee 2 from the station file only; report 137 is built from the full list.
    const files = await writeFixture();
    const partial = await writeFixture({ stations: def.stations.filter((s) => s.committee !== 2), compounds: def.compounds });
    const mixed: SourceFile[] = [partial[0]!, files[1]!, files[2]!, files[3]!];
    const r = await ingestCecK26(mixed, NOW);
    expect(r.fatal.length).toBeGreaterThan(0);
  });

  it('quarantines an unknown flag value instead of guessing', async () => {
    const def = defaultFixture();
    const files = await writeFixture(def);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(files[0]!.path);
    wb.worksheets[0]!.getRow(2).getCell(11).value = 'אולי';
    await wb.xlsx.writeFile(files[0]!.path);
    const r = await ingestCecK26(files, NOW);
    expect(r.report.quarantined.some((q) => /unrecognised accessibility flag/.test(q.reason))).toBe(true);
    expect(r.fatal.length).toBeGreaterThan(0);
  });

  it('blocks a compound whose special-station count disagrees between files', async () => {
    const r = await ingestCecK26(await writeFixture({ compoundSpecialOverride: { '9001#2': 3 } }), NOW);
    expect(site(r, 'k26-9001-2').blockedReasons[0]).toMatch(/conflict:compound-special-count/);
  });

  it('detects duplicate station keys', async () => {
    const def = defaultFixture();
    def.stations.push({ ...def.stations[0]! });
    const r = await ingestCecK26(await writeFixture(def), NOW);
    expect(r.fatal.some((f) => f.includes('duplicate station key'))).toBe(true);
  });
});

/** Runs against the real official files when KALPI_SOURCE_DIR points at them (not committed — rights not verified). */
const SRC = process.env.KALPI_SOURCE_DIR;
const real = SRC && existsSync(SRC) ? describe : describe.skip;
real('real CEC files (local only)', () => {
  it('reconciles with the official national totals', async () => {
    const f = (glob: string) => path.join(SRC!, glob);
    const files: SourceFile[] = [
      { role: 'stations', path: f(process.env.KALPI_STATIONS!), sourceId: 's', url: null },
      { role: 'report104', path: f(process.env.KALPI_R104!), sourceId: 'r104', url: null },
      { role: 'concentrations', path: f(process.env.KALPI_CONC!), sourceId: 'c', url: null },
      { role: 'report137', path: f(process.env.KALPI_R137!), sourceId: 'r137', url: null },
    ];
    const r = await ingestCecK26(files, NOW);
    expect(r.fatal).toEqual([]);
    expect(r.report.totals).toMatchObject({ stations: 12018, accessibleStations: 6208, specialStations: 3620, voters: 7331981, compounds: 4399 });
  });
});

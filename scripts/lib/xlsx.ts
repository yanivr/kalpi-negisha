import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export type Cell = string | number | null;
export interface Sheet {
  sheetName: string;
  header: string[];
  /** Data rows only (footer/total marker rows removed), keyed by header. */
  rows: Array<Record<string, Cell>>;
  /** 1-based spreadsheet row number for each data row, for evidence locators. */
  rowNumbers: number[];
  /** Rows recognised as footer markers. */
  footerRows: number;
}
export interface Workbook {
  sha256: string;
  bytes: number;
  title: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  sheet: Sheet;
}

const FOOTER_MARKER = 'סיום מידע טבלה';
/** Trailing marker column present on every row of the official export. */
export const TRAILING_MARKER_COLUMN = 'סיום מידע טבלה צד שמאל';

export function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellValue(v.result as ExcelJS.CellValue);
    if ('text' in v && typeof v.text === 'string') return v.text;
  }
  throw new Error(`unsupported cell value ${JSON.stringify(v).slice(0, 80)}`);
}

/**
 * Reads the first worksheet of an official export. Rejects files whose bytes are not an XLSX container
 * (for example an HTML error/block page served with HTTP 200 — spec §14).
 */
export async function readOfficialWorkbook(path: string): Promise<Workbook> {
  const buf = await readFile(path);
  if (buf.subarray(0, 4).toString('hex') !== '504b0304') {
    const head = buf.subarray(0, 200).toString('utf8').toLowerCase();
    const hint = head.includes('<html') || head.includes('<!doctype') ? ' (looks like an HTML page)' : '';
    throw new Error(`${path}: not an XLSX file${hint}`);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error(`${path}: workbook has no worksheets`);

  const header = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((v) => String(cellValue(v) ?? '').trim());
  const rows: Array<Record<string, Cell>> = [];
  const rowNumbers: number[] = [];
  let footerRows = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const values = (ws.getRow(r).values as ExcelJS.CellValue[]).slice(1).map(cellValue);
    const isFooter = values.some(
      (v, i) => typeof v === 'string' && v.startsWith(FOOTER_MARKER) && header[i] !== TRAILING_MARKER_COLUMN,
    );
    if (isFooter) {
      footerRows++;
      continue;
    }
    if (values.every((v) => v === null || (typeof v === 'string' && v.trim() === ''))) continue;
    const obj: Record<string, Cell> = {};
    header.forEach((h, i) => (obj[h] = values[i] ?? null));
    rows.push(obj);
    rowNumbers.push(r);
  }
  return {
    sha256: sha256(buf),
    bytes: buf.length,
    title: wb.title || null,
    createdAt: wb.created ? new Date(wb.created).toISOString() : null,
    modifiedAt: wb.modified ? new Date(wb.modified).toISOString() : null,
    sheet: { sheetName: ws.name, header, rows, rowNumbers, footerRows },
  };
}

export function assertHeader(file: string, actual: string[], expected: readonly string[]): void {
  const a = actual.join('|');
  const e = expected.join('|');
  if (a !== e) throw new Error(`${file}: unrecognised column layout.\n  expected: ${e}\n  actual:   ${a}`);
}

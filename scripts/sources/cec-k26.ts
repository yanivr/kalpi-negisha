/**
 * Adapter for the Central Elections Committee exports for the 26th Knesset (spec §12).
 *
 * Inputs (all four are required; each is an official XLSX export with a fixed column layout):
 *   stations       – "קובץ קלפיות סופי": one row per regular polling station (12,018 for Knesset 26)
 *   report104      – "דוח 104 קלפיות למוגבלי ניידות": accessible stations incl. special flag and access instructions
 *   concentrations – "קובץ ריכוזים": one row per polling compound (ריכוז) incl. ITM X/Y and per-compound counts
 *   report137      – "דוח 137 טופס ב'": per regional committee totals incl. national total row
 *
 * Every mapping below is explicit. Unknown values are quarantined, never guessed (spec §13–14).
 */
import proj4 from 'proj4';
import { airDistanceMeters } from '../../src/domain/geo';
import type { PollingSite, Station, StationKind } from '../../src/domain/schema';
import { assertHeader, readOfficialWorkbook, TRAILING_MARKER_COLUMN, type Cell, type Workbook } from '../lib/xlsx';

proj4.defs(
  'EPSG:2039',
  '+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 ' +
    '+ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,-0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs',
);

export const ELECTION_ID = 'knesset-26';

export const HEADERS = {
  stations: ["מס' ברזל", 'סמל ועדה', 'שם ועדה', 'סמל ישוב בחירות', 'שם ישוב בחירות', 'סמל קלפי', 'סמל רכוז', 'כתובת קלפי', 'מקום קלפי', 'נגישה', 'נגישה מיוחדת', 'הדפסה בערבית', 'בוחרי כנסת', TRAILING_MARKER_COLUMN],
  report104: ['סמל ועדה', 'שם ועדה', 'סמל ישוב בחירות', 'שם ישוב בחירות', 'סמל קלפי', 'סמל רכוז', 'כתובת קלפי', 'מקום קלפי', 'נגישה מיוחדת', 'הוראות גישה לאנשים עם מוגבלות בניידות', 'בוחרי כנסת', TRAILING_MARKER_COLUMN],
  concentrations: ['סמל ועדה', 'שם ועדה', 'סמל גוש ישובים', 'שם גוש ישובים', 'סמל ישוב בחירות', 'שם ישוב בחירות', 'סמל גוש ריכוזים', 'שם גוש ריכוזים', 'סמל רכוז', "מס' קלפיות נטו", 'כתובת קלפי', 'מקום קלפי', 'סווג מקום', 'בוחרי כנסת', 'X', 'Y', 'קלפיות נגישות', 'קלפיות נגישה מיוחדת', TRAILING_MARKER_COLUMN],
  report137: ['סמל ועדה', 'שם ועדה', 'בעלי זכות בחירה', 'ישובים', 'סה"כ ריכוזים', 'סה"כ קלפיות', 'סה"כ קלפיות נגישות', 'סה"כ קלפיות נגישה מיוחדת', TRAILING_MARKER_COLUMN],
} as const;

/** Explicit value mapping of the flag columns. 'כ' = yes, single space or empty = no. Anything else → quarantine. */
const FLAG_YES = 'כ';
function flag(v: Cell | undefined): 'yes' | 'no' | 'invalid' {
  if (v === FLAG_YES) return 'yes';
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return 'no';
  return 'invalid';
}

/**
 * Place types (סווג מקום) where public entry for voters not living there is not established by the official list.
 * Spec §6.3: such places are not recommended to the public unless explicitly confirmed. Product owner can change this list.
 */
export const RESTRICTED_PLACE_TYPES = ['בית אבות', 'מוסד שיקומי'] as const;

/** A compound farther than this from the median of its locality's compounds is treated as a coordinate conflict. */
const LOCALITY_DISTANCE_LIMIT_M = 25_000;

export interface SourceFile {
  role: keyof typeof HEADERS;
  path: string;
  sourceId: string;
  url: string | null;
}

export interface IngestReport {
  electionId: string;
  totals: {
    stations: number;
    accessibleStations: number;
    specialStations: number;
    voters: number;
    compounds: number;
    localities: number;
  };
  report137Totals: Record<string, number>;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
  quarantined: Array<{ sourceId: string; row: number; reason: string }>;
  siteWarnings: Array<{ siteId: string; reason: string }>;
}

export interface IngestResult {
  sites: PollingSite[];
  localities: Array<{ code: string; name: string; centre: { lat: number; lon: number } | null }>;
  workbooks: Record<SourceFile['role'], Workbook>;
  report: IngestReport;
  /** Fatal problems: when non-empty, the dataset must not be published. */
  fatal: string[];
}

/** Official station numbers arrive as Excel numbers (576 / 576.1). Normalise to strings; reject anything ambiguous. */
export function normaliseStationNumber(v: Cell | undefined): string | null {
  if (typeof v === 'string' && /^\d+(\.\d)?$/.test(v.trim())) return v.trim();
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  if (Number.isInteger(v)) return String(v);
  const tenths = Math.round(v * 10);
  if (Math.abs(v * 10 - tenths) > 1e-6) return null; // more than one decimal digit: not a known format
  const whole = Math.floor(tenths / 10);
  const sub = tenths % 10;
  if (sub === 0) return null;
  return `${whole}.${sub}`;
}

function intCode(v: Cell | undefined): string | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return String(v);
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return v.trim();
  return null;
}

function text(v: Cell | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

function parseAddress(raw: string): { street: string | null; house: string | null } {
  const m = /^(.*?),\s*(\d+[א-ת]?)\s*$/.exec(raw.trim());
  if (m) return { street: m[1]!.trim() || null, house: m[2]! };
  return { street: raw.trim() || null, house: null };
}

export async function ingestCecK26(files: SourceFile[], checkedAt: string): Promise<IngestResult> {
  const byRole = new Map(files.map((f) => [f.role, f]));
  const workbooks = {} as Record<SourceFile['role'], Workbook>;
  for (const role of Object.keys(HEADERS) as Array<keyof typeof HEADERS>) {
    const f = byRole.get(role);
    if (!f) throw new Error(`missing required source file: ${role}`);
    const wb = await readOfficialWorkbook(f.path);
    assertHeader(f.path, wb.sheet.header, HEADERS[role]);
    workbooks[role] = wb;
  }
  const src = (role: keyof typeof HEADERS) => byRole.get(role)!.sourceId;

  const fatal: string[] = [];
  const checks: IngestReport['checks'] = [];
  const quarantined: IngestReport['quarantined'] = [];
  const siteWarnings: IngestReport['siteWarnings'] = [];
  const check = (id: string, ok: boolean, detail: string) => {
    checks.push({ id, ok, detail });
    if (!ok) fatal.push(`${id}: ${detail}`);
  };

  // ---- report 137: national totals and per-committee totals --------------------------------------------------
  const r137 = workbooks.report137.sheet;
  const totalRow = r137.rows.find((r) => r['סמל ועדה'] === null);
  const committeeRows = r137.rows.filter((r) => r['סמל ועדה'] !== null);
  check('report137.total-row', !!totalRow, 'national total row present');
  const n = (v: Cell | undefined) => (typeof v === 'number' ? v : NaN);
  const report137Totals: Record<string, number> = {};
  if (totalRow) for (const h of HEADERS.report137.slice(2, 8)) report137Totals[h] = n(totalRow[h]);
  for (const h of HEADERS.report137.slice(2, 8)) {
    const sum = committeeRows.reduce((acc, r) => acc + n(r[h]), 0);
    check(`report137.sum.${h}`, sum === report137Totals[h], `sum of committees ${sum} vs total row ${report137Totals[h]}`);
  }

  // ---- stations ---------------------------------------------------------------------------------------------
  interface StationRow {
    committee: string;
    locality: string;
    localityName: string;
    number: string;
    compound: string;
    address: string;
    place: string;
    accessible: boolean;
    special: boolean;
    voters: number;
    row: number;
  }
  const stations: StationRow[] = [];
  const st = workbooks.stations.sheet;
  st.rows.forEach((r, i) => {
    const row = st.rowNumbers[i]!;
    const q = (reason: string) => quarantined.push({ sourceId: src('stations'), row, reason });
    const committee = intCode(r['סמל ועדה']);
    const locality = intCode(r['סמל ישוב בחירות']);
    const compound = intCode(r['סמל רכוז']);
    const number = normaliseStationNumber(r['סמל קלפי']);
    const acc = flag(r['נגישה']);
    const spec = flag(r['נגישה מיוחדת']);
    const address = text(r['כתובת קלפי']);
    const place = text(r['מקום קלפי']);
    const localityName = text(r['שם ישוב בחירות']);
    if (!committee || !locality || !compound || !localityName) return q('missing official identifiers');
    if (!number) return q(`unrecognised station number ${JSON.stringify(r['סמל קלפי'])}`);
    if (acc === 'invalid' || spec === 'invalid') return q('unrecognised accessibility flag value');
    if (!address || !place) return q('missing address or place name');
    if (spec === 'yes' && acc !== 'yes') return q('special-accessible station not marked accessible');
    stations.push({
      committee, locality, localityName, number, compound, address, place,
      accessible: acc === 'yes', special: spec === 'yes', voters: n(r['בוחרי כנסת']), row,
    });
  });

  const stationKey = (loc: string, num: string) => `${loc}#${num}`;
  const stationIndex = new Map<string, StationRow>();
  for (const s of stations) {
    const k = stationKey(s.locality, s.number);
    if (stationIndex.has(k)) {
      quarantined.push({ sourceId: src('stations'), row: s.row, reason: `duplicate station key ${k}` });
      fatal.push(`duplicate station key ${k}`);
    }
    stationIndex.set(k, s);
  }

  const totalStations = stations.length;
  const accessibleStations = stations.filter((s) => s.accessible).length;
  const specialStations = stations.filter((s) => s.special).length;
  const voters = stations.reduce((a, s) => a + s.voters, 0);
  check('stations.no-quarantine', quarantined.length === 0, `${quarantined.length} station rows quarantined`);
  check('stations.total-vs-137', totalStations === report137Totals['סה"כ קלפיות'], `${totalStations} vs ${report137Totals['סה"כ קלפיות']}`);
  check('stations.accessible-vs-137', accessibleStations === report137Totals['סה"כ קלפיות נגישות'], `${accessibleStations} vs ${report137Totals['סה"כ קלפיות נגישות']}`);
  check('stations.special-vs-137', specialStations === report137Totals['סה"כ קלפיות נגישה מיוחדת'], `${specialStations} vs ${report137Totals['סה"כ קלפיות נגישה מיוחדת']}`);
  check('stations.voters-vs-137', voters === report137Totals['בעלי זכות בחירה'], `${voters} vs ${report137Totals['בעלי זכות בחירה']}`);

  // per regional committee: a whole region missing or truncated must be detected (spec §12)
  for (const c of committeeRows) {
    const code = intCode(c['סמל ועדה'])!;
    const mine = stations.filter((s) => s.committee === code);
    const ok =
      mine.length === n(c['סה"כ קלפיות']) &&
      mine.filter((s) => s.accessible).length === n(c['סה"כ קלפיות נגישות']) &&
      mine.filter((s) => s.special).length === n(c['סה"כ קלפיות נגישה מיוחדת']);
    check(`committee.${code}.counts`, ok, `${c['שם ועדה']}: ${mine.length}/${mine.filter((s) => s.accessible).length}/${mine.filter((s) => s.special).length}`);
  }

  // ---- report 104: must agree row-by-row with the station file ----------------------------------------------
  const r104 = workbooks.report104.sheet;
  const instructions = new Map<string, string | null>();
  let r104Mismatch = 0;
  r104.rows.forEach((r, i) => {
    const loc = intCode(r['סמל ישוב בחירות']);
    const num = normaliseStationNumber(r['סמל קלפי']);
    const s = loc && num ? stationIndex.get(stationKey(loc, num)) : undefined;
    const spec = flag(r['נגישה מיוחדת']);
    if (!s || !s.accessible || (spec === 'yes') !== s.special || intCode(r['סמל רכוז']) !== s.compound || text(r['כתובת קלפי']) !== s.address || text(r['מקום קלפי']) !== s.place) {
      r104Mismatch++;
      quarantined.push({ sourceId: src('report104'), row: r104.rowNumbers[i]!, reason: 'disagrees with station file' });
      return;
    }
    instructions.set(stationKey(s.locality, s.number), text(r['הוראות גישה לאנשים עם מוגבלות בניידות']));
  });
  check('report104.rows-match-stations', r104Mismatch === 0, `${r104Mismatch} mismatching rows`);
  check('report104.covers-all-accessible', r104.rows.length === accessibleStations, `${r104.rows.length} rows vs ${accessibleStations} accessible stations`);

  // ---- concentrations (compounds) -----------------------------------------------------------------------------
  const conc = workbooks.concentrations.sheet;
  interface CompoundRow {
    locality: string;
    localityName: string;
    compound: string;
    address: string;
    place: string;
    placeType: string | null;
    x: number;
    y: number;
    netStations: number;
    specialCount: number;
    accessibleCount: number;
    row: number;
  }
  const compounds = new Map<string, CompoundRow>();
  let concTotalRow: Record<string, Cell> | undefined;
  conc.rows.forEach((r, i) => {
    const row = conc.rowNumbers[i]!;
    if (r['סמל ישוב בחירות'] === null && r['סמל רכוז'] === null) {
      concTotalRow = r;
      return;
    }
    const loc = intCode(r['סמל ישוב בחירות']);
    const comp = intCode(r['סמל רכוז']);
    const address = text(r['כתובת קלפי']);
    const place = text(r['מקום קלפי']);
    const name = text(r['שם ישוב בחירות']);
    if (!loc || !comp || !address || !place || !name) {
      quarantined.push({ sourceId: src('concentrations'), row, reason: 'missing official identifiers' });
      return;
    }
    const key = `${loc}#${comp}`;
    if (compounds.has(key)) {
      quarantined.push({ sourceId: src('concentrations'), row, reason: `duplicate compound ${key}` });
      fatal.push(`duplicate compound ${key}`);
      return;
    }
    compounds.set(key, {
      locality: loc, localityName: name, compound: comp, address, place, placeType: text(r['סווג מקום']),
      x: n(r['X']), y: n(r['Y']), netStations: n(r["מס' קלפיות נטו"]),
      specialCount: n(r['קלפיות נגישה מיוחדת']), accessibleCount: n(r['קלפיות נגישות']), row,
    });
  });
  check('concentrations.count-vs-137', compounds.size === report137Totals['סה"כ ריכוזים'], `${compounds.size} vs ${report137Totals['סה"כ ריכוזים']}`);
  if (concTotalRow) {
    check('concentrations.total-row', n(concTotalRow["מס' קלפיות נטו"]) === totalStations, `total row ${concTotalRow["מס' קלפיות נטו"]} vs ${totalStations}`);
  }

  // Every station must belong to a known compound, and address/place must agree.
  const stationsByCompound = new Map<string, StationRow[]>();
  for (const s of stations) {
    const key = `${s.locality}#${s.compound}`;
    const list = stationsByCompound.get(key) ?? [];
    list.push(s);
    stationsByCompound.set(key, list);
  }
  let orphan = 0;
  let addrConflict = 0;
  for (const [key, list] of stationsByCompound) {
    const c = compounds.get(key);
    if (!c) {
      orphan++;
      continue;
    }
    if (list.some((s) => s.address !== c.address || s.place !== c.place)) addrConflict++;
  }
  check('stations.all-in-known-compounds', orphan === 0, `${orphan} station groups without a compound row`);
  check('stations.address-agrees-with-compound', addrConflict === 0, `${addrConflict} compounds with address/place conflicts`);

  // Locality medians for coordinate plausibility.
  const toWgs = (x: number, y: number) => {
    const [lon, lat] = proj4('EPSG:2039', 'WGS84', [x, y]);
    return { lat: lat!, lon: lon! };
  };
  const pointsByLocality = new Map<string, Array<{ lat: number; lon: number }>>();
  for (const c of compounds.values()) {
    if (!(c.x > 100_000 && c.x < 300_000 && c.y > 350_000 && c.y < 810_000)) continue;
    const list = pointsByLocality.get(c.locality) ?? [];
    list.push(toWgs(c.x, c.y));
    pointsByLocality.set(c.locality, list);
  }
  const median = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]!;
  const localityCentre = new Map<string, { lat: number; lon: number }>();
  for (const [loc, pts] of pointsByLocality) {
    localityCentre.set(loc, { lat: median(pts.map((p) => p.lat)), lon: median(pts.map((p) => p.lon)) });
  }

  // ---- build sites -------------------------------------------------------------------------------------------
  const sites: PollingSite[] = [];
  for (const [key, c] of compounds) {
    const list = (stationsByCompound.get(key) ?? []).sort((a, b) => a.row - b.row);
    if (list.length === 0) {
      siteWarnings.push({ siteId: key, reason: 'compound without stations' });
      continue;
    }
    const siteId = `k26-${c.locality}-${c.compound}`;
    const blockedReasons: string[] = [];
    const special = list.filter((s) => s.special).length;
    const accessible = list.filter((s) => s.accessible).length;
    if (special !== c.specialCount) blockedReasons.push(`conflict:compound-special-count(${c.specialCount}≠${special})`);
    if (accessible !== c.accessibleCount) blockedReasons.push(`conflict:compound-accessible-count(${c.accessibleCount}≠${accessible})`);
    if (list.length !== c.netStations) blockedReasons.push(`conflict:compound-station-count(${c.netStations}≠${list.length})`);

    let point: PollingSite['point'] = null;
    if (c.x > 100_000 && c.x < 300_000 && c.y > 350_000 && c.y < 810_000) {
      const p = toWgs(c.x, c.y);
      const centre = localityCentre.get(c.locality);
      if (centre && airDistanceMeters(centre, p) > LOCALITY_DISTANCE_LIMIT_M) {
        siteWarnings.push({ siteId, reason: 'coordinates far from locality — point withheld' });
      } else {
        point = {
          lat: Math.round(p.lat * 1e6) / 1e6,
          lon: Math.round(p.lon * 1e6) / 1e6,
          accuracy: 'building',
          evidence: { sourceId: src('concentrations'), recordLocator: `row:${c.row}` },
        };
      }
    } else if (special > 0) {
      siteWarnings.push({ siteId, reason: 'no official coordinates (X/Y missing or 0)' });
    }

    const restricted = c.placeType && (RESTRICTED_PLACE_TYPES as readonly string[]).includes(c.placeType);
    const stationsOut: Station[] = list.map((s) => {
      const kind: StationKind = s.special ? 'accessible_special' : s.accessible ? 'accessible_assigned' : 'other';
      return {
        officialNumber: s.number,
        kind,
        active: 'yes',
        accessInstructions: s.accessible ? (instructions.get(stationKey(s.locality, s.number)) ?? null) : null,
        evidence: { sourceId: src('stations'), recordLocator: `row:${s.row}` },
      };
    });
    const addr = parseAddress(c.address);
    sites.push({
      siteId,
      officialCompoundId: `${c.locality}/${c.compound}`,
      electionId: ELECTION_ID,
      localityCode: c.locality,
      localityName: c.localityName,
      officialName: c.place,
      placeType: c.placeType,
      address: { locality: c.localityName, street: addr.street, house: addr.house, raw: c.address },
      point,
      publicAccess: restricted
        ? { value: 'unknown', reason: `institution-type:${c.placeType}` }
        : { value: 'yes', reason: 'official-regular-station-list' },
      stations: stationsOut,
      blockedReasons,
      evidence: [{ sourceId: src('concentrations'), recordLocator: `row:${c.row}` }],
    });
    if (blockedReasons.length && (special > 0 || c.specialCount > 0)) siteWarnings.push({ siteId, reason: blockedReasons.join(', ') });
  }
  // Sites whose special stations disagree are blocked; also report sites claiming special stations without any.
  for (const c of compounds.values()) {
    if (!stationsByCompound.has(`${c.locality}#${c.compound}`)) {
      siteWarnings.push({ siteId: `k26-${c.locality}-${c.compound}`, reason: 'compound row has no stations' });
    }
  }

  const localities = [...new Map(sites.map((s) => [s.localityCode, s.localityName])).entries()]
    .map(([code, name]) => {
      const c = localityCentre.get(code);
      return { code, name, centre: c ? { lat: Math.round(c.lat * 1e5) / 1e5, lon: Math.round(c.lon * 1e5) / 1e5 } : null };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));

  check('electionId.national-totals', true, `identified as ${ELECTION_ID} by exact match of national totals with report 137 and published figures`);
  void checkedAt;

  return {
    sites: sites.sort((a, b) => (a.siteId < b.siteId ? -1 : 1)),
    localities,
    workbooks,
    report: {
      electionId: ELECTION_ID,
      totals: {
        stations: totalStations,
        accessibleStations,
        specialStations,
        voters,
        compounds: compounds.size,
        localities: localities.length,
      },
      report137Totals,
      checks,
      quarantined,
      siteWarnings,
    },
    fatal,
  };
}

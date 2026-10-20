"""Independent check of what the site showed, straight from the raw CEC files (no code shared with the site)."""
# Usage: XLSX_DIR=<dir with the official xlsx files> python3 -I scripts/tools/verify-official.py  (run in the dir holding sample.json + userpts.json from sample-users.mjs)
import json, math, sys, collections, openpyxl
from pyproj import Transformer
import os
SRC = os.environ.get('XLSX_DIR', 'src') + '/'
F = dict(stations='8fd981ca-________________.xlsx', r104='758d5dd0-____104________________________________.xlsx', conc='21b037b4-Polling_Station.xlsx')
def rows(f):
    ws = openpyxl.load_workbook(SRC + f, read_only=True).worksheets[0]
    it = ws.iter_rows(values_only=True); h = [str(x).strip() if x else x for x in next(it)]
    for r in it:
        d = dict(zip(h, r))
        if d.get('סמל ישוב בחירות') in (None, '') or not str(d.get('סמל ישוב בחירות')).strip().isdigit(): continue
        yield d
def num(v): return str(int(v)) if float(v).is_integer() else f'{v:.1f}'
yes = lambda v: str(v or '').strip() == 'כ'
clean = lambda s: ' '.join(str(s or '').split())
st = list(rows(F['stations'])); r104 = list(rows(F['r104'])); conc = list(rows(F['conc']))
instr = {(int(d['סמל ישוב בחירות']), num(d['סמל קלפי'])): clean(d['הוראות גישה לאנשים עם מוגבלות בניידות']) for d in r104}
spec104 = {(int(d['סמל ישוב בחירות']), num(d['סמל קלפי'])): yes(d['נגישה מיוחדת']) for d in r104}
tr = Transformer.from_crs('EPSG:2039', 'EPSG:4326', always_xy=True)
by_comp = collections.defaultdict(list)
for d in st: by_comp[(int(d['סמל ישוב בחירות']), int(d['סמל רכוז']))].append(d)
comp = {}
for c in conc:
    k = (int(c['סמל ישוב בחירות']), int(c['סמל רכוז']))
    x, y = c['X'], c['Y']
    lon, lat = tr.transform(x, y) if x and y else (None, None)
    comp[k] = dict(c, lat=lat, lon=lon)
def hav(a, b):
    R = 6371008.8; p1, p2 = math.radians(a[0]), math.radians(b[0]); dp = p2 - p1; dl = math.radians(b[1] - a[1])
    return 2 * R * math.asin(math.sqrt(math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2))
sample = json.load(open('sample.json')); pts = json.load(open('userpts.json'))
EXCL = {'בית אבות', 'מוסד שיקומי'}
allok = True
for i, r in enumerate(sample, 1):
    print(f"\n=== {r['user']['id']}")
    loc_name = r['user']['locality']
    locs = {int(d['סמל ישוב בחירות']) for d in st if clean(d['שם ישוב בחירות']) == loc_name}
    assert len(locs) == 1, locs; loc = locs.pop()
    for c in r['cards']:
        addr, _, _ = c['address'].rpartition(', ')
        ks = [k for k, v in comp.items() if k[0] == loc and clean(v['מקום קלפי']) == c['name'] and clean(v['כתובת קלפי']) == addr]
        if not ks: print('  ✗ place not found in official file:', c['name'], addr); allok = False; continue
        stations = [d for k in ks for d in by_comp[k]]
        sp = sorted({num(d['סמל קלפי']) for d in stations if yes(d['נגישה מיוחדת'])}, key=float)
        rg = sorted({num(d['סמל קלפי']) for d in stations if yes(d['נגישה']) and not yes(d['נגישה מיוחדת'])}, key=float)
        no = sorted({num(d['סמל קלפי']) for d in stations if not yes(d['נגישה'])}, key=float)
        ins = sorted({instr.get((loc, n)) for n in sp} - {None, ''})
        cross104 = all(spec104.get((loc, n)) is True for n in sp) and all(spec104.get((loc, n)) is False for n in rg)
        ok = sp == c['special'] and rg == c['regular'] and sorted(c['instructions']) == ins and cross104
        allok &= ok
        print(f"  {'✓' if ok else '✗'} {c['name']} ({addr}) official: special={sp} regular={rg} not-accessible={no} | site: special={c['special']} regular={c['regular']} | instructions match={sorted(c['instructions']) == ins} | report104 agrees={cross104}")
    # independent ranking: nearest special-accessible public places to the user point
    up = pts[str(i)]
    cand = collections.defaultdict(list)
    for k, v in comp.items():
        if v['lat'] is None: continue
        if not any(yes(d['נגישה מיוחדת']) for d in by_comp[k]): continue
        if clean(v.get('סווג מקום')) in EXCL: continue
        cand[(round(v['lat'], 5), round(v['lon'], 5), clean(v['מקום קלפי']), f"k26-{k[0]}-{k[1]}")].append(v)
    ranked = sorted(((hav(up, (key[0], key[1])), vs, key[3]) for key, vs in cand.items()), key=lambda x: (round(x[0], 6), x[2]))[:4]
    top = [clean(vs[0]['מקום קלפי']) for _, vs, _ in ranked]
    shown = [c['name'] for c in r['cards']]
    same = top[:3] == shown
    allok &= same
    print(f"  {'✓' if same else '✗'} independent nearest 3: " + ' | '.join(f"{clean(vs[0]['מקום קלפי'])} {d:.0f} m" for d, vs, _ in ranked[:3]) + f"   (4th: {clean(ranked[3][1][0]['מקום קלפי'])} {ranked[3][0]:.0f} m)")
print('\nALL MATCH' if allok else '\nMISMATCH FOUND')

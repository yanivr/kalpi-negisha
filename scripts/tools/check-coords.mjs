import proj4 from 'proj4';
import fs from 'node:fs';
proj4.defs('EPSG:2039','+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,-0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs');
const rows = JSON.parse(fs.readFileSync(process.argv[2])).rows.filter(r=>r['סמל ישוב בחירות']!=null && r['X']);
const byLoc = {};
for (const r of rows) { const [lon,lat]=proj4('EPSG:2039','WGS84',[r.X,r.Y]); r.lat=lat; r.lon=lon; (byLoc[r['סמל ישוב בחירות']] ??= []).push(r); }
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
const hav=(a,b)=>{const R=6371,t=Math.PI/180;const h=Math.sin((b.lat-a.lat)*t/2)**2+Math.cos(a.lat*t)*Math.cos(b.lat*t)*Math.sin((b.lon-a.lon)*t/2)**2;return 2*R*Math.asin(Math.sqrt(h));};
const out=[];
for (const [k,list] of Object.entries(byLoc)) { if (list.length<2) continue; const c={lat:med(list.map(r=>r.lat)),lon:med(list.map(r=>r.lon))}; for (const r of list){const d=hav(c,r); if(d>8) out.push([r['שם ישוב בחירות'],r['סמל רכוז'],r['כתובת קלפי'],r['מקום קלפי'],d.toFixed(1),list.length,r['קלפיות נגישה מיוחדת']]);} }
out.sort((a,b)=>b[4]-a[4]); console.log(out.length); for (const o of out.slice(0,40)) console.log(o.join(' | '));
const j = byLoc[3000][0]; console.log('jerusalem sample', j['כתובת קלפי'], j.lat.toFixed(5), j.lon.toFixed(5));
const rh = byLoc[8400].slice(0,3).map(r=>[r['כתובת קלפי'],r['מקום קלפי'],r.lat.toFixed(5),r.lon.toFixed(5)]); console.log(rh);

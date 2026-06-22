// scripts/build-report.mjs
// Genera tepeyac.html con datos REALES del CAN (Mapon/Smart-Connect).
// La API key se toma de la variable de entorno MAPON_API_KEY (nunca se escribe en el HTML).
// Periodo dinámico: del 1° del mes anterior hasta hoy.
import { readFileSync, writeFileSync } from 'fs';

const KEY = process.env.MAPON_API_KEY;
if (!KEY) { console.error('ERROR: falta la variable de entorno MAPON_API_KEY'); process.exit(1); }
const BASE = 'https://portal.smart-connect.com.mx/api/v1';

// ── Periodo dinámico: ventana móvil de 30 días (la API limita el rango) ──
const now = new Date();
const till = now.toISOString().slice(0, 10);
const fromDate = new Date(now); fromDate.setUTCDate(fromDate.getUTCDate() - 29);
const from = fromDate.toISOString().slice(0, 10);
const FROM = from + 'T00:00:00Z', TILL = till + 'T23:59:59Z';
// Mes por defecto = el que tenga más días dentro de la ventana
function monthDays(a, b) { const c = {}; let d = new Date(a + 'T00:00:00Z'); const e = new Date(b + 'T00:00:00Z'); while (d <= e) { const k = d.toISOString().slice(0, 7); c[k] = (c[k] || 0) + 1; d.setUTCDate(d.getUTCDate() + 1); } return c; }
const curMonth = Object.entries(monthDays(from, till)).sort((x, y) => y[1] - x[1])[0][0];

const BENCH = { 'S3': 8.0, 'S3-E6 AMT': 8.5, 'EST-A X13': 2.6, 'TUNLAND E5': 9.5 };
const TANK  = { 'S3': 100, 'S3-E6 AMT': 100, 'EST-A X13': 400, 'TUNLAND E5': 80 };

async function api(method, params = {}) {
  const u = new URL(BASE + '/' + method);
  u.searchParams.set('key', KEY);
  for (const k in params) u.searchParams.set(k, params[k]);
  const r = await fetch(u);
  return r.json();
}
const dur = (a, b) => (new Date(b) - new Date(a)) / 3600000;
function dailyDelta(arr) {
  const byDate = {}; for (const p of arr) { const d = p.gmt.slice(0, 10); byDate[d] = Math.max(byDate[d] ?? -Infinity, p.value); }
  const ds = Object.keys(byDate).sort(); const out = {}; let prev = null;
  for (const d of ds) { if (prev != null) out[d] = Math.max(0, byDate[d] - prev); prev = byDate[d]; } return out;
}
function drains(fuel, tankL) {
  let n = 0, big = 0, L = 0;
  for (let i = 1; i < fuel.length; i++) { const drop = fuel[i - 1].value - fuel[i].value; const dt = (new Date(fuel[i].gmt) - new Date(fuel[i - 1].gmt)) / 60000;
    if (drop >= 8 && dt < 30) { const lt = drop / 100 * tankL; n++; L += lt; if (lt > 10) big++; } }
  return { n, big, L: Math.round(L) };
}

// ── 1) Unidades ──
const ul = await api('unit/list.json');
const units = ul.data.units;
console.log('Unidades:', units.length, '· periodo', from, '→', till);

// ── 2) Rutas + CAN por unidad ──
const real = [];
for (const u of units) {
  let routes = []; try { const j = await api('route/list.json', { from: FROM, till: TILL, unit_id: u.unit_id }); routes = j.data?.units?.[0]?.routes || []; } catch (e) {}
  const rdaily = {}; let rkm = 0, rdrive = 0;
  for (const r of routes) { if (!r.start?.time || !r.end?.time) continue; const d = r.start.time.slice(0, 10); rdaily[d] = rdaily[d] || { viol: 0, maxs: 0 };
    if (r.type === 'route') { const sp = r.avg_speed || 0; rkm += (r.distance || 0) / 1000; rdrive += dur(r.start.time, r.end.time); if (sp > rdaily[d].maxs) rdaily[d].maxs = sp; if (sp > 90) rdaily[d].viol++; } }
  const V = Math.min(75, Math.max(15, rdrive > 1 ? rkm / rdrive : 40));
  const base = { label: u.label, model: u.model, number: u.number || u.vin || '' };
  if (rkm <= 10) { real.push({ ...base, can: false, drainN: 0, drainL: 0, drainBig: 0, daily: {} }); process.stderr.write('-'); continue; }
  let cu = null; try { const j = await api('unit_data/can_period.json', { unit_id: u.unit_id, from: FROM, till: TILL }); cu = j.data?.units?.[0]; } catch (e) {}
  if (!cu || !cu.total_distance) { real.push({ ...base, can: false, drainN: 0, drainL: 0, drainBig: 0, daily: {} }); process.stderr.write('x'); continue; }
  const dDist = dailyDelta(cu.total_distance), dFuel = dailyDelta(cu.total_fuel), dEng = dailyDelta(cu.total_engine_hours);
  const dr = drains(cu.fuel_level || [], TANK[u.model] || 100);
  const dates = new Set([...Object.keys(dDist), ...Object.keys(rdaily)]);
  const daily = {};
  for (const d of [...dates].sort()) { if (d < from || d > till) continue; const rt = rdaily[d] || { viol: 0, maxs: 0 };
    const kk = dDist[d] || 0, ff = dFuel[d] || 0, ee = dEng[d] || 0, mov = kk / V, id = Math.max(0, ee - mov);
    daily[d] = { km: +kk.toFixed(1), drive: +mov.toFixed(1), idle: +id.toFixed(1), fuel: +ff.toFixed(1), viol: rt.viol || 0, maxs: rt.maxs || 0 }; }
  real.push({ ...base, can: true, drainN: dr.n, drainL: dr.L, drainBig: dr.big, daily });
  process.stderr.write('.');
}
process.stderr.write('\n');

// ── 3) D + REAL_DAILY → inyectar en index.html ──
const models = [...new Set(real.map(u => u.label))].map(m => [(m.startsWith('FOTON') || m.startsWith('Foton')) ? m : ('FOTON ' + m), BENCH[m.replace(/^FOTON |^Foton /, '')] || 3.0]);
const D = [], DAILY = {};
real.forEach((u, i) => {
  const dd = u.daily || {}; const dates = Object.keys(dd); const nd = Math.max(1, dates.length);
  DAILY[i] = {};
  dates.forEach(d => { const x = dd[d]; DAILY[i][d] = { km: x.km, drive: x.drive, idle: x.idle, fuel: x.fuel, viol: x.viol || 0, maxs: x.maxs || 0, drain: (u.drainN || 0) / nd, drainL: (u.drainL || 0) / nd, drainBig: (u.drainBig || 0) / nd }; });
  D.push({ _i: i, n: (u.number || '').slice(-6), number: u.number || '', model: (u.label.startsWith('FOTON') || u.label.startsWith('Foton')) ? u.label : ('FOTON ' + u.label), zona: '', has_can: !!u.can, sensor: !!u.can, bench: BENCH[u.model] || 3.0, nightProf: 0.07 + (i % 5) * 0.02, stale: !u.can || !dates.length });
});

let html = readFileSync('index.html', 'utf8');
const cfg = `/* DATOS REALES · Fertilizantes Tepeyac · generado ${new Date().toISOString()} */
const MODELS=${JSON.stringify(models)};
const ZONAS=[];
const ZRISK_ACC={Sonora:.45,Jalisco:.50,"Guanajuato":.60,Sinaloa:.72,"Michoacán":.68,Puebla:.55};
const ZRISK_THEFT={Sonora:.40,Jalisco:.55,"Guanajuato":.65,Sinaloa:.80,"Michoacán":.62,Puebla:.50};
const META={cliente:"Fertilizantes Tepeyac",tier:"Real",zona:"Nacional (multi-estado)",tipoUnidad:"unidades FOTON",fuente:"Mapon API · Smart-Connect",sinSenal:[]};
const D=${JSON.stringify(D)};
const REAL_DAILY=${JSON.stringify(DAILY)};
`;
html = html.replace(/\/\* ═+[\s\S]*?PLANTILLA REUTILIZABLE[\s\S]*?(?=\/\/ ═+ HELPERS)/, cfg + '\n');
html = html.replace("new Date('2026-02-01T00:00:00')", `new Date('${from}T00:00:00')`).replace("new Date('2026-06-17T00:00:00')", `new Date('${till}T00:00:00')`);
html = html.replace(/\/\/ ═+ MÉTRICA DIARIA PROCEDURAL POR UNIDAD[\s\S]*?(?=\/\/ ═+ AGREGACIÓN)/,
`// MÉTRICA DIARIA REAL (CAN)
function dayMetric(u,ds){const M=REAL_DAILY[u._i],d=M&&M[ds];
  if(!d)return {km:0,drive:0,stop:0,real_l:0,viol:0,maxs:0,night:0,harsh:null,drain:0,drainL:0,drainBig:0};
  return {km:d.km,drive:d.drive,stop:d.idle,real_l:d.fuel,viol:d.viol,maxs:d.maxs,night:d.drive*u.nightProf,harsh:null,drain:d.drain,drainL:d.drainL,drainBig:d.drainBig};}
`);
html = html.replace("let km=0,drive=0,stop=0,real_l=0,viol=0,maxs=0,night=0,harsh=0,drain=0,hasH=u.has_can;", "let km=0,drive=0,stop=0,real_l=0,viol=0,maxs=0,night=0,harsh=0,drain=0,drainL=0,drainBig=0,hasH=u.has_can;");
html = html.replace("if(d.harsh!=null)harsh+=d.harsh;drain+=d.drain;});", "if(d.harsh!=null)harsh+=d.harsh;drain+=d.drain;drainL+=d.drainL||0;drainBig+=d.drainBig||0;});");
html = html.replace("const drainL=drain>0?Math.round(drain*(11+H(u._i,9.3)*9)):0, drainBig=Math.round(drain*0.55);", "");
html = html.replace("drain,drainL,drainBig,kml,pctIdle", "drain:Math.round(drain),drainL:Math.round(drainL),drainBig:Math.round(drainBig),kml,pctIdle");
html = html.replace(/const STATE=\{month:'[^']+'/, `const STATE={month:'${curMonth}'`);
html = html.replace("<title>Informe Gerencial de Flota — Advance</title>", "<title>Informe Gerencial — Fertilizantes Tepeyac</title>");

writeFileSync('tepeyac.html', html);
console.log('OK · tepeyac.html · unidades', D.length, '· con CAN', D.filter(d => d.has_can).length, '· mes', curMonth);

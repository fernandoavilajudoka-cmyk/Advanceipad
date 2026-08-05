// scripts/build-report.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Genera UN informe por cada cliente, con la MISMA estructura (index.html).
// Onboarding de un cliente nuevo = agregar un secret  MAPON_<CLIENTE>  con su API key.
//
//   · En CI: el workflow pasa  ALL_SECRETS = toJSON(secrets)  y el script
//            descubre solo todos los secrets que empiezan con  MAPON_.
//   · En local: exporta  MAPON_<CLIENTE>=<apikey>  y corre  node scripts/build-report.mjs
//
// La API key NUNCA se escribe en el HTML ni se imprime en los logs.
// Salida: clientes/<slug>/index.html   (un cliente = una carpeta = una liga)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://portal.smart-connect.com.mx/api/v1';

// ── Config OPCIONAL por cliente (nombre bonito, km/L de ficha, tanque) ──
let CLIENTS = {};
try { CLIENTS = JSON.parse(readFileSync('clientes.json', 'utf8')); } catch (e) {}

// ── Riesgo regional nacional (referencia reutilizable para todos los clientes) ──
const ZRISK_ACC   = { Sonora: .45, Jalisco: .50, 'Guanajuato': .60, Sinaloa: .72, 'Michoacán': .68, Puebla: .55 };
const ZRISK_THEFT = { Sonora: .40, Jalisco: .55, 'Guanajuato': .65, Sinaloa: .80, 'Michoacán': .62, Puebla: .50 };

// ── 0) Descubrir clientes desde los secrets / variables de entorno ──
function discoverClients() {
  let env = process.env;
  if (process.env.ALL_SECRETS) { try { env = { ...process.env, ...JSON.parse(process.env.ALL_SECRETS) }; } catch (e) {} }
  const out = {};
  for (const name in env) {
    const m = /^MAPON_(.+)$/.exec(name);
    if (m && env[name] && String(env[name]).length > 10) out[m[1].toLowerCase()] = env[name];
  }
  // Compatibilidad con el secret heredado de Tepeyac (sin prefijo MAPON_)
  if (!out['tepeyac']) { const legacy = env.FETILIZANTESTEPEYAC || env.FERTILIZANTESTEPEYAC; if (legacy) out['tepeyac'] = legacy; }
  return out;
}

// ── Helpers de API (reciben la KEY de cada cliente) ──
async function api(KEY, method, params = {}) {
  const u = new URL(BASE + '/' + method);
  u.searchParams.set('key', KEY);
  for (const k in params) u.searchParams.set(k, params[k]);
  const r = await fetch(u);
  return r.json();
}
const dur = (a, b) => (new Date(b) - new Date(a)) / 3600000;
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
// Cuando la unidad no trae modelo capturado en la plataforma, Mapon repite el VIN
// como etiqueta. Agruparlas evita que cada VIN aparezca como un modelo distinto.
const esVin = s => /^[A-Z0-9]{15,20}$/i.test(s);
const etiqueta = s => { const t = norm(s); return esVin(t) ? 'Sin modelo asignado' : t; };

// Descarga TODAS las alertas del periodo (la API pagina de 100 en 100).
async function fetchAlerts(KEY, FROM, TILL) {
  const seen = new Map();
  for (let page = 1; page <= 200; page++) {
    let j; try { j = await api(KEY, 'alert/list.json', { from: FROM, till: TILL, limit: 100, page }); } catch (e) { break; }
    const A = Array.isArray(j.data) ? j.data : [];
    for (const a of A) seen.set(`${a.unit_id}|${a.time}|${a.alert_type}`, a);
    if (A.length < 100) break;
  }
  return [...seen.values()];
}

// Delta diario de un contador acumulado (odómetro, litros totales, horas motor).
// maxPerDay descarta saltos físicamente imposibles: un contador que se reinicia o
// brinca deja un delta absurdo que, sin este filtro, contamina todos los agregados.
function dailyDelta(arr, maxPerDay) {
  const byDate = {}; for (const p of arr || []) { const d = p.gmt.slice(0, 10); byDate[d] = Math.max(byDate[d] ?? -Infinity, p.value); }
  const ds = Object.keys(byDate).sort(); const out = {}; let prev = null; const skipped = [];
  for (const d of ds) {
    if (prev != null) {
      const delta = Math.max(0, byDate[d] - prev);
      if (maxPerDay == null || delta <= maxPerDay) out[d] = delta; else skipped.push(d);
    }
    prev = byDate[d];
  }
  Object.defineProperty(out, '_skipped', { value: skipped, enumerable: false });
  return out;
}
// Techos físicos, no operativos: un tracto con relevo de operador registra 1,600 km/día
// sin problema. Solo se descarta lo imposible (24 h a 105 km/h ≈ 2,500 km).
const MAX_KM_DIA = 2500, MAX_L_DIA = 1200, MAX_H_DIA = 24;
function drains(fuel, tankL) {
  let n = 0, big = 0, L = 0;
  for (let i = 1; i < (fuel || []).length; i++) {
    const drop = fuel[i - 1].value - fuel[i].value;
    const dt = (new Date(fuel[i].gmt) - new Date(fuel[i - 1].gmt)) / 60000;
    if (drop >= 8 && dt < 30) { const lt = drop / 100 * tankL; n++; L += lt; if (lt > 10) big++; }
  }
  return { n, big, L: Math.round(L) };
}

// ── Construye el HTML de UN cliente y lo escribe en clientes/<slug>/index.html ──
async function buildClient(slug, KEY, template) {
  const cfgC = CLIENTS[slug] || {};
  const nombre = cfgC.nombre || slug.replace(/(^|\s)\S/g, c => c.toUpperCase());
  const BENCH = cfgC.bench || {};
  const TANK  = cfgC.tank  || {};
  const benchDefault = cfgC.benchDefault ?? 3.0;
  const tankDefault  = cfgC.tankDefault  ?? 100;

  // Periodo dinámico: ventana móvil de 30 días (límite de la API)
  const now = new Date();
  const till = now.toISOString().slice(0, 10);
  const fromDate = new Date(now); fromDate.setUTCDate(fromDate.getUTCDate() - 29);
  const from = fromDate.toISOString().slice(0, 10);
  const FROM = from + 'T00:00:00Z', TILL = till + 'T23:59:59Z';
  function monthDays(a, b) { const c = {}; let d = new Date(a + 'T00:00:00Z'); const e = new Date(b + 'T00:00:00Z'); while (d <= e) { const k = d.toISOString().slice(0, 7); c[k] = (c[k] || 0) + 1; d.setUTCDate(d.getUTCDate() + 1); } return c; }
  const curMonth = Object.entries(monthDays(from, till)).sort((x, y) => y[1] - x[1])[0][0];
  const fmtMX = d => new Date(d + 'T12:00:00Z').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  const periodoLbl = `${fmtMX(from)} – ${fmtMX(till)}`;

  // 1) Unidades
  const ul = await api(KEY, 'unit/list.json');
  const units = ul.data?.units || [];
  console.log(`[${slug}] unidades: ${units.length} · periodo ${from} → ${till}`);

  // 1.b) Eventos reales del periodo (excesos, inhibidor, drenajes, corte de energía).
  //      La API NO expone eventos de acelerómetro/giroscopio (frenada/aceleración brusca):
  //      si no vienen, se reportan como «sin dato» en vez de estimarse.
  const alerts = await fetchAlerts(KEY, FROM, TILL);
  const EV_MAP = { speeding: 'exces', jammer_detection_event: 'jammer', fuel_change: 'drain', no_power: 'power', battery_level: 'power', switch: 'power' };
  const evUnit = {}, evHour = new Array(24).fill(0), evTot = { exces: 0, jammer: 0, drain: 0, power: 0 }, evDay = {};
  let drainLTot = 0;
  for (const a of alerts) {
    const k = EV_MAP[a.alert_type]; if (!k) continue;
    const d = a.time.slice(0, 10);
    let val = {}; try { val = JSON.parse(a.alert_val || '{}'); } catch (e) {}
    // fuel_change trae subidas y bajas; solo interesa el drenaje.
    if (k === 'drain' && !val.is_drain) continue;
    // jammer_detection_event se emite también al recuperar señal; solo cuenta la exposición.
    if (k === 'jammer' && val.is_jamming === false) continue;
    evUnit[a.unit_id] = evUnit[a.unit_id] || {};
    const cell = evUnit[a.unit_id][d] = evUnit[a.unit_id][d] || { exces: 0, jammer: 0, drain: 0, drainL: 0, drainBig: 0, power: 0, maxs: 0 };
    cell[k]++; evTot[k]++;
    evDay[d] = evDay[d] || { exces: 0, jammer: 0, drain: 0, power: 0 }; evDay[d][k]++;
    if (k === 'drain') { const L = +val.volume || 0; cell.drainL += L; drainLTot += L; if (L > 10) cell.drainBig++; }
    if (k === 'exces' && +val.speed > cell.maxs) cell.maxs = +val.speed;
    // Hora local del cliente (la API entrega UTC; la flota opera en horario de México).
    evHour[(new Date(a.time).getUTCHours() + 18) % 24]++;
  }
  console.log(`[${slug}] eventos reales: ${evTot.exces} excesos · ${evTot.jammer} inhibidor · ${evTot.drain} drenajes (${Math.round(drainLTot)} L) · ${evTot.power} corte energía`);

  // 2) Rutas + CAN por unidad
  const real = [];
  const anomalias = [];
  for (const u of units) {
    let routes = []; try { const j = await api(KEY, 'route/list.json', { from: FROM, till: TILL, unit_id: u.unit_id }); routes = j.data?.units?.[0]?.routes || []; } catch (e) {}
    const ev = evUnit[u.unit_id] || {};
    const rdaily = {}; let rkm = 0, rdrive = 0;
    for (const r of routes) {
      if (!r.start?.time || !r.end?.time) continue;
      const d = r.start.time.slice(0, 10); rdaily[d] = rdaily[d] || { maxs: 0, drv: 0, night: 0 };
      if (r.type === 'route') {
        const h = dur(r.start.time, r.end.time);
        rkm += (r.distance || 0) / 1000; rdrive += h; rdaily[d].drv += h;
        // Nocturno = tramo iniciado entre 22:00 y 06:00 hora local (UTC-6).
        const hl = (new Date(r.start.time).getUTCHours() + 18) % 24;
        if (hl >= 22 || hl < 6) rdaily[d].night += h;
        // max_speed es dato real del tramo, no un promedio.
        if ((r.max_speed || 0) > rdaily[d].maxs) rdaily[d].maxs = r.max_speed;
      }
    }
    const V = Math.min(75, Math.max(15, rdrive > 1 ? rkm / rdrive : 40));
    const base = { label: etiqueta(u.label), model: norm(u.model), number: u.number || u.vin || '' };
    if (rkm <= 10) { real.push({ ...base, can: false, drainN: 0, drainL: 0, drainBig: 0, daily: {} }); continue; }
    let cu = null; try { const j = await api(KEY, 'unit_data/can_period.json', { unit_id: u.unit_id, from: FROM, till: TILL }); cu = j.data?.units?.[0]; } catch (e) {}
    if (!cu || !cu.total_distance) { real.push({ ...base, can: false, drainN: 0, drainL: 0, drainBig: 0, daily: {} }); continue; }
    const dDist = dailyDelta(cu.total_distance, MAX_KM_DIA), dFuel = dailyDelta(cu.total_fuel, MAX_L_DIA), dEng = dailyDelta(cu.total_engine_hours, MAX_H_DIA);
    if (dDist._skipped.length) anomalias.push(`${base.number} (odómetro: ${dDist._skipped.join(', ')})`);
    const dates = new Set([...Object.keys(dDist), ...Object.keys(rdaily), ...Object.keys(ev)]);
    const daily = {};
    for (const d of [...dates].sort()) {
      if (d < from || d > till) continue;
      const rt = rdaily[d] || { maxs: 0, drv: 0, night: 0 }, ec = ev[d] || { exces: 0, jammer: 0, drain: 0, drainL: 0, drainBig: 0, power: 0, maxs: 0 };
      const kk = dDist[d] || 0, ff = dFuel[d] || 0, ee = dEng[d] || 0;
      // Horas de manejo reales (suma de tramos); el estimado km/V solo es respaldo.
      const mov = Math.min(ee || Infinity, rt.drv > 0 ? rt.drv : kk / V);
      const id = Math.max(0, ee - mov);
      daily[d] = { km: +kk.toFixed(1), drive: +mov.toFixed(1), idle: +id.toFixed(1), fuel: +ff.toFixed(1),
        viol: ec.exces, maxs: Math.max(rt.maxs || 0, ec.maxs || 0),
        night: +Math.min(rt.night || 0, mov).toFixed(1),
        drain: ec.drain, drainL: +ec.drainL.toFixed(1), drainBig: ec.drainBig, jammer: ec.jammer, power: ec.power };
    }
    // Los drenajes salen de las alertas (volumen medido por CAN); si la cuenta no
    // emite esa alerta, se recurre a la detección por caída de nivel de tanque.
    const totD = Object.values(daily).reduce((s, x) => s + x.drain, 0);
    if (totD === 0) {
      const dr = drains(cu.fuel_level || [], TANK[base.model] ?? tankDefault);
      const ds = Object.keys(daily); const nd = Math.max(1, ds.length);
      ds.forEach(d => { daily[d].drain = dr.n / nd; daily[d].drainL = dr.L / nd; daily[d].drainBig = dr.big / nd; });
    }
    real.push({ ...base, can: true, daily });
  }

  // 3) Modelos + D + REAL_DAILY
  const models = [...new Set(real.filter(u => u.can).map(u => u.label))].map(m => [m, BENCH[m.replace(/^FOTON |^Foton /, '')] ?? benchDefault]);
  const D = [], DAILY = {};
  real.forEach((u, i) => {
    const dd = u.daily || {}; const dates = Object.keys(dd);
    DAILY[i] = {};
    dates.forEach(d => { const x = dd[d]; DAILY[i][d] = { km: x.km, drive: x.drive, idle: x.idle, fuel: x.fuel, night: x.night || 0, viol: x.viol || 0, maxs: x.maxs || 0, drain: x.drain || 0, drainL: x.drainL || 0, drainBig: x.drainBig || 0, jammer: x.jammer || 0, power: x.power || 0 }; });
    D.push({ _i: i, n: (u.number || '').slice(-6), number: u.number || '', model: u.label, zona: '', has_can: !!u.can, sensor: !!u.can, bench: BENCH[u.model] ?? benchDefault, nightProf: 0.07 + (i % 5) * 0.02, stale: !u.can || !dates.length });
  });
  const conCan = D.filter(d => d.has_can).length;

  // 4) Inyectar en la plantilla (misma estructura para todos los clientes)
  let html = template;
  const cfg = `/* DATOS REALES · ${nombre} · generado ${new Date().toISOString()} */
const MODELS=${JSON.stringify(models)};
const ZONAS=[];
const ZRISK_ACC=${JSON.stringify(ZRISK_ACC)};
const ZRISK_THEFT=${JSON.stringify(ZRISK_THEFT)};
const META={cliente:${JSON.stringify(nombre)},tier:"Real",zona:"Nacional (multi-estado)",tipoUnidad:"unidades",periodo:${JSON.stringify(periodoLbl)},fuente:"Mapon API · Smart-Connect",sinSenal:[]};
const D=${JSON.stringify(D)};
const REAL_DAILY=${JSON.stringify(DAILY)};
/* Eventos reales del periodo. gyro:false ⇒ la cuenta no publica acelerómetro/giroscopio,
   así que frenada y aceleración bruscas se muestran como «sin dato», nunca estimadas. */
const EVENTS={gyro:false,tot:${JSON.stringify(evTot)},drainL:${Math.round(drainLTot)},byDay:${JSON.stringify(evDay)},byHour:${JSON.stringify(evHour)}};
`;
  html = html.replace(/\/\* ═+[\s\S]*?PLANTILLA REUTILIZABLE[\s\S]*?(?=\/\/ ═+ HELPERS)/, cfg + '\n');
  html = html.replace("new Date('2026-02-01T00:00:00')", `new Date('${from}T00:00:00')`).replace("new Date('2026-06-17T00:00:00')", `new Date('${till}T00:00:00')`);
  html = html.replace(/\/\/ ═+ MÉTRICA DIARIA PROCEDURAL POR UNIDAD[\s\S]*?(?=\/\/ ═+ AGREGACIÓN)/,
`// MÉTRICA DIARIA REAL (CAN)
function dayMetric(u,ds){const M=REAL_DAILY[u._i],d=M&&M[ds];
  if(!d)return {km:0,drive:0,stop:0,real_l:0,viol:0,maxs:0,night:0,harsh:null,drain:0,drainL:0,drainBig:0};
  return {km:d.km,drive:d.drive,stop:d.idle,real_l:d.fuel,viol:d.viol,maxs:d.maxs,night:d.night||0,harsh:null,drain:d.drain,drainL:d.drainL,drainBig:d.drainBig};}
`);
  html = html.replace("let km=0,drive=0,stop=0,real_l=0,viol=0,maxs=0,night=0,harsh=0,drain=0,hasH=u.has_can;", "let km=0,drive=0,stop=0,real_l=0,viol=0,maxs=0,night=0,harsh=0,drain=0,drainL=0,drainBig=0,hasH=u.has_can;");
  html = html.replace("if(d.harsh!=null)harsh+=d.harsh;drain+=d.drain;});", "if(d.harsh!=null)harsh+=d.harsh;drain+=d.drain;drainL+=d.drainL||0;drainBig+=d.drainBig||0;});");
  html = html.replace("const drainL=drain>0?Math.round(drain*(11+H(u._i,9.3)*9)):0, drainBig=Math.round(drain*0.55);", "");
  html = html.replace("drain,drainL,drainBig,kml,pctIdle", "drain:Math.round(drain),drainL:Math.round(drainL),drainBig:Math.round(drainBig),kml,pctIdle");
  html = html.replace(/const STATE=\{month:'[^']+'/, `const STATE={month:'${curMonth}'`);
  html = html.replace("<title>Informe Gerencial de Flota — Advance</title>", `<title>Informe Gerencial — ${nombre}</title>`);

  mkdirSync(`clientes/${slug}`, { recursive: true });
  writeFileSync(`clientes/${slug}/index.html`, html);
  console.log(`[${slug}] OK · clientes/${slug}/index.html · unidades ${D.length} · con CAN ${conCan} · mes ${curMonth}`);
  if (anomalias.length) console.log(`[${slug}] días descartados por salto de contador: ${anomalias.join(' | ')}`);
  return { slug, nombre, units: D.length, conCan };
}

// ── Main: recorre todos los clientes detectados ──
const clients = discoverClients();
const slugs = Object.keys(clients);
if (!slugs.length) { console.error('ERROR: no se encontró ningún secret MAPON_<CLIENTE> (ni el heredado de Tepeyac).'); process.exit(1); }
console.log('Clientes detectados:', slugs.join(', '));
const template = readFileSync('index.html', 'utf8');
const results = [];
for (const slug of slugs) {
  try { results.push(await buildClient(slug, clients[slug], template)); }
  catch (e) { console.error(`[${slug}] FALLÓ: ${e.message}`); }
}
console.log('\nResumen:'); results.forEach(r => console.log(` · ${r.slug} (${r.nombre}): ${r.units} unidades, ${r.conCan} con CAN`));
if (!results.length) process.exit(1);

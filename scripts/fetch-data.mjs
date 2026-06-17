#!/usr/bin/env node
/**
 * Generador del Informe Gerencial de Flota — Concretos Técnicos de México
 *
 * Extrae datos en vivo de las APIs de Telematics Advance (plataforma Mapon)
 * y los agrega en `web/data.json`, que alimenta el informe ejecutivo
 * (web/index.html) con filtros interactivos de MES, SEMANA y PLANTA.
 *
 * Estructura de datos: por unidad se entrega un desglose POR DÍA, de modo que
 * el informe recalcula todos los KPIs en el navegador según el mes/semana/planta
 * seleccionados, sin necesidad de volver a llamar a la API.
 *
 * Endpoints disponibles con la API key actual:
 *   - company/get  → datos de la empresa
 *   - unit/list    → inventario de unidades, odómetro, estado, posición
 *   - route/list   → tramos (manejo / detención) por unidad y periodo (máx 31 días)
 *   - driver/list  → conductores
 *
 * División por PLANTA: la API no expone grupos de unidades con esta key, pero
 * cada camión de concreto regresa a su planta. Por ello la planta de cada unidad
 * se deriva de su "base dominante": la ubicación donde acumula más tiempo
 * detenido en el periodo. Las bases se agrupan por cercanía geográfica (≈1 km).
 *
 * Uso:
 *   MAPON_KEY=xxxx node scripts/fetch-data.mjs [--from YYYY-MM-DD] [--till YYYY-MM-DD]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'web');
const OUT_FILE = resolve(OUT_DIR, 'data.json');

const BASE = process.env.MAPON_BASE || 'https://portal.telematicsadvance.com.mx/api/v1';
const TZ = 'America/Monterrey';
const MAX_DAYS_PER_CALL = 28; // la API limita a 31 días por llamada

// Parámetros de negocio (editables también en el informe → sección Metodología)
const PARAMS = {
  precio_diesel_mxn: 25.0,
  consumo_norma_l100: 40.0,
  benchmark_kml: 2.5,
  consumo_ralenti_lh: 3.0,
  limite_velocidad_kmh: 90,
  costo_por_exceso_mxn: 150,
};

// ----------------------------------------------------------------------------
function getKey() {
  if (process.env.MAPON_KEY) return process.env.MAPON_KEY.trim();
  const local = resolve(ROOT, 'config.local.json');
  if (existsSync(local)) {
    try { const j = JSON.parse(readFileSync(local, 'utf8')); if (j.key) return String(j.key).trim(); } catch { /* */ }
  }
  console.error('ERROR: define MAPON_KEY=<api_key> o crea config.local.json con { "key": "..." }');
  process.exit(1);
}

function parseArgs() {
  const a = process.argv.slice(2); const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--from') out.from = a[++i];
    else if (a[i] === '--till') out.till = a[++i];
  }
  return out;
}

// Ventana por defecto: desde el inicio del mes anterior hasta ayer
// (cubre ≥2 meses y varias semanas para los conectores).
function defaultWindow() {
  const now = new Date();
  const till = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(from), till: fmt(till) };
}

const KEY = getKey();
const args = parseArgs();
const win = defaultWindow();
const FROM_DATE = args.from || win.from;
const TILL_DATE = args.till || win.till;

// ----------------------------------------------------------------------------
async function api(path, params = {}) {
  const url = new URL(`${BASE}/${path}.json`);
  url.searchParams.set('key', KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const json = await res.json();
  if (json.error) throw new Error(`API ${path}: [${json.error.code}] ${json.error.msg}`);
  return json.data;
}

// ----------------------------------------------------------------------------
const secondsBetween = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 1000);
const round = (n, d = 1) => { const p = 10 ** d; return Math.round((Number(n) + Number.EPSILON) * p) / p; };
const addDays = (date, n) => { const d = new Date(date); d.setUTCDate(d.getUTCDate() + n); return d; };
const ymd = (d) => d.toISOString().slice(0, 10);

const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (iso) => dayKeyFmt.format(new Date(iso));

// Divide [from,till] en tramos de <= MAX_DAYS_PER_CALL días
function chunkRange(fromDate, tillDate) {
  const chunks = [];
  let start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${tillDate}T00:00:00Z`);
  while (start <= end) {
    const stop = new Date(Math.min(addDays(start, MAX_DAYS_PER_CALL - 1).getTime(), end.getTime()));
    chunks.push({ from: `${ymd(start)}T00:00:00Z`, till: `${ymd(stop)}T23:59:59Z` });
    start = addDays(stop, 1);
  }
  return chunks;
}

// Estados (abreviaturas) usados para localizar el municipio en la dirección
const STATE_ABBR = new Set(['N.L.', 'Jal.', 'Coah.', 'Tamps.', 'S.L.P.', 'Gto.', 'Qro.', 'Méx.', 'Mex.', 'CDMX', 'Ver.', 'Coah', 'NL', 'Zac.', 'Dgo.', 'Chih.', 'Son.', 'Sin.', 'Ags.']);
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-/.])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
const stripPlus = (s) => s.replace(/^[A-Z0-9]{4,}\+[A-Z0-9]{2,}\s*/i, '');

// Municipio a partir de la dirección (penúltimo segmento antes del estado)
function muniFromAddr(addr) {
  if (!addr) return 'Base no determinada';
  let parts = addr.replace(/,?\s*Mexico\.?$/i, '').split(',').map((s) => s.trim()).filter(Boolean);
  let muni = parts[parts.length - 1] || '';
  if (STATE_ABBR.has(muni) && parts.length >= 2) muni = parts[parts.length - 2];
  muni = stripPlus(muni).replace(/^\d{4,5}\s+/, '').trim();  // quita plus-code y CP
  if (STATE_ABBR.has(muni) || muni.length < 2) muni = stripPlus(parts[0] || muni);
  muni = muni.replace(/^(Cdad\.?|Cd\.?)\s+/i, '').trim();    // "Cdad. Apodaca" → "Apodaca"
  return titleCase(muni);
}
// Calle / referencia del sitio (primer segmento, limpio)
function streetShort(addr) {
  if (!addr) return '';
  let s = addr.split(',')[0].trim();
  s = s.replace(/^[A-Z0-9]{4,}\+[A-Z0-9]{2,}\s*/i, '');     // quita plus-code (ej. "JV6M+QP")
  s = s.replace(/^DB\s+/i, '');                             // prefijo de POI
  s = s.replace(/\s+\d+[A-Z]?$/i, '');                      // quita número exterior final
  return titleCase(s).slice(0, 26).trim();
}
// Distancia aproximada en metros entre dos coordenadas
function distM(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const lat1 = a.lat * toR, lat2 = b.lat * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ----------------------------------------------------------------------------
async function main() {
  console.error(`→ Extrayendo datos ${FROM_DATE} … ${TILL_DATE}`);
  const [companyData, unitData, driverData] = await Promise.all([
    api('company/get').catch(() => null),
    api('unit/list'),
    api('driver/list').catch(() => ({ drivers: [] })),
  ]);
  const company = companyData?.companies?.[0] || { name: 'Flota' };
  const units = unitData.units;
  const drivers = driverData.drivers || [];
  console.error(`  ${units.length} unidades, ${drivers.length} conductores`);

  // route/list por tramos (máx 31 días) → fusionar rutas por unidad
  const chunks = chunkRange(FROM_DATE, TILL_DATE);
  console.error(`  ${chunks.length} llamada(s) a route/list`);
  const routesByUnit = new Map();
  for (const c of chunks) {
    const rd = await api('route/list', { from: c.from, till: c.till });
    for (const u of rd.units) {
      if (!routesByUnit.has(u.unit_id)) routesByUnit.set(u.unit_id, []);
      routesByUnit.get(u.unit_id).push(...(u.routes || []));
    }
  }

  // ---- Agregación por unidad y por día + base dominante ----
  const periodEnd = new Date(`${TILL_DATE}T23:59:59Z`);
  const unitsOut = [];
  const baseAccumGlobal = []; // para clustering de plantas

  for (const u of units) {
    const routes = routesByUnit.get(u.unit_id) || [];
    const days = {};
    const baseDur = new Map(); // address → { sec, lat, lng }

    const ensureDay = (k) => (days[k] || (days[k] = { dist_m: 0, drive_s: 0, stop_s: 0, segs: 0, stops: 0, viol: 0, maxspeed: 0 }));

    for (const r of routes) {
      const dur = secondsBetween(r.start.time, r.end.time);
      const k = dayKey(r.start.time);
      const day = ensureDay(k);
      if (r.type === 'route') {
        day.dist_m += r.distance || 0;
        day.drive_s += dur;
        day.segs += 1;
        const spd = r.avg_speed || 0;
        if (spd > day.maxspeed) day.maxspeed = spd;
        if (spd > PARAMS.limite_velocidad_kmh) day.viol += 1;
      } else if (r.type === 'stop') {
        day.stop_s += dur;
        day.stops += 1;
        const a = r.start.address || 'Base';
        const acc = baseDur.get(a) || { sec: 0, lat: r.start.lat, lng: r.start.lng };
        acc.sec += dur; baseDur.set(a, acc);
      }
    }

    // Base dominante de la unidad
    let base = null;
    for (const [addr, acc] of baseDur) {
      if (!base || acc.sec > base.sec) base = { addr, ...acc };
    }
    const stale = (periodEnd - new Date(u.last_update)) / 1000 > 86400;

    const uo = {
      unit_id: u.unit_id, label: u.label, number: u.number,
      make: u.make, model: u.model, icon: u.icon,
      odometer_km: round(u.mileage / 1000, 0), last_update: u.last_update, stale,
      base: base ? { addr: base.addr, lat: base.lat, lng: base.lng } : null,
      days,
    };
    unitsOut.push(uo);
    if (base) baseAccumGlobal.push({ uo, base });
  }

  // ---- Clustering de bases → plantas (greedy por distancia ≤ 1.2 km) ----
  const CLUSTER_RADIUS_M = 1200;
  const clusterList = []; // { lat, lng, addrs:Map, units:[] }
  for (const { uo, base } of baseAccumGlobal.sort((a, b) => b.base.sec - a.base.sec)) {
    let cl = null;
    for (const c of clusterList) { if (distM(c, base) <= CLUSTER_RADIUS_M) { cl = c; break; } }
    if (!cl) { cl = { lat: base.lat, lng: base.lng, addrs: new Map(), units: [] }; clusterList.push(cl); }
    cl.units.push(uo);
    cl.addrs.set(base.addr, (cl.addrs.get(base.addr) || 0) + 1);
  }

  // Nombre de planta: "Municipio — Calle" (único y legible)
  const plants = [];
  let pid = 0;
  const nameSeen = new Map();
  for (const cl of clusterList.sort((a, b) => b.units.length - a.units.length)) {
    const topAddr = [...cl.addrs.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const city = muniFromAddr(topAddr);
    const site = streetShort(topAddr);
    const lc = city.toLowerCase(), ls = site.toLowerCase();
    let name = (!site || lc.includes(ls) || ls.includes(lc)) ? city : `${city} — ${site}`;
    if (nameSeen.has(name)) { nameSeen.set(name, nameSeen.get(name) + 1); name = `${name} (${nameSeen.get(name)})`; } else nameSeen.set(name, 1);
    const id = `P${++pid}`;
    plants.push({ id, name, city, site, lat: round(cl.lat, 5), lng: round(cl.lng, 5), addr: topAddr, unit_count: cl.units.length });
    for (const uo of cl.units) { uo.plant_id = id; uo.plant = name; }
  }
  // Unidades sin base
  const noBase = unitsOut.filter((u) => !u.plant_id);
  if (noBase.length) {
    const id = `P${++pid}`;
    plants.push({ id, name: 'Sin base definida', city: '', site: '', lat: null, lng: null, addr: '', unit_count: noBase.length });
    for (const uo of noBase) { uo.plant_id = id; uo.plant = 'Sin base definida'; }
  }
  console.error(`  ${plants.length} plantas detectadas: ${plants.map((p) => `${p.name} (${p.unit_count})`).join(', ')}`);

  // ---- Catálogo de MESES y SEMANAS presentes en el rango ----
  const allDays = [];
  for (let d = new Date(`${FROM_DATE}T12:00:00Z`); ymd(d) <= TILL_DATE; d = addDays(d, 1)) {
    allDays.push(dayKey(d.toISOString()));
  }
  const uniqDays = [...new Set(allDays)].sort();

  const monthFmt = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, month: 'long', year: 'numeric' });
  const isoWeek = (k) => {
    const d = new Date(`${k}T12:00:00Z`);
    const t = new Date(d); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const yStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const wk = Math.ceil(((t - yStart) / 86400000 + 1) / 7);
    return { year: t.getUTCFullYear(), week: wk };
  };
  const dayShort = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, day: 'numeric', month: 'short' });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const months = new Map();
  for (const k of uniqDays) {
    const mId = k.slice(0, 7);
    if (!months.has(mId)) months.set(mId, { id: mId, label: cap(monthFmt.format(new Date(`${k}T12:00:00Z`))), days: [], weeksMap: new Map() });
    const m = months.get(mId);
    m.days.push(k);
    const w = isoWeek(k);
    const wId = `${w.year}-W${String(w.week).padStart(2, '0')}`;
    if (!m.weeksMap.has(wId)) m.weeksMap.set(wId, []);
    m.weeksMap.get(wId).push(k);
  }
  const monthsOut = [...months.values()].map((m) => ({
    id: m.id, label: m.label, days: m.days,
    weeks: [...m.weeksMap.entries()].map(([wId, days]) => ({
      id: wId,
      label: `${dayShort.format(new Date(`${days[0]}T12:00:00Z`))} – ${dayShort.format(new Date(`${days[days.length - 1]}T12:00:00Z`))}`,
      days,
    })),
  }));

  const result = {
    meta: {
      generated_at: new Date().toISOString(),
      company: company.name,
      timezone: TZ,
      range: { from: FROM_DATE, till: TILL_DATE },
      source: 'Telematics Advance (Mapon API) — portal.telematicsadvance.com.mx',
      params: PARAMS,
      naturaleza_datos: {
        medido: ['Distancia (GPS)', 'Tiempo de manejo', 'Tiempo de detención', 'Tramos / paradas', 'Velocidad promedio por tramo', 'Odómetro', 'Base / planta (ubicación dominante)'],
        estimado: ['Combustible (norma l/100km)', 'Eficiencia km/L', 'Consumo en ralentí', 'Costos de monetización'],
        nota: 'El combustible y la eficiencia se estiman con una norma de consumo configurable. La planta se deriva de la base operativa dominante de cada unidad (GPS). La telemetría CAN/combustible real y la velocidad instantánea requieren ampliar los permisos de la API key.',
      },
      months: monthsOut,
    },
    plants,
    drivers: drivers.map((d) => ({ id: d.id, name: `${d.name} ${d.surname}`.trim(), phone: d.phone, ibutton: d.ibutton })),
    units: unitsOut.map((u) => {
      // redondear días para reducir tamaño
      const days = {};
      for (const [k, v] of Object.entries(u.days)) {
        days[k] = { dist_km: round(v.dist_m / 1000, 2), drive_h: round(v.drive_s / 3600, 2), stop_h: round(v.stop_s / 3600, 2), segs: v.segs, stops: v.stops, viol: v.viol, maxspeed: Math.round(v.maxspeed) };
      }
      return {
        unit_id: u.unit_id, label: u.label, number: u.number, make: u.make, model: u.model, icon: u.icon,
        odometer_km: u.odometer_km, last_update: u.last_update, stale: u.stale,
        plant_id: u.plant_id, plant: u.plant, base_addr: u.base?.addr || null,
        days,
      };
    }),
  };

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(result));
  const totalKm = unitsOut.reduce((s, u) => s + Object.values(u.days).reduce((a, d) => a + d.dist_m, 0), 0) / 1000;
  console.error(`✔ Generado ${OUT_FILE}`);
  console.error(`  Rango: ${FROM_DATE}…${TILL_DATE} · ${monthsOut.length} mes(es) · ${totalKm.toFixed(0)} km totales · ${plants.length} plantas`);
}

main().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });

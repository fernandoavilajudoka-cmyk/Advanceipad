// scripts/build-history.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Historico MENSUAL por unidad. El informe principal (build-report.mjs) solo
// cubre la ventana movil de 30 dias que permite una consulta; aqui se recorre
// mes por mes hacia atras y se acumula el detalle de cada unidad.
//
//   node scripts/build-history.mjs            → todos los clientes MAPON_*
//   MESES=6 node scripts/build-history.mjs    → limita a los ultimos N meses
//
// Salida: clientes/<slug>/historico.json  (dataset)
//         clientes/<slug>/historico.html   (vista, la genera build-history-view)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://portal.smart-connect.com.mx/api/v1';
const INICIO = '2025-10';          // primer mes con datos en la plataforma
const CONCURRENCIA = 4;            // peticiones simultaneas por cliente
const MAX_KM_DIA = 2500, MAX_L_DIA = 1200, MAX_H_DIA = 24;

let CLIENTS = {};
try { CLIENTS = JSON.parse(readFileSync('clientes.json', 'utf8')); } catch (e) {}

function discoverClients() {
  let env = process.env;
  if (process.env.ALL_SECRETS) { try { env = { ...process.env, ...JSON.parse(process.env.ALL_SECRETS) }; } catch (e) {} }
  const out = {};
  for (const name in env) {
    const m = /^MAPON_(.+)$/.exec(name);
    if (m && env[name] && String(env[name]).length > 10) out[m[1].toLowerCase()] = env[name];
  }
  if (!out['tepeyac']) { const l = env.FETILIZANTESTEPEYAC || env.FERTILIZANTESTEPEYAC; if (l) out['tepeyac'] = l; }
  return out;
}

async function api(KEY, method, params = {}, reintentos = 3) {
  const u = new URL(BASE + '/' + method);
  u.searchParams.set('key', KEY);
  for (const k in params) u.searchParams.set(k, params[k]);
  for (let i = 0; i < reintentos; i++) {
    try { const r = await fetch(u); return await r.json(); }
    catch (e) { if (i === reintentos - 1) throw e; await new Promise(r => setTimeout(r, 400 * (i + 1))); }
  }
}
const dur = (a, b) => (new Date(b) - new Date(a)) / 3600000;
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
const esVin = s => /^[A-Z0-9]{15,20}$/i.test(s);

// Mismo criterio que el informe: se descartan saltos de contador imposibles.
function sumaDelta(arr, maxPorDia) {
  const byDate = {}; for (const p of arr || []) { const d = p.gmt.slice(0, 10); byDate[d] = Math.max(byDate[d] ?? -Infinity, p.value); }
  const ds = Object.keys(byDate).sort(); let prev = null, tot = 0, desc = 0;
  for (const d of ds) {
    if (prev != null) { const delta = Math.max(0, byDate[d] - prev); if (delta <= maxPorDia) tot += delta; else desc++; }
    prev = byDate[d];
  }
  return { tot, desc };
}

function listaMeses(desde, hasta) {
  const out = []; let [y, m] = desde.split('-').map(Number);
  const [hy, hm] = hasta.split('-').map(Number);
  while (y < hy || (y === hy && m <= hm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
const finDeMes = ym => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

// Ejecuta tareas con concurrencia limitada: la API responde mal a rafagas grandes.
async function enLotes(items, fn, n = CONCURRENCIA) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function alertasDelMes(KEY, FROM, TILL) {
  const seen = new Map();
  for (let page = 1; page <= 300; page++) {
    let j; try { j = await api(KEY, 'alert/list.json', { from: FROM, till: TILL, limit: 100, page }); } catch (e) { break; }
    const A = Array.isArray(j.data) ? j.data : [];
    for (const a of A) seen.set(`${a.unit_id}|${a.time}|${a.alert_type}`, a);
    if (A.length < 100) break;
  }
  return [...seen.values()];
}
const EV_MAP = { speeding: 'exces', jammer_detection_event: 'jammer', fuel_change: 'drain', no_power: 'power', battery_level: 'power', switch: 'power' };

async function historicoCliente(slug, KEY) {
  const cfgC = CLIENTS[slug] || {};
  const nombre = cfgC.nombre || slug;
  const hoy = new Date().toISOString().slice(0, 7);
  let meses = listaMeses(INICIO, hoy);
  if (process.env.MESES) meses = meses.slice(-Number(process.env.MESES));

  const units = (await api(KEY, 'unit/list.json')).data?.units || [];
  console.log(`[${slug}] ${units.length} unidades · ${meses.length} meses (${meses[0]} → ${meses[meses.length - 1]})`);

  const U = units.map(u => ({
    id: u.unit_id,
    number: u.number || u.vin || String(u.unit_id),
    vin: norm(u.vin),
    make: norm(u.make),
    model: norm(u.model),
    label: esVin(norm(u.label)) ? 'Sin modelo asignado' : norm(u.label),
    alta: (u.created_at || '').slice(0, 10),
    ultimo: (u.last_update || '').slice(0, 10),
    porMes: {},
  }));
  const porId = Object.fromEntries(U.map(u => [u.id, u]));
  const resumenMes = {};

  for (const ym of meses) {
    const desde = ym + '-01', hasta = finDeMes(ym);
    const FROM = desde + 'T00:00:00Z', TILL = hasta + 'T23:59:59Z';

    // Eventos del mes: vienen por cuenta, se reparten por unidad.
    const alerts = await alertasDelMes(KEY, FROM, TILL);
    const ev = {};
    for (const a of alerts) {
      const k = EV_MAP[a.alert_type]; if (!k) continue;
      let val = {}; try { val = JSON.parse(a.alert_val || '{}'); } catch (e) {}
      if (k === 'drain' && !val.is_drain) continue;
      if (k === 'jammer' && val.is_jamming === false) continue;
      const c = ev[a.unit_id] = ev[a.unit_id] || { exces: 0, jammer: 0, drain: 0, drainL: 0, power: 0, vmaxEv: 0 };
      c[k]++;
      if (k === 'drain') c.drainL += +val.volume || 0;
      if (k === 'exces' && +val.speed > c.vmaxEv) c.vmaxEv = +val.speed;
    }

    await enLotes(U, async u => {
      // Unidad dada de alta despues del mes: no se consulta.
      if (u.alta && u.alta > hasta) return;
      const [can, rut] = await Promise.all([
        api(KEY, 'unit_data/can_period.json', { unit_id: u.id, from: FROM, till: TILL }).catch(() => null),
        api(KEY, 'route/list.json', { from: FROM, till: TILL, unit_id: u.id }).catch(() => null),
      ]);
      const cu = can?.data?.units?.[0] || {};
      const km = sumaDelta(cu.total_distance, MAX_KM_DIA);
      const l = sumaDelta(cu.total_fuel, MAX_L_DIA);
      const h = sumaDelta(cu.total_engine_hours, MAX_H_DIA);

      let drive = 0, night = 0, vmax = 0, tramos = 0;
      for (const r of (rut?.data?.units?.[0]?.routes || [])) {
        if (r.type !== 'route' || !r.start?.time || !r.end?.time) continue;
        const d = dur(r.start.time, r.end.time);
        drive += d; tramos++;
        if ((r.max_speed || 0) > vmax) vmax = r.max_speed;
        const hl = (new Date(r.start.time).getUTCHours() + 18) % 24;   // hora local MX
        if (hl >= 22 || hl < 6) night += d;
      }
      const e = ev[u.id] || { exces: 0, jammer: 0, drain: 0, drainL: 0, power: 0, vmaxEv: 0 };
      const motor = h.tot, manejo = Math.min(motor || Infinity, drive), ralenti = Math.max(0, motor - manejo);
      if (km.tot < 1 && !tramos && !e.exces && !e.drain) return;      // mes sin actividad

      u.porMes[ym] = {
        km: +km.tot.toFixed(1), l: +l.tot.toFixed(1), motor: +motor.toFixed(1),
        manejo: +manejo.toFixed(1), ralenti: +ralenti.toFixed(1), nocturno: +Math.min(night, manejo).toFixed(1),
        vmax: Math.max(vmax, e.vmaxEv), tramos,
        exces: e.exces, drain: e.drain, drainL: Math.round(e.drainL), jammer: e.jammer, power: e.power,
        desc: km.desc,
      };
    });

    const filas = U.map(u => u.porMes[ym]).filter(Boolean);
    const s = k => filas.reduce((a, b) => a + (b[k] || 0), 0);
    resumenMes[ym] = {
      activas: filas.length, km: Math.round(s('km')), l: Math.round(s('l')),
      motor: Math.round(s('motor')), manejo: Math.round(s('manejo')), ralenti: Math.round(s('ralenti')),
      nocturno: Math.round(s('nocturno')), vmax: Math.max(0, ...filas.map(f => f.vmax)),
      exces: s('exces'), drain: s('drain'), drainL: s('drainL'), jammer: s('jammer'), power: s('power'),
    };
    const r = resumenMes[ym];
    console.log(`  ${ym}: ${String(r.activas).padStart(2)} activas · ${String(r.km).padStart(7)} km · ${String(r.l).padStart(6)} L · ${r.l ? (r.km / r.l).toFixed(2) : '—'} km/L · ${r.exces} excesos · ${r.drain} drenajes`);
  }

  const out = {
    cliente: nombre, slug, generado: new Date().toISOString(),
    meses: meses.filter(m => resumenMes[m]),
    resumenMes,
    unidades: U.filter(u => Object.keys(u.porMes).length).sort((a, b) => (a.number > b.number ? 1 : -1)),
    sinDatos: U.filter(u => !Object.keys(u.porMes).length).map(u => ({ number: u.number, label: u.label, ultimo: u.ultimo })),
  };
  mkdirSync(`clientes/${slug}`, { recursive: true });
  writeFileSync(`clientes/${slug}/historico.json`, JSON.stringify(out));
  console.log(`[${slug}] OK · clientes/${slug}/historico.json · ${out.unidades.length} unidades con historia · ${out.meses.length} meses`);
  return out;
}

const clients = discoverClients();
if (!Object.keys(clients).length) { console.error('ERROR: no hay secrets MAPON_<CLIENTE>.'); process.exit(1); }
for (const slug in clients) {
  try { await historicoCliente(slug, clients[slug]); }
  catch (e) { console.error(`[${slug}] FALLO: ${e.message}`); }
}

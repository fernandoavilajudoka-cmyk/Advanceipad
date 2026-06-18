/* ============================================================
   Informe Gerencial de Flota — renderizador
   Lee data.json (generado desde las APIs de Telematics Advance),
   y construye el informe ejecutivo con filtros interactivos de
   MES, SEMANA y PLANTA. Todos los KPIs se recalculan en el
   navegador a partir del desglose por unidad/día.
   ============================================================ */
'use strict';

const nf = new Intl.NumberFormat('es-MX');
const nf1 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
const money = (n) => '$' + new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(Math.round(n || 0));
const price = (n) => '$' + new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const dateLabel = (s) => new Date(s + 'T12:00:00Z').toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
const weekdayOf = (s) => new Date(s + 'T12:00:00Z').toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '');

const C = { lime: '#b6d400', limeDeep: '#5d6f00', cyan: '#b6d400', gold: '#f5b81c', green: '#2ea068', orange: '#e8870c', red: '#e0413e', muted: '#5f6873', ink: '#14181d' };
const ratingColor = { verde: C.green, naranja: C.gold, rojo: C.red };
const CLIENT_LOGO = 'assets/concretos-tecnicos.png';
const round = (n, d = 1) => { const p = 10 ** d; return Math.round((Number(n) + Number.EPSILON) * p) / p; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

let DATA = null;
const charts = {};

/* ===== Modelo predictivo: probabilidad de accidente =====================
   Índice 0–100 (heurístico, ponderado) que combina comportamiento telemático
   con el riesgo regional de INEGI. NL es la entidad #1 nacional en accidentes
   (≈20% del país); por municipio (INEGI/ZMM): Monterrey ~38%, Guadalupe ~14%,
   Apodaca ~8%, San Nicolás ~7%, Escobedo en aumento.                         */
// Umbrales (calibración laxa, generalizable a toda la cartera de clientes):
// una operación sana cae en verde; solo comportamiento claramente riesgoso sube.
const riskLevel = (r) => (r >= 70 ? 'Alta' : r >= 45 ? 'Media' : 'Baja');
const riskRating = (r) => (r >= 70 ? 'rojo' : r >= 45 ? 'naranja' : 'verde');
const MUNI_RISK = {
  'Monterrey': 1.0, 'Guadalupe': 0.85, 'Apodaca': 0.72, 'General Escobedo': 0.70,
  'San Nicolás de los Garza': 0.65, 'García': 0.65, 'Juárez': 0.50, 'Santiago': 0.30,
  'El Salto': 0.60, 'Atotonilco el Alto': 0.40,
};
const ACC_W = { velocidad: 0.25, fatiga: 0.20, regional: 0.15, nocturna: 0.15, eventos: 0.15, exposicion: 0.10 };
function accidentRisk(u) {
  const v = clamp((u.max_speed - 40) / 45, 0, 1);            // velocidades altas (vel. prom. de tramo)
  const s = clamp(u.vp100 / 3, 0, 1);                        // eventos de seguridad /100 km
  const f = clamp(u.fatigue / 3, 0, 1);                      // fatiga: tramos > 6 h
  const n = clamp(u.nightPct / 40, 0, 1);                    // conducción nocturna
  const r = MUNI_RISK[u.plant] ?? 0.5;                       // riesgo regional INEGI
  const e = clamp(u.distance_km / 800, 0, 1);                // exposición (km recorridos)
  const risk = Math.round(100 * (ACC_W.velocidad * v + ACC_W.fatiga * f + ACC_W.regional * r + ACC_W.nocturna * n + ACC_W.eventos * s + ACC_W.exposicion * e));
  return { risk, level: riskLevel(risk), rating: riskRating(risk), factors: { velocidad: Math.round(v * 100), fatiga: Math.round(f * 100), regional: Math.round(r * 100), nocturna: Math.round(n * 100), eventos: Math.round(s * 100), exposicion: Math.round(e * 100) } };
}

/* ===== Modelo predictivo: probabilidad de robo ==========================
   Índice 0–100. Robo de vehículo NL 2024 (SESNSP): Monterrey 441, Juárez
   277, Guadalupe 265, Apodaca 139, Escobedo 118, San Nicolás 71. Robo al
   autotransporte (ANIQ/ANERPV): 55% ocurre 18:00–06:00 (pico 03:00–07:00);
   83% lunes–viernes (martes 23%, miércoles 20%). Marca/modelo: la flota es
   FOTON revolvedora (vehículo especializado, bajo valor de reventa → menor
   blanco de robo); factor uniforme.                                        */
const THEFT_RISK = {
  'Monterrey': 1.0, 'Juárez': 0.63, 'Guadalupe': 0.60, 'Apodaca': 0.32, 'García': 0.29,
  'General Escobedo': 0.27, 'San Nicolás de los Garza': 0.16, 'Santiago': 0.10,
  'El Salto': 0.45, 'Atotonilco el Alto': 0.18,
};
const BRAND_RISK = 0.25; // FOTON revolvedora: especializada, bajo target de reventa
const DOW_THEFT = [0.35, 0.57, 1.0, 0.87, 0.57, 0.61, 0.39]; // Dom..Sáb (martes pico)
const THEFT_W = { regional: 0.30, descargas: 0.20, nocturna: 0.15, dia_semana: 0.10, marca: 0.10, sin_senal: 0.15 };
function theftRisk(u) {
  const r = THEFT_RISK[u.plant] ?? 0.30;                     // robo de vehículo por municipio (SESNSP)
  const d = clamp(u.drain_n / 4, 0, 1);                      // descargas de diésel detectadas (laxo: requiere varios eventos)
  const n = clamp(u.nightPct / 40, 0, 1);                    // exposición horaria nocturna (18:00–06:00)
  const w = clamp(u.weekdayRisk, 0, 1);                      // día de la semana de mayor robo
  const m = BRAND_RISK;                                      // marca/modelo (uniforme)
  const g = u.stale ? 1 : 0;                                 // pérdida de señal GPS (unidad sin reportar)
  const risk = Math.round(100 * (THEFT_W.regional * r + THEFT_W.descargas * d + THEFT_W.nocturna * n + THEFT_W.dia_semana * w + THEFT_W.marca * m + THEFT_W.sin_senal * g));
  return { risk, level: riskLevel(risk), rating: riskRating(risk), factors: { regional: Math.round(r * 100), descargas: Math.round(d * 100), nocturna: Math.round(n * 100), dia: Math.round(w * 100), marca: Math.round(m * 100), senal: g * 100 } };
}
const STATE = { monthId: null, weekId: 'all', plantId: 'all', params: null, boardSort: { key: 'distance_km', dir: 'desc' } };

async function boot() {
  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    DATA = await res.json();
  } catch (e) {
    document.getElementById('deck').innerHTML =
      '<div class="slide"><h2>No se pudo cargar data.json</h2><p>Ejecuta el generador: <code>node scripts/fetch-data.mjs</code></p></div>';
    return;
  }
  STATE.params = { ...DATA.meta.params };
  const months = DATA.meta.months;
  STATE.monthId = months[months.length - 1].id; // mes más reciente
  buildFilters();
  render();
}

function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Nombre de planta a una sola palabra (quita genéricos: General, El, Ciudad…)
function shortPlant(name) {
  if (!name) return name;
  const drop = new Set(['general', 'gral', 'cd', 'ciudad', 'villa', 'el', 'la', 'los', 'las', 'de', 'del', 'heroica']);
  let w = name.split(/\s+/).filter(Boolean);
  while (w.length > 1 && drop.has(w[0].toLowerCase().replace(/\./g, ''))) w.shift();
  if (w.length > 1 && ['san', 'santa', 'santo'].includes(w[0].toLowerCase())) return w[1];
  return w[0];
}

/* ============================ FILTROS ============================ */
function currentMonth() { return DATA.meta.months.find((m) => m.id === STATE.monthId) || DATA.meta.months[0]; }
function scopeDays() {
  const m = currentMonth();
  if (STATE.weekId === 'all') return new Set(m.days);
  const w = m.weeks.find((w) => w.id === STATE.weekId);
  return new Set(w ? w.days : m.days);
}
function scopeLabel() {
  const m = currentMonth();
  if (STATE.weekId === 'all') return m.label;
  const w = m.weeks.find((w) => w.id === STATE.weekId);
  return w ? `Semana ${w.label}` : m.label;
}
function plantLabel() {
  if (STATE.plantId === 'all') return 'Todas las plantas';
  const p = DATA.plants.find((p) => p.id === STATE.plantId);
  return p ? shortPlant(p.name) : 'Todas las plantas';
}

function buildFilters() {
  const bar = document.getElementById('filters');
  const monthOpts = DATA.meta.months.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
  const plantOpts = `<option value="all">Todas las plantas (${DATA.units.length})</option>` +
    DATA.plants.map((p) => `<option value="${p.id}">${esc(shortPlant(p.name))} · ${p.unit_count}</option>`).join('');
  bar.innerHTML = `
    <div class="f-group"><label>Mes</label><select id="selMonth">${monthOpts}</select></div>
    <div class="f-group"><label>Semana</label><select id="selWeek"></select></div>
    <div class="f-group"><label>Planta</label><select id="selPlant">${plantOpts}</select></div>
    <div class="f-spacer"></div>
    <div class="f-tag" id="fTag"></div>`;
  document.getElementById('selMonth').value = STATE.monthId;
  populateWeeks();
  document.getElementById('selMonth').addEventListener('change', (e) => { STATE.monthId = e.target.value; STATE.weekId = 'all'; populateWeeks(); render(); });
  document.getElementById('selWeek').addEventListener('change', (e) => { STATE.weekId = e.target.value; render(); });
  document.getElementById('selPlant').addEventListener('change', (e) => { STATE.plantId = e.target.value; render(); });
}
function populateWeeks() {
  const sel = document.getElementById('selWeek');
  const m = currentMonth();
  sel.innerHTML = `<option value="all">Todo el mes</option>` +
    m.weeks.map((w) => `<option value="${w.id}">${w.label}</option>`).join('');
  sel.value = STATE.weekId;
}

/* ========================= AGREGACIÓN ========================= */
function aggregate() {
  const days = scopeDays();
  const p = STATE.params;
  const units = DATA.units.filter((u) => STATE.plantId === 'all' || u.plant_id === STATE.plantId);
  const sortedDays = [...days].sort();

  const perUnit = [];
  let f = { distance_km: 0, drive_h: 0, stop_h: 0, segs: 0, stops: 0, viol: 0, maxspeed: 0, fuel_l: 0, active: 0, no_signal: 0,
    real_fuel_l: 0, idle_fuel_l: 0, idle_h: 0, rf_l: 0, rf_n: 0, dr_l: 0, dr_n: 0, sensors: 0 };
  const secHours = new Array(24).fill(0), secDow = new Array(7).fill(0), secBands = { b40: 0, b50: 0, b60: 0 };

  for (const u of units) {
    let dist = 0, drive = 0, stop = 0, segs = 0, stops = 0, viol = 0, mx = 0;
    let rfL = 0, rfN = 0, drL = 0, drN = 0, nightH = 0, fatigue = 0, dowW = 0, ev40 = 0, ev50 = 0, ev60 = 0;
    for (const k of sortedDays) {
      const d = u.days[k]; if (!d) continue;
      dist += d.dist_km; drive += d.drive_h; stop += d.stop_h; segs += d.segs; stops += d.stops; viol += d.viol;
      if (d.maxspeed > mx) mx = d.maxspeed;
      rfL += d.rf_l || 0; rfN += d.rf_n || 0; drL += d.dr_l || 0; drN += d.dr_n || 0;
      nightH += d.night_h || 0; fatigue += d.fatigue || 0;
      dowW += (d.dist_km || 0) * DOW_THEFT[new Date(k + 'T12:00:00Z').getUTCDay()];   // exposición por día de semana
      ev40 += d.ev_b40 || 0; ev50 += d.ev_b50 || 0; ev60 += d.ev_b60 || 0;
      if (d.ev_h) { const dw = new Date(k + 'T12:00:00Z').getUTCDay(); for (const h in d.ev_h) { secHours[+h] += d.ev_h[h]; secDow[dw] += d.ev_h[h]; } }
    }
    secBands.b40 += ev40; secBands.b50 += ev50; secBands.b60 += ev60;
    const secEvents = ev40 + ev50 + ev60;
    const weekdayRisk = dist > 0 ? dowW / dist : 0;
    const fuel = dist * p.consumo_norma_l100 / 100;            // estimado (norma configurable)
    const realFuel = (u.real_l100 != null) ? dist * u.real_l100 / 100 : null; // real (flujo/sensor)
    const realEff = (realFuel && realFuel > 0) ? dist / realFuel : null;
    // Ralentí = consumo real − consumo en movimiento (siempre ≤ total real)
    const idleFuel = (realFuel != null) ? Math.max(0, realFuel - dist * p.consumo_ruta_l100 / 100) : null;
    // Horas de ralentí (motor encendido detenido): no pueden exceder el tiempo detenido medido
    const idleHours = (idleFuel != null && p.consumo_ralenti_lh > 0) ? Math.min(stop, idleFuel / p.consumo_ralenti_lh) : null;
    const idlePctFuel = (realFuel && realFuel > 0 && idleFuel != null) ? idleFuel / realFuel * 100 : 0;
    const eff = fuel > 0 ? dist / fuel : 0;
    const vp100 = dist > 0 ? viol / dist * 100 : 0;
    const totalT = drive + stop;
    const moveRatio = totalT > 0 ? drive / totalT : 0;
    const sec = clamp(100 - (vp100 / 3) * 100, 0, 100);
    const effScore = clamp((eff / p.benchmark_kml) * 100, 0, 100);
    const idleScore = clamp(moveRatio * 100, 0, 100);
    const score = Math.round(sec * 0.4 + effScore * 0.3 + idleScore * 0.3);
    const rating = score >= 65 ? 'verde' : score >= 45 ? 'naranja' : 'rojo';
    const nightPct = drive > 0 ? nightH / drive * 100 : 0;
    const acc = accidentRisk({ max_speed: mx, vp100, fatigue, nightPct, plant: u.plant, distance_km: dist });
    const theft = theftRisk({ plant: u.plant, drain_n: drN, nightPct, weekdayRisk, stale: u.stale });

    perUnit.push({
      unit_id: u.unit_id, number: u.number, label: u.label, plant: u.plant, plant_id: u.plant_id,
      odometer_km: u.odometer_km, stale: u.stale,
      night_hours: round(nightH, 1), night_pct: round(nightPct, 1), fatigue_events: fatigue,
      acc_risk: acc.risk, acc_level: acc.level, acc_rating: acc.rating, acc_factors: acc.factors,
      theft_risk: theft.risk, theft_level: theft.level, theft_rating: theft.rating, theft_factors: theft.factors,
      sec_events: secEvents, sec_ev60: ev60, sec_per100: round(dist > 0 ? secEvents / dist * 100 : 0, 2),
      distance_km: round(dist, 1), drive_hours: round(drive, 1), stop_hours: round(stop, 1),
      segments: segs, stops, fuel_l: round(fuel, 1), efficiency_kml: round(eff, 2),
      real_l100: u.real_l100, real_fuel_l: realFuel != null ? round(realFuel, 1) : null,
      real_efficiency_kml: realEff != null ? round(realEff, 2) : null, has_fuel_sensor: !!u.has_fuel_sensor,
      idle_fuel_l: idleFuel != null ? round(idleFuel, 1) : null, idle_hours: idleHours != null ? round(idleHours, 1) : null,
      idle_pct_fuel: round(idlePctFuel, 1),
      refuel_l: Math.round(rfL), refuel_n: rfN, drain_l: Math.round(drL), drain_n: drN,
      max_speed: Math.round(mx), violations: viol, violations_per_100km: round(vp100, 2),
      move_ratio: round(moveRatio * 100, 1),
      score, score_breakdown: { seguridad: Math.round(sec), eficiencia: Math.round(effScore), actividad: Math.round(idleScore) }, rating,
    });

    f.distance_km += dist; f.drive_h += drive; f.stop_h += stop; f.segs += segs; f.stops += stops; f.viol += viol;
    f.fuel_l += fuel; if (mx > f.maxspeed) f.maxspeed = mx;
    if (realFuel != null) f.real_fuel_l += realFuel;
    if (idleFuel != null) f.idle_fuel_l += idleFuel;
    if (idleHours != null) f.idle_h += idleHours;
    if (u.has_fuel_sensor) f.sensors += 1;
    f.rf_l += rfL; f.rf_n += rfN; f.dr_l += drL; f.dr_n += drN;
    if (dist > 0.1) f.active += 1;
    if (u.stale) f.no_signal += 1;
  }

  // Serie diaria (suma sobre unidades filtradas) con rendimiento real por día
  const daily = sortedDays.map((k) => {
    let dist = 0, drive = 0, stop = 0, viol = 0, realFuel = 0;
    for (const u of units) {
      const d = u.days[k]; if (!d) continue;
      dist += d.dist_km; drive += d.drive_h; stop += d.stop_h; viol += d.viol;
      if (u.real_l100 != null) realFuel += d.dist_km * u.real_l100 / 100;
    }
    return { date: k, weekday: weekdayOf(k), distance_km: round(dist, 1), drive_hours: round(drive, 1), stop_hours: round(stop, 1), violations: viol,
      real_fuel_l: round(realFuel, 1), efficiency_kml: realFuel > 0 ? round(dist / realFuel, 2) : 0 };
  });

  const km = f.distance_km, driveH = f.drive_h, stopH = f.stop_h;
  const eff = f.fuel_l > 0 ? km / f.fuel_l : 0;
  const realEffFleet = f.real_fuel_l > 0 ? km / f.real_fuel_l : 0;
  const idleCost = f.idle_fuel_l * p.precio_diesel_mxn;
  const idleHoursFleet = f.idle_h;   // suma de horas por unidad (cada una topada al tiempo detenido)
  const accAvg = perUnit.length ? Math.round(perUnit.reduce((a, u) => a + u.acc_risk, 0) / perUnit.length) : 0;
  const accHigh = perUnit.filter((u) => u.acc_rating === 'rojo').length;
  const accLevel = riskLevel(accAvg), accRating = riskRating(accAvg);
  const theftAvg = perUnit.length ? Math.round(perUnit.reduce((a, u) => a + u.theft_risk, 0) / perUnit.length) : 0;
  const theftHigh = perUnit.filter((u) => u.theft_rating === 'rojo').length;
  const theftLevel = riskLevel(theftAvg), theftRating = riskRating(theftAvg);

  const fleet = {
    units_total: units.length, units_active: f.active, units_no_signal: f.no_signal, drivers: DATA.drivers.length,
    distance_km: round(km, 0), drive_hours: round(driveH, 0), stop_hours: round(stopH, 0),
    fuel_l: round(f.fuel_l, 0), efficiency_kml: round(eff, 2),
    real_fuel_l: round(f.real_fuel_l, 0), real_efficiency_kml: round(realEffFleet, 2),
    idle_fuel_l: round(f.idle_fuel_l, 0), idle_cost: Math.round(idleCost), idle_hours: round(idleHoursFleet, 0),
    motor_hours: round(driveH + idleHoursFleet, 0),
    idle_pct_fuel: round(f.real_fuel_l > 0 ? f.idle_fuel_l / f.real_fuel_l * 100 : 0, 1),
    fuel_sensors: f.sensors,
    refuel_l: Math.round(f.rf_l), refuel_n: f.rf_n, drain_l: Math.round(f.dr_l), drain_n: f.dr_n,
    violations: f.viol, violations_per_100km: round(km > 0 ? f.viol / km * 100 : 0, 1),
    segments: f.segs, stops: f.stops, max_speed: f.maxspeed,
    acc_risk: accAvg, acc_level: accLevel, acc_rating: accRating, acc_high: accHigh,
    theft_risk: theftAvg, theft_level: theftLevel, theft_rating: theftRating, theft_high: theftHigh,
    idle_share_pct: round((driveH + stopH) > 0 ? stopH / (driveH + stopH) * 100 : 0, 1),
  };

  const byDistance = [...perUnit].sort((a, b) => b.distance_km - a.distance_km);
  const byActivity = [...perUnit].filter((u) => u.drive_hours + u.stop_hours > 0).sort((a, b) => b.move_ratio - a.move_ratio);
  const byScore = [...perUnit].sort((a, b) => b.score - a.score);

  return { fleet, daily, units: perUnit, ranking: { top_distance: byDistance.slice(0, 5), bottom_active: byActivity.slice(-5).reverse(), by_score: byScore }, money: computeMoney(fleet, p), security: { hours: secHours, dow: secDow, bands: secBands } };
}

function computeMoney(fleet, p) {
  const idleFuel = fleet.idle_fuel_l;                       // ralentí real (≤ consumo total)
  const realFuel = fleet.real_fuel_l;
  const idealFuel = fleet.distance_km / p.benchmark_kml;
  const extraFuel = Math.max(0, realFuel - idealFuel);      // pérdida vs benchmark sobre consumo REAL
  const seg = fleet.violations * p.costo_por_exceso_mxn;
  const ral = idleFuel * p.precio_diesel_mxn;
  const efi = extraFuel * p.precio_diesel_mxn;
  const proj = (w) => ({ semanal: w, mensual: w * 4.345, anual: w * 52 });
  return { idleFuel: Math.round(idleFuel), extraFuel: Math.round(extraFuel), seguridad: proj(seg), ralenti: proj(ral), eficiencia: proj(efi), total: proj(seg + ral + efi) };
}

/* ============================ RENDER ============================ */
let VIEW = null;
function render() {
  VIEW = aggregate();
  const tag = document.getElementById('fTag');
  if (tag) tag.innerHTML = `<b>${esc(scopeLabel())}</b> · ${esc(plantLabel())} · ${VIEW.fleet.units_total} unidades`;

  const deck = document.getElementById('deck');
  deck.innerHTML = '';
  deck.appendChild(coverSlide());
  deck.appendChild(tocSlide());
  deck.appendChild(execSlide());
  deck.appendChild(boardSlide());
  deck.appendChild(perfSlide());
  deck.appendChild(safetySlide());
  deck.appendChild(methodSlide());
  deck.appendChild(el(`<div class="foot">Generado el ${new Date(DATA.meta.generated_at).toLocaleString('es-MX')} · Datos del rango ${dateLabel(DATA.meta.range.from)}–${dateLabel(DATA.meta.range.till)} · Fuente: ${esc(DATA.meta.source)}</div>`));
  numberSections();
  buildTOC();
  stampLogos();
  requestAnimationFrame(drawCharts);
}

// Numeración automática de secciones (índice = 01, luego en orden)
function numberSections() {
  const slides = [...document.querySelectorAll('#deck > section.slide:not(.cover)')];
  slides.forEach((s, i) => {
    const sn = s.querySelector('.snum');
    if (sn) sn.textContent = String(i + 1).padStart(2, '0');
  });
}
// Índice generado a partir de las secciones reales (siempre sincronizado)
const TOC_DESC = {
  s02: 'KPIs clave del periodo',
  sBoard: 'Tablero de todas las unidades',
  s03: 'Eficiencia combinada: distancia + rendimiento',
  s04f: 'Sensor Escort: consumo, recargas y descargas',
  s04p: 'Comparativo por planta de concreto',
  s04: 'Eventos de velocidad: tipos, hora, día y unidades',
  s05: 'Equipos de baja velocidad',
  s06: 'Score 0–100 por unidad',
  s07: 'Impacto económico estimado',
  s08: 'Parámetros y naturaleza de datos',
};
function buildTOC() {
  const nav = document.getElementById('tocNav');
  if (!nav) return;
  const slides = [...document.querySelectorAll('#deck > section.slide:not(.cover)')].filter((s) => s.id !== 'sIdx');
  nav.innerHTML = slides.map((s) => {
    const n = s.querySelector('.snum')?.textContent || '';
    const t = s.querySelector('h2')?.textContent || '';
    const d = TOC_DESC[s.id] || '';
    return `<a href="#${s.id}"><span class="n">${n}</span><span><span class="t">${esc(t)}</span><div class="d">${esc(d)}</div></span></a>`;
  }).join('');
}

function stampLogos() {
  document.querySelectorAll('.slide:not(.cover)').forEach((s) => {
    if (s.querySelector('.slide-logo')) return;
    const img = document.createElement('img');
    img.className = 'slide-logo'; img.src = CLIENT_LOGO; img.alt = 'Concretos Técnicos';
    s.appendChild(img);
  });
}

/* ----------------------------- Portada ----------------------------- */
function coverSlide() {
  const f = VIEW.fleet;
  return el(`
  <section class="slide cover" id="s01">
    <div class="topbar">
      <div class="brand"><span class="logo">A</span> TELEMATICS ADVANCE</div>
      <img class="client-logo" src="${CLIENT_LOGO}" alt="Concretos Técnicos" />
    </div>
    <div class="eyebrow" style="margin-top:30px">Informe Gerencial de Flota</div>
    <h1>Inteligencia operativa<br/>de tu <span class="hl">flota</span></h1>
    <div class="client">${esc(DATA.meta.company)}</div>
    <div class="period">${esc(scopeLabel())} &nbsp;·&nbsp; ${esc(plantLabel())} &nbsp;·&nbsp; Zona ${tzShort(DATA.meta.timezone)}</div>
    <div class="meta-row">
      <div class="m"><b>${nf.format(f.units_total)}</b><span>Unidades</span></div>
      <div class="m"><b>${nf.format(f.units_active)}</b><span>Activas</span></div>
      <div class="m"><b>${nf.format(DATA.plants.length)}</b><span>Plantas</span></div>
      <div class="m"><b>${nf.format(f.distance_km)}<span class="u"> km</span></b><span>Recorridos</span></div>
    </div>
    <div class="source">Datos en vivo vía API · ${esc(DATA.meta.source)}</div>
  </section>`);
}
function tzShort(tz) { return (tz || '').split('/').pop().replace('_', ' '); }

/* ----------------------------- Índice ----------------------------- */
function tocSlide() {
  return el(`
  <section class="slide" id="sIdx">
    <div class="slide-head"><span class="snum">01</span><div><h2>Contenido</h2><div class="sub">Usa los filtros de Mes · Semana · Planta para recalcular todo el informe</div></div></div>
    <nav class="toc" id="tocNav"></nav>
  </section>`);
}

/* ------------------------- Resumen ejecutivo ------------------------- */
function execSlide() {
  const f = VIEW.fleet;
  // % ralentí = tiempo detenido con motor encendido ÷ tiempo de motor encendido (movimiento + ralentí)
  const idlePctTime = f.motor_hours > 0 ? f.idle_hours / f.motor_hours * 100 : 0;
  const kpi = (cls, val, unit, lbl) =>
    `<div class="kpi ${cls}"><div class="k-val">${val}<span class="k-unit"> ${unit || ''}</span></div><div class="k-lbl">${lbl}</div></div>`;
  const pred = (lbl) =>
    `<div class="kpi pred"><div class="k-val">—</div><div class="k-lbl">${lbl}</div><div class="k-note pred-note">Modelo predictivo · por definir</div></div>`;
  const alertHtml = f.units_no_signal > 0
    ? `<div class="alert"><div><b>${f.units_no_signal} unidad(es) sin señal GPS reciente.</b> Posible apagado del equipo, pérdida de cobertura o manipulación.</div></div>`
    : `<div class="alert ok"><div><b>Cobertura GPS completa.</b> Todas las unidades del filtro reportaron posición.</div></div>`;
  return el(`
  <section class="slide" id="s02">
    <div class="slide-head"><span class="snum">02</span><div><h2>Resumen ejecutivo</h2><div class="sub">${esc(scopeLabel())} · ${esc(plantLabel())}</div></div></div>
    <h4 style="margin:2px 0 8px">Tendencia: rendimiento de flota (km/L) vs. distancia recorrida (km)</h4>
    <div class="chart-box bleed"><canvas id="chTrend"></canvas></div>
    <div class="kpis cols3" style="margin-top:20px">
      ${kpi('green', nf.format(f.distance_km), 'km', 'Distancia total recorrida')}
      ${kpi('teal', nf.format(f.motor_hours), 'h', 'Tiempo total de motor (est.)')}
      ${kpi('green', nf.format(f.real_fuel_l), 'L', 'Consumo total de combustible')}
      ${kpi('amber', nf.format(f.idle_fuel_l), 'L', 'Consumo de combustible en ralentí')}
      <div class="kpi amber"><div class="k-val">${nf.format(f.idle_hours)}<span class="k-unit"> h</span></div><div class="k-lbl">Tiempo en ralentí (est.)</div><div class="k-note neutral">${nf1.format(idlePctTime)}% del tiempo de motor encendido</div></div>
      ${kpi('blue', nf2.format(f.real_efficiency_kml), 'km/L', 'Rendimiento general')}
      <div class="kpi red"><div class="k-val">${nf.format(f.violations)}</div><div class="k-lbl">Eventos de seguridad registrados</div><div class="k-note">${nf1.format(f.violations_per_100km)} por cada 100 km</div></div>
      <div class="kpi ${f.acc_rating === 'rojo' ? 'red' : f.acc_rating === 'naranja' ? 'amber' : 'green'}"><div class="k-val">${f.acc_level}<span class="k-unit"> · ${f.acc_risk}</span></div><div class="k-lbl">Probabilidad de accidente</div><div class="k-note neutral">${f.acc_high} unidad(es) en riesgo alto</div></div>
      <div class="kpi ${f.theft_rating === 'rojo' ? 'red' : f.theft_rating === 'naranja' ? 'amber' : 'green'}"><div class="k-val">${f.theft_level}<span class="k-unit"> · ${f.theft_risk}</span></div><div class="k-lbl">Probabilidad de robo</div><div class="k-note neutral">${f.theft_high} unidad(es) en riesgo alto</div></div>
    </div>
    <div class="panel" style="margin-top:20px">
      <h4>Lectura ejecutiva</h4>
      <p style="font-size:13.5px;margin:.2em 0">La selección recorrió <b>${nf.format(f.distance_km)} km</b> en <b>${nf.format(f.drive_hours)} h</b> de conducción y consumió <b>${nf.format(f.real_fuel_l)} L</b> reales de diésel (rendimiento <b>${nf2.format(f.real_efficiency_kml)} km/L</b>). De ese consumo, ~<b>${nf.format(f.idle_fuel_l)} L</b> (${nf1.format(f.idle_pct_fuel)}%) corresponden a ralentí/operación detenida ≈ <b>${money(f.idle_cost)}</b>. La reducción del ralentí es la principal palanca de ahorro.</p>
      ${alertHtml}
    </div>
  </section>`);
}

/* --------------------- Tablero de unidades (tipo aeropuerto) --------------------- */
// Columnas del tablero (key, etiqueta, tipo). sortable=false en placeholders.
const BOARD_COLS = [
  { key: 'number', lbl: 'Unidad', t: 'txt' },
  { key: 'plant', lbl: 'Planta', t: 'plant' },
  { key: 'distance_km', lbl: 'Distancia<br>km', t: 'num' },
  { key: 'max_speed', lbl: 'Vel. máx<br>km/h', t: 'num' },
  { key: 'real_fuel_l', lbl: 'Combustible<br>total L', t: 'num' },
  { key: 'idle_fuel_l', lbl: 'Ralentí<br>L', t: 'num' },
  { key: 'idle_pct_fuel', lbl: '% Ralentí<br>del consumo', t: 'pct' },
  { key: 'real_efficiency_kml', lbl: 'Rendimiento<br>km/L', t: 'num2' },
  { key: 'violations_per_100km', lbl: 'Seguridad<br>/100 km', t: 'num1' },
  { key: 'has_fuel_sensor', lbl: 'Varilla', t: 'bool' },
  { key: 'drain_n', lbl: 'Descargas<br>eventos', t: 'warn' },
  { key: 'drain_l', lbl: 'Diésel<br>descargado L', t: 'alert' },
  { key: 'acc_risk', lbl: 'Prob.<br>accidente', t: 'acc' },
  { key: 'theft_risk', lbl: 'Prob.<br>robo', t: 'theft' },
];

function boardSlide() {
  const s = STATE.boardSort;
  const getVal = (u, key) => {
    if (key === 'number') return (u.number || u.label || '').toString();
    if (key === 'has_fuel_sensor') return u.has_fuel_sensor ? 1 : 0;
    return u[key];
  };
  const units = [...VIEW.units].sort((a, b) => {
    let va = getVal(a, s.key), vb = getVal(b, s.key);
    if (typeof va === 'string') return s.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    if (va == null) va = -Infinity; if (vb == null) vb = -Infinity;
    return s.dir === 'asc' ? va - vb : vb - va;
  });
  const cell = (u, c) => {
    const v = u[c.key];
    switch (c.t) {
      case 'txt': return `<td class="b-unit">${esc(u.number || u.label)}</td>`;
      case 'plant': return `<td class="b-plant" title="${esc(u.plant || '')}">${esc(shortPlant(u.plant) || '—')}</td>`;
      case 'num': return `<td>${v != null ? nf.format(v) : '—'}</td>`;
      case 'num1': return `<td>${nf1.format(v || 0)}</td>`;
      case 'num2': return `<td>${v != null ? nf2.format(v) : '—'}</td>`;
      case 'pct': { const sc = (v || 0) <= 30 ? 'verde' : (v || 0) <= 40 ? 'naranja' : 'rojo'; return `<td><span class="sem ${sc}">${nf1.format(v || 0)}%</span></td>`; }
      case 'bool': return `<td>${u.has_fuel_sensor ? '<span class="badge verde">Sí</span>' : '<span class="badge naranja">No</span>'}</td>`;
      case 'warn': return `<td class="${v ? 'b-warn' : ''}">${v || '—'}</td>`;
      case 'alert': return `<td class="${v ? 'b-alert' : ''}">${v ? nf.format(v) : '—'}</td>`;
      case 'acc': return `<td><span class="sem ${u.acc_rating}" title="${esc(`Vel ${u.acc_factors.velocidad} · Fatiga ${u.acc_factors.fatiga} · Región ${u.acc_factors.regional} · Noche ${u.acc_factors.nocturna} · Exp ${u.acc_factors.exposicion}`)}">${u.acc_risk}</span></td>`;
      case 'theft': return `<td><span class="sem ${u.theft_rating}" title="${esc(`Región ${u.theft_factors.regional} · Descargas ${u.theft_factors.descargas} · Noche ${u.theft_factors.nocturna} · Día ${u.theft_factors.dia} · Señal ${u.theft_factors.senal}`)}">${u.theft_risk}</span></td>`;
      case 'pred': return `<td class="b-pred">—</td>`;
      default: return `<td>${v ?? '—'}</td>`;
    }
  };
  const rows = units.map((u) => `<tr>${BOARD_COLS.map((c) => cell(u, c)).join('')}</tr>`).join('');
  const head = BOARD_COLS.map((c) => {
    const active = c.sortable !== false && s.key === c.key;
    const car = active ? `<span class="b-car">${s.dir === 'asc' ? '▲' : '▼'}</span>` : '';
    const cls = c.sortable === false ? 'b-nosort' : (active ? 'b-sorted' : '');
    const click = c.sortable === false ? '' : ` onclick="sortBoard('${c.key}')"`;
    return `<th class="${cls}"${click}>${c.lbl}${car}</th>`;
  }).join('');
  return el(`
  <section class="slide" id="sBoard">
    <div class="slide-head"><span class="snum">03</span><div><h2>Tablero de unidades</h2><div class="sub">Clic en un encabezado para ordenar — ${esc(scopeLabel())} · ${esc(plantLabel())}</div></div></div>
    <div class="board">
      <table class="board-tbl">
        <thead><tr>${head}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${BOARD_COLS.length}" style="color:var(--muted)">Sin datos en la selección.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="note"><b>Prob. accidente</b> (0–100): velocidad 25%, fatiga &gt;6 h 20%, riesgo regional INEGI 15%, nocturna 15%, eventos/100 km 15%, exposición km 10%. &nbsp; <b>Prob. robo</b> (0–100): riesgo regional SESNSP 30%, descargas de diésel 20%, exposición nocturna 15%, pérdida de señal 15%, día de la semana 10%, marca/modelo 10%. Semáforo (calibración laxa): verde &lt;45 · amarillo &lt;70 · rojo ≥70. Pasa el cursor sobre cada valor para ver el desglose. Ralentí (L) = consumo real − distancia × ${nf1.format(STATE.params.consumo_ruta_l100)} l/100km.</div>
  </section>`);
}

// Ordenamiento interactivo del tablero (clic encabezado: mayor→menor, otra vez menor→mayor)
function sortBoard(key) {
  const s = STATE.boardSort;
  if (s.key === key) s.dir = s.dir === 'desc' ? 'asc' : 'desc';
  else { s.key = key; s.dir = 'desc'; }
  const old = document.getElementById('sBoard');
  if (!old) return;
  const fresh = boardSlide();
  old.replaceWith(fresh);
  const img = document.createElement('img');
  img.className = 'slide-logo'; img.src = CLIENT_LOGO; img.alt = 'Concretos Técnicos';
  fresh.appendChild(img);
  numberSections();
}
window.sortBoard = sortBoard;

/* ------------- Desempeño: eficiencia combinada (distancia + rendimiento) ------------- */
function perfSlide() {
  const elig = VIEW.units.filter((u) => u.real_efficiency_kml != null && u.distance_km > 1);
  const maxD = Math.max(...elig.map((u) => u.distance_km), 1);
  const maxE = Math.max(...elig.map((u) => u.real_efficiency_kml), 0.1);
  // Score combinado 0–100: 50% aprovechamiento (distancia) + 50% rendimiento (km/L)
  const scored = elig.map((u) => ({ ...u, combo: Math.round((0.5 * u.distance_km / maxD + 0.5 * u.real_efficiency_kml / maxE) * 100) }))
    .sort((a, b) => b.combo - a.combo);
  const top = scored.slice(0, 5), bot = scored.slice(-5).reverse();
  const rows = (arr, color) => arr.map((u, i) => `
    <tr><td class="rank-i">${i + 1}</td><td>${esc(u.number || u.label)}</td>
      <td class="num">${nf1.format(u.distance_km)} km</td>
      <td class="num">${nf2.format(u.real_efficiency_kml)} km/L</td>
      <td class="num"><b>${u.combo}</b></td>
      <td style="width:64px"><div class="bar-wrap"><i style="width:${Math.max(5, u.combo)}%;background:${color}"></i></div></td></tr>`).join('');
  const head = '<thead><tr><th></th><th>Unidad</th><th class="num">Distancia</th><th class="num">Rend.</th><th class="num">Score</th><th></th></tr></thead>';
  const panel = (title, sub, body, color) => `<div class="panel"><h4>${title}</h4><div class="sub" style="font-size:11.5px;color:var(--muted);margin:-6px 0 8px">${sub}</div><table class="tbl">${head}<tbody>${body || `<tr><td colspan="6" style="color:var(--muted)">Sin datos</td></tr>`}</tbody></table></div>`;
  return el(`
  <section class="slide" id="s03">
    <div class="slide-head"><span class="snum">03</span><div><h2>Eficiencia de la flota</h2><div class="sub">Desempeño combinado: aprovechamiento (km) + rendimiento (km/L) · ${esc(scopeLabel())} · ${esc(plantLabel())}</div></div></div>
    <div class="cols">
      ${panel('Top 5 — mejor desempeño', 'Mayor distancia recorrida y mejor rendimiento', rows(top, C.green), C.green)}
      ${panel('Bottom 5 — menor desempeño', 'Menor distancia recorrida y menor rendimiento', rows(bot, C.red), C.red)}
    </div>
    <div class="note">Score 0–100 = 50% aprovechamiento (distancia recorrida, normalizada) + 50% rendimiento (km/L real). Las mejores combinan alto kilometraje y buena eficiencia; las peores, bajo kilometraje y baja eficiencia. Combustible real del sensor/flujo. El ranking es por <b>unidad</b> (el rendimiento por conductor requiere la asignación conductor↔unidad, no disponible en la API).</div>
  </section>`);
}

/* ------------------------- Combustible (sensor Escort) ------------------------- */
function fuelSlide() {
  const f = VIEW.fleet;
  const kpi = (cls, val, unit, lbl) =>
    `<div class="kpi ${cls}"><div class="k-val">${val}<span class="k-unit"> ${unit || ''}</span></div><div class="k-lbl">${lbl}</div></div>`;
  // Tabla por unidad (las que tienen actividad), ordenada por consumo real
  const rowsArr = [...VIEW.units].filter((u) => u.distance_km > 1 || u.refuel_n || u.drain_n).sort((a, b) => (b.real_fuel_l || 0) - (a.real_fuel_l || 0));
  const rows = rowsArr.map((u) => `
    <tr>
      <td>${esc(u.number || u.label)}</td>
      <td class="num">${nf1.format(u.distance_km)}</td>
      <td class="num">${u.real_fuel_l != null ? nf.format(u.real_fuel_l) : '—'}</td>
      <td class="num">${u.real_l100 != null ? nf1.format(u.real_l100) : '—'}</td>
      <td class="num" style="color:var(--muted)">${nf1.format(u.fuel_l)}</td>
      <td class="num">${u.refuel_n ? `${u.refuel_n} · ${nf.format(u.refuel_l)} L` : '—'}</td>
      <td class="num">${u.drain_n ? `<b style="color:var(--red)">${u.drain_n} · ${nf.format(u.drain_l)} L</b>` : '—'}</td>
      <td>${u.has_fuel_sensor ? '<span class="badge verde">Sí</span>' : '<span class="badge naranja">No</span>'}</td>
    </tr>`).join('');
  const drainAlert = f.drain_n > 0
    ? `<div class="alert"><div><b>${f.drain_n} evento(s) de posible descarga (${nf.format(f.drain_l)} L)</b> detectados por el sensor de varilla en la selección. Requieren <b>validación en sitio</b>: el sensor BLE Escort puede generar lecturas atípicas. Revisa hora, lugar y conductor antes de concluir.</div></div>`
    : `<div class="alert ok"><div><b>Sin descargas anómalas</b> detectadas por el sensor en la selección (tras filtrar ruido).</div></div>`;
  return el(`
  <section class="slide" id="s04f">
    <div class="slide-head"><span class="snum">04</span><div><h2>Combustible y sensor de varilla</h2><div class="sub">Sensores Escort BLE · consumo real (flujo) vs. estimado · ${esc(scopeLabel())}</div></div>
      <div class="f-spacer"></div>
      <div class="fuel-chip">Sensores <b>${f.fuel_sensors}</b><span>/ ${f.units_total}</span></div>
    </div>
    <div class="kpis" style="grid-template-columns:repeat(4,1fr)">
      ${kpi('green', nf.format(f.real_fuel_l), 'L', 'Consumo REAL (flujo/sensor)')}
      ${kpi('amber', nf.format(f.fuel_l), 'L', 'Consumo estimado (norma)')}
      ${kpi('teal', nf2.format(f.real_efficiency_kml), 'km/L', 'Eficiencia real')}
      ${kpi('blue', nf.format(f.refuel_n), '', `Recargas · ${nf.format(f.refuel_l)} L`)}
    </div>
    <div class="cols c-7-5" style="margin-top:20px">
      <div class="chart-box sm"><canvas id="chFuel"></canvas></div>
      <div class="panel">
        <h4>Real vs. estimado</h4>
        <p style="font-size:13.5px;margin:.2em 0">El consumo <b>real</b> proviene del medidor de flujo/CAN y del sensor Escort de varilla (${f.fuel_sensors} de ${f.units_total} unidades equipadas). El <b>estimado</b> usa la norma configurable de ${nf1.format(STATE.params.consumo_norma_l100)} l/100km.</p>
        ${drainAlert}
      </div>
    </div>
    <div class="panel" style="margin-top:18px">
      <table class="tbl">
        <thead><tr><th>Unidad</th><th class="num">km</th><th class="num">Real (L)</th><th class="num">l/100km</th><th class="num">Estim. l/100km*</th><th class="num">Recargas</th><th class="num">Descargas</th><th>Sensor</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="color:var(--muted)">Sin datos de combustible en la selección.</td></tr>'}</tbody>
      </table>
    </div>
    <div class="note">*Estimado l/100km = norma configurable. Recargas y descargas provienen del sensor Escort de varilla (BLE) tras filtrar ruido (lecturas imposibles y oscilaciones recuperadas). Las descargas son <b>indicios a validar</b>, no conclusiones de robo.</div>
  </section>`);
}

/* ------------------------------ Plantas ------------------------------ */
function plantsSlide() {
  // Agrega por planta dentro del scope actual (ignora el filtro de planta para comparar todas)
  const days = scopeDays();
  const sortedDays = [...days];
  const byPlant = new Map();
  for (const p of DATA.plants) byPlant.set(p.id, { name: p.name, units: 0, dist: 0, drive: 0, stop: 0, viol: 0 });
  for (const u of DATA.units) {
    const agg = byPlant.get(u.plant_id); if (!agg) continue; agg.units += 1;
    for (const k of sortedDays) { const d = u.days[k]; if (d) { agg.dist += d.dist_km; agg.drive += d.drive_h; agg.stop += d.stop_h; agg.viol += d.viol; } }
  }
  const rowsArr = [...byPlant.values()].sort((a, b) => b.dist - a.dist);
  const maxD = Math.max(...rowsArr.map((r) => r.dist), 1);
  const rows = rowsArr.map((r) => {
    const act = (r.drive + r.stop) > 0 ? r.drive / (r.drive + r.stop) * 100 : 0;
    const isSel = STATE.plantId !== 'all' && DATA.plants.find((p) => p.id === STATE.plantId)?.name === r.name;
    return `<tr${isSel ? ' style="background:rgba(41,211,232,.08)"' : ''}>
      <td><b>${esc(r.name)}</b></td>
      <td class="num">${r.units}</td>
      <td class="num">${nf.format(Math.round(r.dist))}</td>
      <td style="width:130px"><div class="bar-wrap"><i style="width:${Math.max(3, r.dist / maxD * 100)}%"></i></div></td>
      <td class="num">${nf.format(Math.round(r.drive))}</td>
      <td class="num">${nf1.format(act)}%</td>
      <td class="num">${r.viol}</td></tr>`;
  }).join('');
  return el(`
  <section class="slide" id="s04p">
    <div class="slide-head"><span class="snum">05</span><div><h2>Comparativo por planta</h2><div class="sub">Distribución de la flota por planta / base operativa · ${esc(scopeLabel())}</div></div></div>
    <div class="cols c-7-5">
      <div class="chart-box"><canvas id="chPlant"></canvas></div>
      <div class="panel">
        <h4>${DATA.plants.length} plantas detectadas</h4>
        <p style="font-size:13px;margin:.2em 0">La planta de cada unidad se deriva de su <b>base operativa dominante</b> (ubicación GPS donde acumula más tiempo detenido). Usa el filtro <b>Planta</b> para aislar una sola base.</p>
        <div class="note" style="margin-top:10px">Selecciona una planta en la barra superior para ver todo el informe enfocado en esa base.</div>
      </div>
    </div>
    <div class="panel" style="margin-top:20px">
      <table class="tbl">
        <thead><tr><th>Planta / base operativa</th><th class="num">Unid.</th><th class="num">km</th><th></th><th class="num">h manejo</th><th class="num">Activ.</th><th class="num">Excesos</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`);
}

/* ----------------------------- Seguridad ----------------------------- */
function safetySlide() {
  const f = VIEW.fleet;
  const s = VIEW.security;
  const totalEv = s.bands.b40 + s.bands.b50 + s.bands.b60;
  // Top 5 unidades más inseguras (por eventos de velocidad)
  const unsafe = [...VIEW.units].sort((a, b) => (b.sec_events - a.sec_events) || (b.max_speed - a.max_speed)).slice(0, 5);
  const rows = unsafe.map((u, i) => `
    <tr><td class="rank-i">${i + 1}</td><td>${esc(u.number || u.label)}</td>
      <td class="num">${nf.format(u.sec_events)}</td>
      <td class="num">${nf.format(u.sec_ev60)}</td>
      <td class="num">${u.max_speed} km/h</td>
      <td class="num">${nf2.format(u.sec_per100)}</td></tr>`).join('');
  return el(`
  <section class="slide" id="s04">
    <div class="slide-head"><span class="snum">06</span><div><h2>Seguridad y conducción</h2><div class="sub">Eventos de velocidad (tramos &gt;40 km/h prom.) · ${esc(scopeLabel())} · ${esc(plantLabel())}</div></div></div>
    <div class="kpis" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi red"><div class="k-val">${nf.format(totalEv)}</div><div class="k-lbl">Eventos de velocidad</div></div>
      <div class="kpi amber"><div class="k-val">${nf.format(s.bands.b60)}</div><div class="k-lbl">Velocidades &gt; 60 km/h</div></div>
      <div class="kpi teal"><div class="k-val">${f.max_speed}<span class="k-unit"> km/h</span></div><div class="k-lbl">Velocidad máxima de tramo</div></div>
      <div class="kpi blue"><div class="k-val">${nf2.format(f.violations_per_100km)}</div><div class="k-lbl">Excesos /100 km</div></div>
    </div>
    <div class="cols c-5-7" style="margin-top:20px">
      <div class="panel"><h4>Tipos de evento (por rango de velocidad)</h4><div class="chart-box sec"><canvas id="chSecPie"></canvas></div></div>
      <div class="panel"><h4>Eventos por hora del día (0–23 h)</h4><div class="chart-box sec"><canvas id="chSecHour"></canvas></div></div>
    </div>
    <div class="cols c-5-7" style="margin-top:18px">
      <div class="panel"><h4>Eventos por día de la semana</h4><div class="chart-box sec"><canvas id="chSecDow"></canvas></div></div>
      <div class="panel">
      <h4>Top 5 — unidades más inseguras</h4>
      <table class="tbl">
        <thead><tr><th></th><th>Unidad</th><th class="num">Eventos</th><th class="num">&gt; 60 km/h</th><th class="num">Vel. máx</th><th class="num">Eventos /100 km</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" style="color:var(--muted)">Sin eventos en la selección.</td></tr>'}</tbody>
      </table>
      </div>
    </div>
    <div class="note">La flota maneja a baja velocidad: un "evento" es un tramo con velocidad promedio &gt; 40 km/h. La API expone solo <b>velocidad promedio por tramo</b> (no instantánea) y <b>no hay eventos de frenado/aceleración brusca</b> (requieren acelerómetro/CAN) ni asignación conductor↔viaje, por lo que el ranking es por <b>unidad</b>. La evaluación de conductores requiere habilitar <code>driver_behaviour</code> en la API.</div>
  </section>`);
}

/* ----------------------------- Montacargas ----------------------------- */
function forkliftSlide() {
  return el(`
  <section class="slide" id="s05">
    <div class="slide-head"><span class="snum">07</span><div><h2>Montacargas y equipos de baja velocidad</h2><div class="sub">Se activa automáticamente para equipos bajo 30 km/h operativos</div></div></div>
    <div class="na-box"><div class="big">N/A</div><p>No se detectaron equipos tipo montacargas en la flota analizada.<br/>Esta sección se habilita automáticamente con unidades de perfil de baja velocidad.</p></div>
  </section>`);
}

/* --------------------------- Ranking operativo --------------------------- */
function rankingSlide() {
  const arr = VIEW.ranking.by_score;
  const rows = arr.map((u, i) => `
    <tr><td class="rank-i">${i + 1}</td><td>${esc(u.number || u.label)}</td>
      <td class="num">${nf1.format(u.distance_km)}</td>
      <td class="num">${u.score_breakdown.seguridad}</td><td class="num">${u.score_breakdown.eficiencia}</td><td class="num">${u.score_breakdown.actividad}</td>
      <td class="num"><b>${u.score}</b></td><td><span class="badge ${u.rating}">${u.score}</span></td></tr>`).join('');
  const counts = { verde: 0, naranja: 0, rojo: 0 }; arr.forEach((u) => counts[u.rating]++);
  return el(`
  <section class="slide" id="s06">
    <div class="slide-head"><span class="snum">08</span><div><h2>Ranking operativo</h2><div class="sub">Score 0–100 · Seguridad 40% + Eficiencia 30% + Actividad 30%</div></div></div>
    <div class="cols c-7-5">
      <div class="chart-box sm"><canvas id="chScore"></canvas></div>
      <div class="panel">
        <h4>Distribución por categoría</h4>
        <p style="font-size:14px"><span class="dot verde"></span><b>${counts.verde}</b> óptimas (≥65)</p>
        <p style="font-size:14px"><span class="dot naranja"></span><b>${counts.naranja}</b> aceptables (45–64)</p>
        <p style="font-size:14px"><span class="dot rojo"></span><b>${counts.rojo}</b> por debajo del estándar (&lt;45)</p>
        <div class="note" style="margin-top:12px">El score prioriza seguridad y aprovechamiento real de la unidad.</div>
      </div>
    </div>
    <div class="panel" style="margin-top:20px">
      <table class="tbl">
        <thead><tr><th>#</th><th>Unidad</th><th class="num">km</th><th class="num">Seg.</th><th class="num">Efic.</th><th class="num">Activ.</th><th class="num">Score</th><th>Cat.</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="color:var(--muted)">Sin datos en la selección.</td></tr>'}</tbody>
      </table>
    </div>
  </section>`);
}

/* ----------------------------- Monetización ----------------------------- */
function moneySlide() {
  const m = VIEW.money;
  const card = (id, title, desc, sub) => `
    <div class="money-card"><h4>${title}</h4>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">${desc}</div>
      <div class="big" id="${id}-sem">${money(m[id].semanal)}</div>
      <div style="font-size:11.5px;color:var(--muted)">por semana · ${sub}</div>
      <div class="proj"><div>Mensual<b id="${id}-men">${money(m[id].mensual)}</b></div><div>Anual<b id="${id}-anu">${money(m[id].anual)}</b></div></div>
    </div>`;
  const diesel = STATE.params.precio_diesel_mxn;
  return el(`
  <section class="slide" id="s07">
    <div class="slide-head"><span class="snum">09</span><div><h2>Monetización del desempeño</h2><div class="sub">Impacto económico estimado (MXN) · ${esc(plantLabel())}</div></div>
      <div class="f-spacer"></div>
      <div class="fuel-chip">Diésel <b>${price(diesel)}</b><span>/L</span></div>
    </div>
    <div class="money-grid">
      ${card('seguridad', 'Seguridad', 'Costo por eventos de exceso de velocidad.', `<span id="m-viol">${nf.format(VIEW.fleet.violations)}</span> excesos`)}
      ${card('ralenti', 'Ralentí', 'Combustible por motor en detención.', `<span id="m-idle">${nf.format(m.idleFuel)}</span> L/sem`)}
      ${card('eficiencia', 'Eficiencia', 'Pérdida vs. benchmark del fabricante.', `<span id="m-extra">${nf.format(m.extraFuel)}</span> L extra/sem`)}
    </div>
    <div class="total-band">
      <div><div class="lbl">Exposición total estimada</div><div style="font-size:12px;color:#8fb0d8">semanal · mensual · anual</div></div>
      <div style="text-align:right"><div class="v" id="tot-sem">${money(m.total.semanal)}</div>
        <div style="font-size:13px;color:#bcd3f5"><span id="tot-men">${money(m.total.mensual)}</span> /mes · <span id="tot-anu">${money(m.total.anual)}</span> /año</div></div>
    </div>
    <div class="note">Montos basados en los parámetros editables de Metodología y en la selección de Mes/Semana/Planta. Ajusta los supuestos y se recalcula al instante.</div>
  </section>`);
}

/* ----------------------------- Metodología ----------------------------- */
function methodSlide() {
  const P = STATE.params; const nat = DATA.meta.naturaleza_datos;
  const inp = (id, label, val, hint, step) =>
    `<div class="param"><div><label>${label}</label><div class="hint">${hint}</div></div><input id="${id}" type="number" step="${step}" value="${val}" oninput="onParam()"></div>`;
  return el(`
  <section class="slide" id="s08">
    <div class="slide-head"><span class="snum">10</span><div><h2>Metodología y parámetros</h2><div class="sub">Ajusta los supuestos y el informe se recalcula automáticamente</div></div></div>
    <div class="cols">
      <div class="panel">
        <h4>Parámetros de monetización</h4>
        <div class="param-grid">
          ${inp('p-diesel', 'Precio diésel (MXN/L)', P.precio_diesel_mxn, 'Costo del litro', '0.5')}
          ${inp('p-norma', 'Consumo norma (L/100km)', P.consumo_norma_l100, 'Referencia de consumo', '1')}
          ${inp('p-ruta', 'Consumo en ruta (L/100km)', P.consumo_ruta_l100, 'Solo en movimiento (separa ralentí)', '1')}
          ${inp('p-bench', 'Benchmark (km/L)', P.benchmark_kml, 'Objetivo del fabricante', '0.1')}
          ${inp('p-ralenti', 'Ralentí (L/h)', P.consumo_ralenti_lh, 'Consumo en detención', '0.5')}
          ${inp('p-limite', 'Límite velocidad (km/h)', P.limite_velocidad_kmh, 'Umbral de exceso', '5')}
          ${inp('p-exceso', 'Costo por exceso (MXN)', P.costo_por_exceso_mxn, 'Penalización por evento', '10')}
        </div>
        <div style="margin-top:14px"><button class="btn" onclick="onParam()">Recalcular informe</button></div>
      </div>
      <div class="panel">
        <h4>Naturaleza de los datos</h4>
        <p style="font-size:13px;margin:.2em 0"><b style="color:var(--green)">● Medido (telemetría GPS):</b></p>
        <ul class="split-list" style="margin:.3em 0 1em">${nat.medido.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <p style="font-size:13px;margin:.2em 0"><b style="color:var(--gold)">● Estimado (modelo):</b></p>
        <ul class="split-list" style="margin:.3em 0 1em">${nat.estimado.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <div class="note">${esc(nat.nota)}</div>
      </div>
    </div>
    <div class="panel" style="margin-top:18px">
      <h4>Fórmulas</h4>
      <ul style="font-size:13px;margin:.3em 0">
        <li><b>Combustible real</b> = medido por sensor/flujo &nbsp;·&nbsp; <b>Rendimiento</b> = distancia ÷ combustible real</li>
        <li><b>Ralentí (L)</b> = combustible real − (distancia × consumo_ruta ÷ 100) &nbsp;·&nbsp; <b>Costo ralentí</b> = ralentí × precio_diésel</li>
        <li><b>Pérdida eficiencia</b> = máx(0, combustible real − distancia ÷ benchmark) × precio_diésel</li>
        <li><b>Costo seguridad</b> = nº de excesos × costo_por_exceso &nbsp;·&nbsp; <b>Proyección</b>: mensual ×4.345 · anual ×52</li>
      </ul>
    </div>
    <div class="note">Rango de datos disponible: ${dateLabel(DATA.meta.range.from)} – ${dateLabel(DATA.meta.range.till)} · ${DATA.units.length} unidades · ${DATA.plants.length} plantas · Generado desde ${esc(DATA.meta.source)}.</div>
  </section>`);
}

function onParam() {
  const g = (id, def) => { const e = document.getElementById(id); const v = e ? parseFloat(e.value) : def; return isNaN(v) ? def : v; };
  const P = DATA.meta.params;
  STATE.params = {
    precio_diesel_mxn: g('p-diesel', P.precio_diesel_mxn),
    consumo_norma_l100: g('p-norma', P.consumo_norma_l100),
    consumo_ruta_l100: g('p-ruta', P.consumo_ruta_l100),
    benchmark_kml: g('p-bench', P.benchmark_kml),
    consumo_ralenti_lh: g('p-ralenti', P.consumo_ralenti_lh),
    limite_velocidad_kmh: g('p-limite', P.limite_velocidad_kmh),
    costo_por_exceso_mxn: g('p-exceso', P.costo_por_exceso_mxn),
  };
  render();
}

/* ------------------------------ Gráficos ------------------------------ */
function drawCharts() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.color = '#5f6873';
  const GRID = 'rgba(20,24,29,.07)';
  const f = VIEW.fleet;

  // Tendencia ejecutiva: distancia (barras) + rendimiento real km/L (línea)
  const td = VIEW.daily;
  mk('chTrend', {
    type: 'bar',
    data: {
      labels: td.map((x) => x.weekday + ' ' + dateLabel(x.date)),
      datasets: [
        { type: 'bar', label: 'Distancia (km)', data: td.map((x) => x.distance_km), backgroundColor: 'rgba(182,212,0,.55)', borderRadius: 5, categoryPercentage: 0.92, barPercentage: 0.96, yAxisID: 'y' },
        { type: 'line', label: 'Rendimiento (km/L)', data: td.map((x) => x.efficiency_kml), borderColor: C.green, backgroundColor: C.green, borderWidth: 2.5, tension: .35, pointRadius: 2.5, yAxisID: 'y1' },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        y: { beginAtZero: true, position: 'left', grid: { color: GRID }, title: { display: true, text: 'km', font: { size: 10 } } },
        y1: { beginAtZero: true, position: 'right', grid: { display: false }, title: { display: true, text: 'km/L', font: { size: 10 } } },
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, font: { size: 10 } } },
      },
    },
  });

  const sc = VIEW.ranking.by_score;
  mk('chScore', { type: 'bar',
    data: { labels: sc.map((u) => u.number || u.label), datasets: [{ data: sc.map((u) => u.score), backgroundColor: sc.map((u) => ratingColor[u.rating]), borderRadius: 4 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, max: 100, grid: { color: GRID } }, y: { ticks: { font: { size: 9 } }, grid: { display: false } } } } });

  // Comparativo por planta (distancia)
  const days = [...scopeDays()];
  const pAgg = DATA.plants.map((p) => {
    let dist = 0;
    for (const u of DATA.units) if (u.plant_id === p.id) for (const k of days) { const d = u.days[k]; if (d) dist += d.dist_km; }
    return { name: p.name, dist };
  }).sort((a, b) => b.dist - a.dist);
  mk('chPlant', { type: 'bar',
    data: { labels: pAgg.map((p) => p.name), datasets: [{ data: pAgg.map((p) => Math.round(p.dist)), backgroundColor: C.cyan, borderRadius: 4 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { color: GRID } }, y: { ticks: { font: { size: 9.5 } }, grid: { display: false } } } } });

  // ---- Seguridad ----
  if (VIEW.security) {
    const sec = VIEW.security;
    mk('chSecPie', { type: 'doughnut',
      data: { labels: ['40–50 km/h', '50–60 km/h', '> 60 km/h'], datasets: [{ data: [sec.bands.b40, sec.bands.b50, sec.bands.b60], backgroundColor: [C.lime, C.gold, C.red], borderColor: '#fff', borderWidth: 2 }] },
      options: { cutout: '58%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 11, font: { size: 11 } } } } } });
    const dl = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    mk('chSecDow', { type: 'bar',
      data: { labels: dl, datasets: [{ data: [1, 2, 3, 4, 5, 6, 0].map((d) => sec.dow[d]), backgroundColor: C.lime, borderRadius: 5 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: GRID } }, x: { grid: { display: false } } } } });
    mk('chSecHour', { type: 'bar',
      data: { labels: sec.hours.map((_, h) => `${h}h`), datasets: [{ label: 'Eventos', data: sec.hours, backgroundColor: C.cyan, borderRadius: 3 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: GRID } }, x: { grid: { display: false }, ticks: { font: { size: 9 }, autoSkip: true, maxRotation: 0 } } } } });
  }
}
function mk(id, cfg) { const c = document.getElementById(id); if (!c) return; if (charts[id]) charts[id].destroy(); charts[id] = new Chart(c, cfg); }

window.onParam = onParam;
boot();

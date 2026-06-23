// scripts/dashboard-regiones.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Dashboard de DISTRIBUCIÓN DE MODELOS POR REGIÓN + EXPECTATIVA DE CRECIMIENTO.
//
// Hace 4 cosas con la data real de Mapon/Smart-Connect:
//   1) LIMPIA los VIN (normaliza, valida 17 chars, separa los que hay que revisar).
//   2) Asigna REGIÓN por última posición GPS (point-in-polygon vs estados de México).
//   3) Construye la matriz Región × Modelo.
//   4) Proyecta el CRECIMIENTO por región con la tendencia actual de altas (created_at).
// Salida: dashboard-regiones.html  +  listado-unidades-foton.csv  +  listado-revisar-vin.csv
//
// USO:  MAPON_KEY=<apikey> node scripts/dashboard-regiones.mjs
// La API key NUNCA se escribe en archivos ni en logs.
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from 'fs';

const BASE = 'https://portal.smart-connect.com.mx/api/v1';
const KEY  = process.env.MAPON_KEY || '';
const GEOJSON = 'https://raw.githubusercontent.com/angelnmara/geojson/master/mexicoHigh.json';
if (!KEY || KEY.length < 10) { console.error('ERROR: falta MAPON_KEY'); process.exit(1); }

// Región/Agencia → Estado (tabla del cliente). El point-in-polygon da el estado; aquí lo mapeamos a región.
const ESTADO_A_REGION = {
  'tamaulipas': 'Altamira', 'hidalgo': 'Tula', 'zacatecas': 'Zacatecas',
  'aguascalientes': 'Aguascalientes', 'guanajuato': 'León', 'queretaro': 'Querétaro',
  'nuevo leon': 'Monterrey', 'san luis potosi': 'San Luis Potosí', 'durango': 'Durango',
};
const REGIONES = ['Altamira', 'Tula', 'Zacatecas', 'Aguascalientes', 'León', 'Querétaro', 'Monterrey', 'San Luis Potosí', 'Durango'];
const norm = s => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function api(method, params = {}) {
  const u = new URL(BASE + '/' + method);
  u.searchParams.set('key', KEY);
  for (const k in params) u.searchParams.set(k, params[k]);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${method} → HTTP ${r.status}`);
  return r.json();
}

// ── Point-in-polygon (ray casting) sobre Polygon / MultiPolygon GeoJSON ──
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pointInFeature(lng, lat, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) {
    if (!poly.length || !pointInRing(lng, lat, poly[0])) continue;     // anillo exterior
    let inHole = false;
    for (let h = 1; h < poly.length; h++) if (pointInRing(lng, lat, poly[h])) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}

// ── Limpieza de VIN ──
const VIN_OK = /^[A-HJ-NPR-Z0-9]{17}$/;   // VIN estándar: 17 chars, sin I/O/Q
function limpiarVin(vin, number) {
  const clean = s => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cand = [clean(vin), clean(number)];
  for (const c of cand) if (VIN_OK.test(c)) return { vin: c, ok: true, motivo: '' };
  // No hay VIN válido: diagnostica el mejor candidato
  const best = cand.find(Boolean) || '';
  let motivo = 'sin VIN';
  if (/^86\d{13,}$/.test(best)) motivo = 'es IMEI/serial del rastreador, no VIN';
  else if (best.length === 16) motivo = 'VIN de 16 (falta 1 carácter)';
  else if (best.length > 0 && best.length < 17) motivo = `VIN corto (${best.length})`;
  else if (best.length > 17) motivo = `VIN largo (${best.length})`;
  else if (/[IOQ]/.test(best)) motivo = 'contiene I/O/Q (no válidos en VIN)';
  return { vin: best, ok: false, motivo };
}

// ── Normaliza modelo para agrupar variantes triviales ("EST- S38" ≈ "EST-S38") ──
function modeloNorm(m) {
  return (m || '(sin modelo)').toString().toUpperCase()
    .replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
}

async function main() {
  console.log('Descargando flota y mapa de estados…');
  const [ul, geo] = await Promise.all([
    api('unit/list.json', { include: 'technical_details' }),
    fetch(GEOJSON).then(r => r.json()),
  ]);
  const units = ul.data?.units || [];
  const estados = geo.features.map(f => ({ name: f.properties.name, geom: f.geometry }));
  console.log(`Unidades: ${units.length} · Estados en mapa: ${estados.length}`);

  // 1) Región por GPS  +  2) limpieza de VIN  +  recolección de modelos/altas
  const filas = [], revisar = [], vistos = new Set(), dup = [];
  const matriz = {};                 // region → { modelo → n }
  const altasReg = {};               // region → { 'YYYY-MM' → n }
  const altasGlob = {};              // 'YYYY-MM' → n
  const makeReg = {};                // region → { make → n }
  for (const R of [...REGIONES, 'Otras']) { matriz[R] = {}; altasReg[R] = {}; makeReg[R] = {}; }

  for (const u of units) {
    // región
    let region = 'Otras';
    if (u.lat && u.lng) {
      const est = estados.find(e => pointInFeature(u.lng, u.lat, e.geom));
      if (est) region = ESTADO_A_REGION[norm(est.name)] || 'Otras';
    }
    // VIN
    const v = limpiarVin(u.vin, u.number);
    const make = (u.make || '').toString().trim().toUpperCase().replace(/\s+/g, ' ') || '(sin marca)';
    const modelo = modeloNorm(u.model || u.label);

    // distribución
    matriz[region][modelo] = (matriz[region][modelo] || 0) + 1;
    makeReg[region][make] = (makeReg[region][make] || 0) + 1;
    // altas
    const ym = (u.created_at || '').slice(0, 7);
    if (ym) { altasReg[region][ym] = (altasReg[region][ym] || 0) + 1; altasGlob[ym] = (altasGlob[ym] || 0) + 1; }

    // listado FOTON (dedupe por VIN válido)
    const rec = { unit_id: u.unit_id, vin: v.vin, placa: u.number || '', make, model: u.model || '', region,
                  anio: u.technical_details?.make_year || '', emision: u.technical_details?.emission_class || '' };
    if (v.ok) {
      if (vistos.has(v.vin)) dup.push(rec); else { vistos.add(v.vin); filas.push(rec); }
    } else {
      revisar.push({ ...rec, motivo: v.motivo });
    }
  }

  // ── CSV: listado limpio para FOTON + listado a revisar ──
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  const csv = (head, rows) => [head.join(',')].concat(rows.map(r => head.map(h => esc(r[h] ?? '')).join(','))).join('\n');
  writeFileSync('listado-unidades-foton.csv', csv(['unit_id', 'vin', 'placa', 'make', 'model', 'region', 'anio', 'emision'], filas));
  writeFileSync('listado-revisar-vin.csv',     csv(['unit_id', 'vin', 'placa', 'make', 'model', 'region', 'motivo'], revisar));
  console.log(`VIN válidos únicos: ${filas.length} · duplicados: ${dup.length} · a revisar: ${revisar.length}`);

  // 3) Tendencia + proyección de crecimiento por región
  const meses = Object.keys(altasGlob).sort();
  const ultimos = meses.slice(-12);                       // ventana de tendencia
  function proyeccion(serie) {
    // promedio de altas/mes de los últimos 6 meses con datos
    const ult6 = meses.slice(-7, -1);                     // excluye el mes en curso (parcial)
    const vals = ult6.map(m => serie[m] || 0);
    const ritmo = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return ritmo;                                         // altas esperadas por mes
  }
  const crecimiento = {};
  for (const R of [...REGIONES, 'Otras']) {
    const actual = Object.values(matriz[R]).reduce((a, b) => a + b, 0);
    const ritmo = proyeccion(altasReg[R]);
    crecimiento[R] = {
      actual,
      ritmoMes: +ritmo.toFixed(1),
      proy6: Math.round(actual + ritmo * 6),
      proy12: Math.round(actual + ritmo * 12),
      pct12: actual ? +((ritmo * 12 / actual) * 100).toFixed(0) : 0,
    };
  }

  // ── Datos para el dashboard ──
  const totalUnidades = units.length;
  const fotonPct = Math.round(filas.concat(revisar).filter(r => /FOTON/i.test(r.make)).length / totalUnidades * 100);
  const modelosGlob = {};
  for (const R of [...REGIONES, 'Otras']) for (const [m, n] of Object.entries(matriz[R])) modelosGlob[m] = (modelosGlob[m] || 0) + 1 * n;
  const topModelos = Object.entries(modelosGlob).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const topModelKeys = topModelos.map(x => x[0]);

  const DATA = {
    generado: new Date().toISOString().slice(0, 16).replace('T', ' '),
    totalUnidades, fotonPct,
    modelosDistintos: Object.keys(modelosGlob).length,
    vinOk: filas.length, vinRevisar: revisar.length,
    regiones: REGIONES,
    porRegion: REGIONES.map(R => Object.values(matriz[R]).reduce((a, b) => a + b, 0)),
    otras: Object.values(matriz['Otras']).reduce((a, b) => a + b, 0),
    topModelos,
    matriz, topModelKeys,
    meses: ultimos, altasGlob: ultimos.map(m => altasGlob[m] || 0),
    crecimiento,
  };

  writeFileSync('dashboard-regiones.html', renderHTML(DATA));
  writeFileSync('distribucion-regiones.json', JSON.stringify(DATA, null, 2));
  console.log('\n✔ dashboard-regiones.html  ·  listado-unidades-foton.csv  ·  listado-revisar-vin.csv');
  console.log('\nResumen por región:');
  for (const R of REGIONES) { const c = crecimiento[R]; console.log(`  ${R.padEnd(18)} ${String(c.actual).padStart(4)} u  · ritmo ${c.ritmoMes}/mes · 12m→ ${c.proy12} (+${c.pct12}%)`); }
  console.log(`  ${'Otras'.padEnd(18)} ${String(crecimiento['Otras'].actual).padStart(4)} u`);
}

// ── HTML del dashboard (tema Advance · Chart.js + datalabels por CDN) ──
function renderHTML(D) {
  const J = JSON.stringify(D);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Distribución de Modelos por Región — Advance</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js"></script>
<style>
:root{--p:#16a34a;--forest:#0f5132;--ink:#0b1f17;--mut:#5b6b63;--bg:#f3f7f4;--card:rgba(255,255,255,.72);--line:rgba(15,81,50,.14)}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);
background:radial-gradient(1200px 600px at 80% -10%,#d8f0e0,transparent),radial-gradient(900px 500px at -10% 10%,#e3f6ea,transparent),var(--bg)}
header{padding:34px 40px 18px}h1{margin:0;font-size:26px;letter-spacing:-.4px}.sub{color:var(--mut);margin-top:6px}
.wrap{padding:8px 40px 60px;max-width:1280px;margin:0 auto}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin:18px 0 26px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;backdrop-filter:blur(8px)}
.kpi b{display:block;font-size:28px;color:var(--forest);letter-spacing:-.5px}.kpi span{color:var(--mut);font-size:12.5px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px 20px;backdrop-filter:blur(8px);margin-bottom:18px}
.card h2{margin:0 0 4px;font-size:16px}.card p{margin:0 0 12px;color:var(--mut);font-size:12.5px}
.full{grid-column:1/-1}canvas{max-height:340px}
table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{padding:7px 8px;text-align:right;border-bottom:1px solid var(--line)}
th:first-child,td:first-child{text-align:left}th{color:var(--mut);font-weight:600}thead th{position:sticky;top:0;background:#eef6f0}
.heat{font-variant-numeric:tabular-nums}.tag{display:inline-block;padding:2px 8px;border-radius:999px;background:#e7f6ec;color:var(--forest);font-size:11px;font-weight:600}
.foot{color:var(--mut);font-size:12px;margin-top:24px}.up{color:var(--p);font-weight:700}
</style></head><body>
<header><h1>Distribución de Modelos por Región <span class="tag">Advance · Telemetría</span></h1>
<div class="sub">Parque vehicular por agencia/estado · base para priorizar certificación Cummins · datos reales Mapon · generado ${D.generado}</div></header>
<div class="wrap">
 <div class="kpis">
  <div class="kpi"><b id="k1"></b><span>Unidades totales</span></div>
  <div class="kpi"><b id="k2"></b><span>% marca FOTON</span></div>
  <div class="kpi"><b id="k3"></b><span>Modelos distintos</span></div>
  <div class="kpi"><b id="k4"></b><span>VIN válidos (únicos)</span></div>
  <div class="kpi"><b id="k5"></b><span>VIN a revisar</span></div>
 </div>
 <div class="grid">
  <div class="card"><h2>Unidades por región</h2><p>Asignación por última posición GPS (point-in-polygon vs estados).</p><canvas id="cReg"></canvas></div>
  <div class="card"><h2>Top 15 modelos (flota total)</h2><p>El conteo es la etiqueta; el tooltip da el % del total.</p><canvas id="cMod"></canvas></div>
 </div>
 <div class="card full"><h2>Matriz Región × Modelo (top 15)</h2><p>Mapa de calor de unidades. Sirve para ver qué motor/producto domina cada plaza.</p><div id="tabla"></div></div>
 <div class="grid">
  <div class="card"><h2>Tendencia de altas (últimos 12 meses)</h2><p>Altas mensuales de unidades en Mapon (proxy del crecimiento de flota).</p><canvas id="cTend"></canvas></div>
  <div class="card"><h2>Proyección de flota a 12 meses</h2><p>Ritmo = prom. altas/mes (últimos 6 meses) por región, extrapolado.</p><canvas id="cProy"></canvas></div>
 </div>
 <div class="card full"><h2>Expectativa de crecimiento por región</h2><p>Con la tendencia actual de altas.</p>
  <table><thead><tr><th>Región</th><th>Estado</th><th>Actual</th><th>Ritmo (u/mes)</th><th>Proy. 6 m</th><th>Proy. 12 m</th><th>Crec. 12 m</th></tr></thead><tbody id="tCrec"></tbody></table>
 </div>
 <div class="foot">Nota: la región se infiere de la <b>última posición GPS</b> (dónde está la unidad hoy), no necesariamente su plaza base. Para el censo definitivo por agencia se cruzará el VIN contra el ERP de FOTON. ${D.otras} unidades quedaron fuera de las 9 regiones ("Otras").</div>
</div>
<script>
const D=${J};
Chart.register(ChartDataLabels);
const GREENS=['#0f5132','#15803d','#16a34a','#22c55e','#4ade80','#86efac','#0ea5a0','#0891b2','#14b8a6','#65a30d'];
const g=(id)=>document.getElementById(id).getContext('2d');
document.getElementById('k1').textContent=D.totalUnidades.toLocaleString('es-MX');
document.getElementById('k2').textContent=D.fotonPct+'%';
document.getElementById('k3').textContent=D.modelosDistintos;
document.getElementById('k4').textContent=D.vinOk.toLocaleString('es-MX');
document.getElementById('k5').textContent=D.vinRevisar;
const tot=D.porRegion.reduce((a,b)=>a+b,0)+D.otras;

new Chart(g('cReg'),{type:'bar',data:{labels:D.regiones,datasets:[{data:D.porRegion,backgroundColor:'#16a34a',borderRadius:6}]},
 options:{plugins:{legend:{display:false},datalabels:{anchor:'end',align:'end',color:'#0f5132',font:{weight:700},formatter:v=>v||''},
  tooltip:{callbacks:{label:c=>((c.raw/tot)*100).toFixed(1)+'% de la flota'}}},scales:{y:{beginAtZero:true}}}});

new Chart(g('cMod'),{type:'bar',data:{labels:D.topModelos.map(x=>x[0]),datasets:[{data:D.topModelos.map(x=>x[1]),backgroundColor:'#15803d',borderRadius:5}]},
 options:{indexAxis:'y',plugins:{legend:{display:false},datalabels:{anchor:'end',align:'right',color:'#0f5132',font:{weight:700}},
  tooltip:{callbacks:{label:c=>((c.raw/D.totalUnidades)*100).toFixed(1)+'% del total'}}},scales:{x:{beginAtZero:true}}}});

// Matriz heatmap
(function(){const keys=D.topModelKeys;let h='<table class="heat"><thead><tr><th>Región</th>'+keys.map(k=>'<th>'+k+'</th>').join('')+'<th>Total</th></tr></thead><tbody>';
 let max=0;for(const R of D.regiones)for(const k of keys)max=Math.max(max,D.matriz[R][k]||0);
 for(const R of D.regiones){let tr=0;h+='<tr><td>'+R+'</td>';for(const k of keys){const v=D.matriz[R][k]||0;tr+=v;const a=max?v/max:0;
   h+='<td style="background:rgba(22,163,74,'+(a*0.85).toFixed(2)+');color:'+(a>0.5?'#fff':'#0b1f17')+'">'+(v||'')+'</td>';}
   h+='<td><b>'+tr+'</b></td></tr>';}
 h+='</tbody></table>';document.getElementById('tabla').innerHTML=h;})();

new Chart(g('cTend'),{type:'line',data:{labels:D.meses,datasets:[{data:D.altasGlob,borderColor:'#16a34a',backgroundColor:'rgba(22,163,74,.15)',fill:true,tension:.35,pointRadius:3}]},
 options:{plugins:{legend:{display:false},datalabels:{display:false},tooltip:{callbacks:{label:c=>c.raw+' altas'}}},scales:{y:{beginAtZero:true}}}});

new Chart(g('cProy'),{type:'bar',data:{labels:D.regiones,datasets:[
  {label:'Actual',data:D.regiones.map(R=>D.crecimiento[R].actual),backgroundColor:'#94d3a8',borderRadius:5},
  {label:'Proy. 12 m',data:D.regiones.map(R=>D.crecimiento[R].proy12),backgroundColor:'#0f5132',borderRadius:5}]},
 options:{plugins:{legend:{position:'bottom'},datalabels:{display:false}},scales:{y:{beginAtZero:true}}}});

// Tabla crecimiento
(function(){const EST={'Altamira':'Tamaulipas','Tula':'Hidalgo','Zacatecas':'Zacatecas','Aguascalientes':'Aguascalientes','León':'Guanajuato','Querétaro':'Querétaro','Monterrey':'Nuevo León','San Luis Potosí':'San Luis Potosí','Durango':'Durango'};
 let h='';for(const R of D.regiones){const c=D.crecimiento[R];
  h+='<tr><td><b>'+R+'</b></td><td>'+EST[R]+'</td><td>'+c.actual+'</td><td>'+c.ritmoMes+'</td><td>'+c.proy6+'</td><td>'+c.proy12+'</td><td class="up">+'+c.pct12+'%</td></tr>';}
 document.getElementById('tCrec').innerHTML=h;})();
</script></body></html>`;
}

main().catch(e => { console.error('FALLÓ:', e.message); process.exit(1); });

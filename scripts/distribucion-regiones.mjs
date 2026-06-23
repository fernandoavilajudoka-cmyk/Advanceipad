// scripts/distribucion-regiones.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Distribución del parque vehicular por REGIÓN/ESTADO + MODELO (y motor).
// Pedido por el cliente: identificar el tipo de producto/motor de cada zona para
// priorizar la certificación de distribuidores Cummins.
//
// USO:
//   MAPON_KEY=<apikey>  node scripts/distribucion-regiones.mjs            # diagnóstico
//   MAPON_KEY=<apikey>  node scripts/distribucion-regiones.mjs --extraer  # matriz final
//
// La API key NUNCA se escribe en archivos ni en logs.
//
// Estrategia para asignar una unidad a una región (en orden de confiabilidad):
//   1) GRUPOS de Mapon  (unit_groups/list.json) cuyo nombre corresponda a una agencia/región.
//   2) CONVENCIÓN de nombre en label/number (prefijo de plaza).
//   3) REVERSE GEOCODE de la última posición lat/lng → estado mexicano (fallback).
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from 'fs';

const BASE = 'https://portal.smart-connect.com.mx/api/v1';
const KEY  = process.env.MAPON_KEY || process.env.MAPON_DIST || '';
const EXTRAER = process.argv.includes('--extraer');
// --series : genera el listado de unidades con VIN/número de serie para el ERP de FOTON.
const SERIES = process.argv.includes('--series');
// --posicion : asigna región por la ÚLTIMA POSICIÓN (lat/lng de unit/list) en vez de por grupos.
const FORZAR_POSICION = process.argv.includes('--posicion');

if (!KEY || KEY.length < 10) {
  console.error('ERROR: falta la API key. Corre:  MAPON_KEY=<apikey> node scripts/distribucion-regiones.mjs');
  process.exit(1);
}

// Regiones que pidió el cliente (Región/Agencia → Estado).
const REGIONES = [
  { region: 'Altamira',         estado: 'Tamaulipas' },
  { region: 'Tula',             estado: 'Hidalgo' },
  { region: 'Zacatecas',        estado: 'Zacatecas' },
  { region: 'Aguascalientes',   estado: 'Aguascalientes' },
  { region: 'León',             estado: 'Guanajuato' },
  { region: 'Querétaro',        estado: 'Querétaro' },
  { region: 'Monterrey',        estado: 'Nuevo León' },
  { region: 'San Luis Potosí',  estado: 'San Luis Potosí' },
  { region: 'Durango',          estado: 'Durango' },
];

// Normaliza texto (sin acentos, minúsculas) para emparejar nombres de grupos/estados.
const norm = s => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ── Helper de API ──
async function api(method, params = {}) {
  const u = new URL(BASE + '/' + method);
  u.searchParams.set('key', KEY);
  for (const k in params) u.searchParams.set(k, params[k]);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${method} → HTTP ${r.status}`);
  return r.json();
}

// ── Reverse geocode (fallback) vía Nominatim/OSM. Devuelve el estado (admin level 4). ──
async function estadoDeCoords(lat, lng) {
  try {
    const u = new URL('https://nominatim.openstreetmap.org/reverse');
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('lat', lat); u.searchParams.set('lon', lng);
    u.searchParams.set('zoom', '5'); u.searchParams.set('accept-language', 'es');
    const r = await fetch(u, { headers: { 'User-Agent': 'Advance-Telemetria/1.0' } });
    const j = await r.json();
    return j.address?.state || null;
  } catch (e) { return null; }
}

// Empareja un nombre (grupo/estado) con una de las 9 regiones del cliente.
function emparejarRegion(nombre) {
  const n = norm(nombre);
  if (!n) return null;
  for (const R of REGIONES) {
    if (n.includes(norm(R.region)) || n.includes(norm(R.estado))) return R.region;
  }
  return null;
}

async function main() {
  // 1) Unidades (con modelo y posición)
  const ul = await api('unit/list.json', { include: 'technical_details' });
  const units = ul.data?.units || [];
  console.log(`\n■ Unidades totales: ${units.length}`);

  // ── LISTADO PARA FOTON: unidades con VIN/número de serie ───────────────────
  if (SERIES) {
    const esVin = s => /^[A-HJ-NPR-Z0-9]{17}$/i.test((s || '').replace(/\s/g, ''));
    const rows = [];
    let conVin = 0, soloPlaca = 0;
    for (const u of units) {
      const vinReal = esVin(u.vin) ? u.vin.replace(/\s/g, '')
                    : esVin(u.number) ? u.number.replace(/\s/g, '') : '';
      if (vinReal) conVin++; else soloPlaca++;
      rows.push({
        unit_id: u.unit_id,
        vin: vinReal,
        placa: u.number || '',
        make: u.make || '',
        model: u.model || '',
        label: u.label || '',
        anio: u.technical_details?.make_year || '',
        emision: u.technical_details?.emission_class || '',
        falta_vin: vinReal ? '' : 'SIN VIN',
      });
    }
    const esc = v => `"${String(v).replace(/"/g, '""')}"`;
    const head = ['unit_id', 'vin', 'placa', 'make', 'model', 'label', 'anio', 'emision', 'falta_vin'];
    const csv = [head.join(',')].concat(rows.map(r => head.map(h => esc(r[h])).join(','))).join('\n');
    writeFileSync('listado-unidades-foton.csv', csv);
    console.log(`\n✔ listado-unidades-foton.csv · ${rows.length} unidades · con VIN real: ${conVin} · solo placa (SIN VIN): ${soloPlaca}`);
    return;
  }

  // 2) Grupos
  let groups = [];
  try { const g = await api('unit_groups/list.json'); groups = g.data?.unit_groups || g.data?.groups || []; }
  catch (e) { console.log('  (unit_groups no disponible: ' + e.message + ')'); }

  // ── DIAGNÓSTICO ──────────────────────────────────────────────────────────
  if (!EXTRAER) {
    console.log('\n══════════ DIAGNÓSTICO ══════════');

    // Muestra de campos de unidad
    console.log('\n● Muestra de 5 unidades (campos clave):');
    units.slice(0, 5).forEach(u => {
      console.log(`   label="${u.label}"  make="${u.make||''}"  model="${u.model||''}"  number="${u.number||''}"  lat=${u.lat} lng=${u.lng}  cc=${u.country_code||''}`);
    });

    // Modelos distintos
    const modelos = [...new Set(units.map(u => u.model || u.label).filter(Boolean))].sort();
    console.log(`\n● Modelos distintos (${modelos.length}): ${modelos.join(' · ')}`);

    // Grupos y si emparejan con regiones
    console.log(`\n● Grupos de unidades (${groups.length}):`);
    let emparejados = 0;
    for (const g of groups) {
      const nombre = g.name || g.title || g.label || '';
      const reg = emparejarRegion(nombre);
      if (reg) emparejados++;
      console.log(`   [${g.id ?? '?'}] "${nombre}"  →  ${reg ? 'REGIÓN: ' + reg : '(sin región)'}`);
    }

    // Veredicto de estrategia
    console.log('\n● Estrategia recomendada:');
    if (emparejados >= 3) {
      console.log(`   ✔ GRUPOS — ${emparejados} grupos emparejan con las regiones del cliente. Usar grupos.`);
    } else {
      const conPos = units.filter(u => u.lat && u.lng).length;
      console.log(`   ✗ Los grupos NO corresponden a las regiones.`);
      console.log(`   → Fallback: reverse geocode de posición. ${conPos}/${units.length} unidades tienen lat/lng.`);
      console.log(`   → Alternativa: ¿hay convención de nombre en label/number que indique la plaza? (revisar muestra de arriba)`);
    }
    console.log('\n(Para generar la matriz final: agrega  --extraer)\n');
    return;
  }

  // ── EXTRACCIÓN: matriz Región × Modelo ───────────────────────────────────
  // Mapa unit_id → región vía grupos.
  const regionDeUnidad = {};
  const gruposRegion = groups
    .map(g => ({ id: g.id, region: emparejarRegion(g.name || g.title || g.label || '') }))
    .filter(g => g.region);

  if (gruposRegion.length >= 3 && !FORZAR_POSICION) {
    console.log(`Asignando por GRUPOS (${gruposRegion.length} grupos-región)…`);
    for (const g of gruposRegion) {
      try {
        const lu = await api('unit_groups/list_units.json', { unit_group_id: g.id });
        const ids = (lu.data?.units || lu.data?.unit_ids || []).map(x => x.unit_id ?? x.id ?? x);
        for (const id of ids) regionDeUnidad[id] = g.region;
      } catch (e) { console.log(`  grupo ${g.id} falló: ${e.message}`); }
    }
  } else {
    console.log(`Asignando por ÚLTIMA POSICIÓN (reverse geocode lat/lng)${FORZAR_POSICION ? ' [forzado --posicion]' : ' [fallback]'}…`);
    for (const u of units) {
      if (!u.lat || !u.lng) continue;
      const estado = await estadoDeCoords(u.lat, u.lng);
      const reg = emparejarRegion(estado);
      if (reg) regionDeUnidad[u.unit_id] = reg;
      await new Promise(r => setTimeout(r, 1100)); // respeta rate limit de Nominatim
    }
  }

  // Construir matriz
  const matriz = {}; // region → { modelo → conteo }
  const sinRegion = [];
  for (const u of units) {
    const reg = regionDeUnidad[u.unit_id] || null;
    const modelo = u.model || u.label || '(sin modelo)';
    if (!reg) { sinRegion.push(u.label || u.number); continue; }
    matriz[reg] = matriz[reg] || {};
    matriz[reg][modelo] = (matriz[reg][modelo] || 0) + 1;
  }

  // Reporte
  console.log('\n══════════ DISTRIBUCIÓN MODELO × REGIÓN ══════════');
  for (const R of REGIONES) {
    const m = matriz[R.region];
    const total = m ? Object.values(m).reduce((a, b) => a + b, 0) : 0;
    console.log(`\n▸ ${R.region} (${R.estado}) — ${total} unidades`);
    if (m) Object.entries(m).sort((a, b) => b[1] - a[1]).forEach(([mod, n]) => console.log(`     ${n.toString().padStart(3)}  ${mod}`));
  }
  if (sinRegion.length) console.log(`\n⚠ ${sinRegion.length} unidades sin región asignada: ${sinRegion.slice(0, 20).join(', ')}${sinRegion.length > 20 ? '…' : ''}`);

  // Salida JSON+CSV para el informe / cliente
  writeFileSync('distribucion-regiones.json', JSON.stringify({ generado: new Date().toISOString(), regiones: REGIONES, matriz, sinRegion }, null, 2));
  const filasCsv = ['region,estado,modelo,unidades'];
  for (const R of REGIONES) { const m = matriz[R.region] || {}; for (const [mod, n] of Object.entries(m)) filasCsv.push(`"${R.region}","${R.estado}","${mod}",${n}`); }
  writeFileSync('distribucion-regiones.csv', filasCsv.join('\n'));
  console.log('\n✔ Escritos: distribucion-regiones.json  y  distribucion-regiones.csv\n');
}

main().catch(e => { console.error('FALLÓ:', e.message); process.exit(1); });

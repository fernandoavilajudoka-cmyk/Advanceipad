// scripts/build-deck.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Tablero ejecutivo a partir de clientes/<slug>/historico.json:
//   Vista 1 · Operacion del ultimo mes cerrado, contra objetivo y contra el mes previo
//   Vista 2 · Dinero: fugas medidas, acumulado del historico y decisiones
//   Vista 3 · Anexo: historico mensual y desglose por unidad
//
//   node scripts/build-deck.mjs            → un tablero por cada historico.json
// Salida: clientes/<slug>/tablero.html   (autocontenido: logo y estilos incrustados)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';

const DIESEL = 25.99;      // $/L
const IDLE_LH = 5;         // L/h de motor en ralenti
const OBJ = { kml: 3.0, ralenti: 15, nocturno: 20, vel: 85 };

const LOGO = existsSync('assets/logo-advance.png')
  ? 'data:image/png;base64,' + readFileSync('assets/logo-advance.png').toString('base64') : '';

const nf = (v, d = 0) => Number(v || 0).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = v => '$' + nf(v);
const MESL = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mesLbl = ym => { const [y, m] = ym.split('-'); return `${MESL[+m - 1]} ${y.slice(2)}`; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function construir(H) {
  const meses = H.meses.filter(m => (H.resumenMes[m]?.km || 0) > 100);
  const ultimo = meses[meses.length - 1], previo = meses[meses.length - 2];
  const R = H.resumenMes;
  // El mes en curso esta incompleto: el detalle operativo se lee del ultimo mes cerrado.
  const hoyYM = new Date().toISOString().slice(0, 7);
  const cerrado = ultimo === hoyYM ? meses[meses.length - 2] : ultimo;
  const anterior = meses[meses.indexOf(cerrado) - 1];
  const C = R[cerrado], P = R[anterior] || C;

  const kml = r => (r.l ? r.km / r.l : 0);
  const pctIdle = r => (r.motor ? r.ralenti / r.motor * 100 : 0);
  const pctNoct = r => (r.manejo ? r.nocturno / r.manejo * 100 : 0);
  const costoKm = r => (r.km ? r.l * DIESEL / r.km : 0);

  // Acumulados de todo el historico
  const acc = meses.reduce((a, m) => {
    const r = R[m];
    a.km += r.km; a.l += r.l; a.motor += r.motor; a.ralenti += r.ralenti;
    a.drain += r.drain; a.drainL += r.drainL; a.exces += r.exces; a.jammer += r.jammer;
    return a;
  }, { km: 0, l: 0, motor: 0, ralenti: 0, drain: 0, drainL: 0, exces: 0, jammer: 0 });

  // Primer mes con cada alerta configurada: antes de eso, un 0 no significa "no ocurrio".
  const desdeExces = meses.find(m => R[m].exces > 0);
  const desdeDrain = meses.find(m => R[m].drain > 0);

  const fugaDrain = R[cerrado].drainL * DIESEL;
  const fugaIdle = R[cerrado].ralenti * IDLE_LH * DIESEL;
  const fugaMes = fugaDrain + fugaIdle;
  const ahorroIdle = Math.max(0, (pctIdle(C) - OBJ.ralenti) / (pctIdle(C) || 1)) * fugaIdle;

  const delta = (a, b, inv) => {
    if (!b) return { t: '—', c: 'nu' };
    const d = (a - b) / Math.abs(b) * 100;
    if (Math.abs(d) < 0.5) return { t: 'sin cambio', c: 'nu' };
    const bueno = inv ? d < 0 : d > 0;
    return { t: `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%`, c: bueno ? 'ok' : 'ma' };
  };

  // ── Indicadores contra objetivo (mes cerrado) ──
  const ind = [
    { n: 'Rendimiento de combustible', a: nf(kml(C), 2) + ' km/L', o: OBJ.kml.toFixed(2), br: `${kml(C) >= OBJ.kml ? '+' : ''}${((kml(C) / OBJ.kml - 1) * 100).toFixed(1)}% vs ficha`, e: kml(C) >= OBJ.kml ? 'ok' : 'wr', d: delta(kml(C), kml(P)) },
    { n: 'Drenajes de diésel', a: nf(C.drain) + ' eventos', o: '0', br: nf(C.drainL) + ' L perdidos', e: 'cr', d: delta(C.drain, P.drain, true) },
    { n: 'Excesos de velocidad', a: nf(C.exces), o: '0', br: nf(C.exces / (C.km / 100), 1) + ' por 100 km', e: 'cr', d: delta(C.exces, P.exces, true) },
    { n: 'Velocidad máxima registrada', a: nf(C.vmax) + ' km/h', o: OBJ.vel + ' km/h', br: `+${nf(C.vmax - OBJ.vel)} km/h`, e: 'cr', d: delta(C.vmax, P.vmax, true) },
    { n: 'Tiempo en ralentí', a: nf(pctIdle(C), 1) + '%', o: OBJ.ralenti + '%', br: `+${nf(pctIdle(C) - OBJ.ralenti, 1)} puntos`, e: pctIdle(C) > OBJ.ralenti ? 'wr' : 'ok', d: delta(pctIdle(C), pctIdle(P), true) },
    { n: 'Conducción nocturna', a: nf(pctNoct(C), 1) + '%', o: OBJ.nocturno + '%', br: `+${nf(pctNoct(C) - OBJ.nocturno, 1)} puntos`, e: pctNoct(C) > OBJ.nocturno ? 'wr' : 'ok', d: delta(pctNoct(C), pctNoct(P), true) },
    { n: 'Exposición a inhibidor de señal', a: nf(C.jammer), o: '0', br: 'bloqueo de rastreo', e: 'wr', d: delta(C.jammer, P.jammer, true) },
    { n: 'Unidades operando', a: `${C.activas} de ${H.unidades.length + H.sinDatos.length}`, o: nf(H.unidades.length + H.sinDatos.length), br: `${H.sinDatos.length} nunca han reportado`, e: 'cr', d: delta(C.activas, P.activas) },
  ];

  // ── Serie mensual para las barras ──
  const maxKm = Math.max(...meses.map(m => R[m].km));
  const barras = meses.map(m => {
    const r = R[m];
    return `<div class="bar-col"><div class="bar-v">${nf(kml(r), 2)}</div>
      <div class="bar-t"><div class="bar-f" style="height:${Math.round(r.km / maxKm * 100)}%"></div></div>
      <div class="bar-l">${mesLbl(m)}</div></div>`;
  }).join('');

  // ── Tabla mensual del anexo ──
  const filasMes = meses.map(m => {
    const r = R[m];
    return `<tr><td class="met">${mesLbl(m)}</td><td class="r">${nf(r.activas)}</td><td class="r">${nf(r.km)}</td>
      <td class="r">${nf(r.l)}</td><td class="r act">${nf(kml(r), 2)}</td><td class="r">${nf(pctIdle(r), 1)}%</td>
      <td class="r">${nf(r.vmax)}</td><td class="r">${r.exces ? nf(r.exces) : '<span class="sd">s/reg</span>'}</td>
      <td class="r">${r.drain ? nf(r.drain) : '<span class="sd">s/reg</span>'}</td>
      <td class="r">${r.drainL ? nf(r.drainL) : '—'}</td>
      <td class="r cr">${r.drainL ? money(Math.round(r.drainL * DIESEL)) : '—'}</td></tr>`;
  }).join('');

  // ── Matriz unidad × mes ──
  const U = H.unidades.map(u => {
    const t = Object.values(u.porMes);
    const km = t.reduce((s, x) => s + x.km, 0), l = t.reduce((s, x) => s + x.l, 0);
    const motor = t.reduce((s, x) => s + x.motor, 0), ral = t.reduce((s, x) => s + x.ralenti, 0);
    return {
      number: u.number, model: u.model || u.label, alta: u.alta,
      km, l, kml: l ? km / l : 0, idle: motor ? ral / motor * 100 : 0,
      vmax: Math.max(0, ...t.map(x => x.vmax)),
      exces: t.reduce((s, x) => s + x.exces, 0),
      drain: t.reduce((s, x) => s + x.drain, 0),
      drainL: t.reduce((s, x) => s + x.drainL, 0),
      meses: u.porMes,
    };
  }).sort((a, b) => b.km - a.km);

  const celda = (v, tipo) => {
    if (v == null) return '<td class="mz nd">·</td>';
    const val = { km: () => nf(v.km), kml: () => v.l ? nf(v.km / v.l, 2) : '—',
      idle: () => v.motor ? nf(v.ralenti / v.motor * 100, 0) + '%' : '—',
      vmax: () => nf(v.vmax), exces: () => nf(v.exces),
      drainL: () => v.drainL ? nf(v.drainL) : '0' }[tipo]();
    return `<td class="mz">${val}</td>`;
  };
  const matriz = tipo => U.map(u => `<tr><td class="mz-u">${esc(u.number)}</td>` +
    meses.map(m => celda(u.meses[m], tipo)).join('') + '</tr>').join('');

  const filasU = U.map(u => `<tr>
    <td class="met">${esc(u.number)}</td><td class="mod">${esc(u.model)}</td>
    <td class="r">${nf(Object.keys(u.meses).length)}</td>
    <td class="r act">${nf(u.km)}</td><td class="r">${nf(u.l)}</td>
    <td class="r ${u.kml >= OBJ.kml ? 'ok' : u.kml >= OBJ.kml * .9 ? 'wr' : 'cr'}">${nf(u.kml, 2)}</td>
    <td class="r ${u.idle > 30 ? 'cr' : u.idle > OBJ.ralenti ? 'wr' : 'ok'}">${nf(u.idle, 1)}%</td>
    <td class="r ${u.vmax > 120 ? 'cr' : 'wr'}">${nf(u.vmax)}</td>
    <td class="r">${nf(u.exces)}</td>
    <td class="r ${u.drainL > 3000 ? 'cr' : ''}">${nf(u.drainL)}</td>
    <td class="r cr">${money(Math.round(u.drainL * DIESEL))}</td></tr>`).join('')
    // Las unidades que nunca reportaron también se listan: omitirlas escondería
    // que la flota registrada es mayor que la flota medida.
    + H.sinDatos.map(u => `<tr><td class="met">${esc(u.number)}</td><td class="mod">${esc(u.label || '—')}</td>
      <td class="r cr">0</td><td class="r" colspan="7" style="text-align:center;color:var(--t3);font-style:italic">
      sin un solo viaje ni lectura de motor${u.ultimo ? ` · última señal ${u.ultimo}` : ''}</td>
      <td class="r"><span class="st st-cr">Sin reportar</span></td></tr>`).join('');

  const rango = `${mesLbl(meses[0])} – ${mesLbl(meses[meses.length - 1])}`;
  const marca = LOGO ? `<img src="${LOGO}" alt="Advance">` : '<span class="wm">ADVANCE</span>';
  const lock = `<div class="lock">${marca}<div class="lock-s">Informe Gerencial de Flota</div></div>`;

  return `<title>${esc(H.cliente)} · Tablero Ejecutivo de Flota</title>
<style>
:root,:root[data-theme="dark"],:root[data-theme="light"]{
  color-scheme:light;
  --bg:#e6f1de;--glass:rgba(255,255,255,.46);--glass-strong:rgba(255,255,255,.72);
  --blur:blur(24px) saturate(175%);--brd:rgba(255,255,255,.60);--brd2:rgba(21,128,61,.16);
  --line:rgba(21,128,61,.10);--s3:rgba(238,248,231,.66);
  --t:#10261c;--t2:#4c6053;--t3:#85a08f;
  --forest:#0f5132;--gr:#16a34a;--gr2:#15803d;--gr-bg:rgba(22,163,74,.13);
  --or:#d98324;--or-bg:rgba(217,131,36,.13);--rd:#d64b34;--rd-bg:rgba(214,75,52,.12);
  --shadow:0 18px 48px rgba(16,70,38,.16);--shadow-sm:0 10px 30px rgba(16,70,38,.10);
  --r:16px;--mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:var(--t);
  font-size:13px;line-height:1.55;font-variant-numeric:tabular-nums;background:var(--bg);
  background-image:radial-gradient(720px 560px at 2% -10%,rgba(34,197,94,.22),transparent 58%),
    radial-gradient(680px 560px at 106% 0%,rgba(22,163,74,.20),transparent 56%),
    radial-gradient(560px 520px at 80% 108%,rgba(15,81,50,.16),transparent 60%);
  background-attachment:fixed}
.deck{scroll-snap-type:y mandatory;overflow-y:auto;height:100dvh}
.slide{scroll-snap-align:start;min-height:100dvh;display:flex;flex-direction:column;
  padding:clamp(14px,2vw,28px);gap:clamp(9px,1.2vw,16px)}
.card{background:var(--glass);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);
  border:1px solid var(--brd);border-radius:var(--r);box-shadow:var(--shadow-sm)}

/* Encabezado con el lockup de marca */
.hdr{display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap;
  padding:clamp(11px,1.3vw,16px) clamp(14px,1.6vw,22px)}
.hdr-l{display:flex;align-items:center;gap:16px}
.lock{background:var(--forest);border-radius:10px;padding:10px 14px 8px;text-align:center;flex:none;
  box-shadow:0 6px 18px rgba(15,81,50,.28)}
.lock img{display:block;height:22px;width:auto}
.lock .wm{display:block;color:#fff;font-weight:800;letter-spacing:2px;font-size:15px}
.lock-s{color:rgba(255,255,255,.72);font-size:8px;letter-spacing:.6px;margin-top:3px}
.cliente{font-size:clamp(16px,1.9vw,22px);font-weight:800;letter-spacing:-.5px;line-height:1.15;color:var(--forest)}
.sub{font-family:var(--mono);font-size:10px;color:var(--t2);letter-spacing:.5px;margin-top:4px}
.hdr-r{text-align:right;font-family:var(--mono);font-size:10px;color:var(--t2);line-height:1.75}
.hdr-r b{color:var(--gr2)}
.vista{display:inline-block;border:1px solid var(--brd2);border-radius:20px;background:var(--s3);
  padding:2px 10px;color:var(--t3);letter-spacing:1.2px;font-size:9px;font-weight:700}

.heros{display:grid;grid-template-columns:repeat(4,1fr);gap:clamp(8px,1vw,13px)}
.hero{padding:clamp(11px,1.3vw,18px);border-top:3px solid var(--gr)}
.hero .k{font-size:9.5px;letter-spacing:1.1px;color:var(--t2);text-transform:uppercase;font-weight:700}
.hero .v{font-size:clamp(23px,3.2vw,40px);font-weight:800;letter-spacing:-1.8px;line-height:1.05;margin-top:5px;color:var(--forest)}
.hero .u{font-size:clamp(10px,.95vw,13px);font-weight:600;color:var(--t2)}
.hero .f{font-family:var(--mono);font-size:9.5px;color:var(--t3);margin-top:4px}
.chg{font-size:9.5px;font-weight:800;letter-spacing:.3px;font-family:var(--mono)}
.chg.ok{color:var(--gr2)} .chg.ma{color:var(--rd)} .chg.nu{color:var(--t3)}

.panel{flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0}
.panel-t{display:flex;justify-content:space-between;align-items:center;gap:10px;
  padding:9px clamp(13px,1.5vw,19px);border-bottom:1px solid var(--brd2);background:var(--glass-strong)}
.panel-t h2{font-size:10px;letter-spacing:1.5px;color:var(--t2);text-transform:uppercase;font-weight:800}
.panel-t span{font-family:var(--mono);font-size:9.5px;color:var(--t3)}
.scroll{overflow:auto;min-height:0;flex:1}
table{width:100%;border-collapse:collapse}
thead th{font-size:9px;letter-spacing:1.1px;color:var(--t3);text-transform:uppercase;text-align:left;
  padding:7px clamp(9px,1.1vw,14px);font-weight:700;border-bottom:1px solid var(--brd2);
  position:sticky;top:0;background:#eaf4e3;z-index:2}
tbody td{padding:clamp(5px,.7vw,10px) clamp(9px,1.1vw,14px);border-bottom:1px solid var(--line);font-size:clamp(10.5px,1vw,13px)}
tbody tr:nth-child(odd){background:var(--s3)}
tbody tr:last-child td{border-bottom:none}
.met{font-weight:700;color:var(--t)}
.mod{color:var(--t2);font-size:11px}
.act{font-family:var(--mono);font-weight:700;color:var(--forest)}
.obj{font-family:var(--mono);color:var(--t3)}
.r{text-align:right;font-family:var(--mono)}
.ok{color:var(--gr2);font-weight:700} .wr{color:var(--or);font-weight:700} .cr{color:var(--rd);font-weight:700}
.sd{color:var(--t3);font-style:italic;font-size:10px}
.st{display:inline-block;min-width:104px;text-align:center;padding:3px 9px;border-radius:20px;
  font-size:9px;font-weight:800;letter-spacing:1px;text-transform:uppercase}
.st-ok{background:var(--gr-bg);color:var(--gr2);box-shadow:inset 0 0 0 1px rgba(22,163,74,.3)}
.st-wr{background:var(--or-bg);color:var(--or);box-shadow:inset 0 0 0 1px rgba(217,131,36,.32)}
.st-cr{background:var(--rd-bg);color:var(--rd);box-shadow:inset 0 0 0 1px rgba(214,75,52,.34)}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:7px;vertical-align:1px}
.d-ok{background:var(--gr)} .d-wr{background:var(--or)} .d-cr{background:var(--rd)}

/* Barras de tendencia mensual */
.bars{display:flex;gap:clamp(3px,.5vw,9px);align-items:flex-end;padding:clamp(10px,1.2vw,16px);height:100%}
.bar-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%}
.bar-v{font-family:var(--mono);font-size:10px;font-weight:700;color:var(--forest)}
.bar-t{flex:1;width:100%;display:flex;align-items:flex-end;background:var(--s3);border-radius:5px;overflow:hidden;min-height:26px}
.bar-f{width:100%;background:linear-gradient(180deg,var(--gr),var(--forest));border-radius:5px 5px 0 0}
.bar-l{font-family:var(--mono);font-size:9px;color:var(--t3);text-transform:uppercase}

.leaks{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(8px,1vw,13px)}
.leak{border-top:3px solid var(--rd);padding:clamp(12px,1.4vw,19px);display:flex;flex-direction:column;gap:4px}
.leak.warn{border-top-color:var(--or)}
.leak .k{font-size:9.5px;letter-spacing:1.1px;color:var(--t2);text-transform:uppercase;font-weight:700}
.leak .v{font-size:clamp(21px,2.9vw,36px);font-weight:800;letter-spacing:-1.6px;line-height:1.05;color:var(--rd)}
.leak.warn .v{color:var(--or)}
.leak .y{font-family:var(--mono);font-size:10px;color:var(--t3)}
.leak .d{font-size:12px;color:var(--t2);line-height:1.55;margin-top:3px}
.leak .d b{color:var(--t)}
.total{border-left:4px solid var(--gr);background:var(--glass-strong);padding:clamp(13px,1.5vw,20px);
  display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}
.total .k{font-size:9.5px;letter-spacing:1.3px;color:var(--t2);text-transform:uppercase;font-weight:700}
.total .v{font-size:clamp(27px,3.9vw,50px);font-weight:800;letter-spacing:-2.2px;line-height:1;margin-top:3px;color:var(--forest)}
.total .n{font-size:12px;color:var(--t2);max-width:50ch;line-height:1.6}
.acts{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(8px,1vw,13px);flex:1;min-height:0}
.act-c{padding:clamp(12px,1.4vw,19px);display:flex;flex-direction:column;gap:7px}
.act-c .n{font-family:var(--mono);font-size:9.5px;letter-spacing:1.2px;color:var(--gr2);font-weight:700}
.act-c .t{font-size:clamp(13px,1.4vw,16px);font-weight:800;letter-spacing:-.3px;line-height:1.3;color:var(--forest)}
.act-c .b{font-size:12px;color:var(--t2);line-height:1.55;flex:1}
.act-c .g{font-family:var(--mono);font-size:10.5px;color:var(--gr2);font-weight:700;border-top:1px solid var(--brd2);padding-top:8px}

/* Matriz unidad × mes */
.tabs{display:flex;gap:5px;flex-wrap:wrap}
.tab{border:1px solid var(--brd2);background:var(--s3);color:var(--t2);border-radius:20px;
  padding:3px 11px;font-size:9.5px;font-weight:700;letter-spacing:.6px;cursor:pointer;font-family:inherit;
  text-transform:uppercase}
.tab[aria-selected="true"]{background:var(--forest);color:#fff;border-color:var(--forest)}
.tab:focus-visible{outline:2px solid var(--gr);outline-offset:2px}
.mz{text-align:right;font-family:var(--mono);font-size:11px}
.mz.nd{color:#c3d6c6;text-align:center}
.mz-u{font-family:var(--mono);font-weight:700;font-size:11px;position:sticky;left:0;background:#eaf4e3;z-index:1}
tbody tr:nth-child(odd) .mz-u{background:#e4f0dd}

.foot{font-size:9.5px;color:var(--t3);line-height:1.65;border-top:1px solid var(--brd2);padding-top:8px}
.foot b{color:var(--t2)}
.pager{position:fixed;right:11px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:8px;z-index:20}
.pager a{width:9px;height:9px;border-radius:50%;background:var(--brd);display:block;border:1px solid var(--gr2)}
.pager a:hover,.pager a:focus-visible{background:var(--gr);outline:none;box-shadow:0 0 0 3px var(--gr-bg)}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.hero,.leak,.act-c{animation:rise .4s cubic-bezier(.2,.7,.3,1) backwards}
.hero:nth-child(2),.leak:nth-child(2),.act-c:nth-child(2){animation-delay:.07s}
.hero:nth-child(3),.leak:nth-child(3),.act-c:nth-child(3){animation-delay:.14s}
.hero:nth-child(4){animation-delay:.21s}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
@media (max-width:900px){.heros,.leaks,.acts{grid-template-columns:1fr 1fr}.slide{min-height:auto}.deck{scroll-snap-type:none}}
@media (max-width:560px){.heros,.leaks,.acts{grid-template-columns:1fr}}
@media print{.deck{height:auto;overflow:visible}.pager{display:none}
  .slide{min-height:auto;page-break-after:always;padding:10px}.scroll{overflow:visible}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>

<div class="deck">

<section class="slide" id="v1">
  <header class="hdr card">
    <div class="hdr-l">${lock}
      <div><div class="cliente">${esc(H.cliente)} · Operación de ${mesLbl(cerrado)}</div>
        <div class="sub">${H.unidades.length + H.sinDatos.length} UNIDADES REGISTRADAS · ${C.activas} OPERANDO · HISTÓRICO ${rango.toUpperCase()}</div></div>
    </div>
    <div class="hdr-r"><span class="vista">VISTA 1 / 3</span><br>MES CERRADO <b>${mesLbl(cerrado).toUpperCase()}</b><br>COMPARADO CONTRA ${mesLbl(anterior).toUpperCase()}</div>
  </header>

  <div class="heros">
    <div class="hero card"><div class="k">Distancia del mes</div><div class="v">${nf(C.km)} <span class="u">km</span></div>
      <div class="f"><span class="chg ${delta(C.km, P.km).c}">${delta(C.km, P.km).t}</span> vs ${mesLbl(anterior)}</div></div>
    <div class="hero card"><div class="k">Rendimiento real</div><div class="v">${nf(kml(C), 2)} <span class="u">km/L</span></div>
      <div class="f"><span class="chg ${delta(kml(C), kml(P)).c}">${delta(kml(C), kml(P)).t}</span> · ficha ${OBJ.kml.toFixed(2)}</div></div>
    <div class="hero card" style="border-top-color:var(--or)"><div class="k">Costo por kilómetro</div><div class="v">$${nf(costoKm(C), 2)}</div>
      <div class="f">${nf(C.l)} L · ${money(Math.round(C.l * DIESEL))} en diésel</div></div>
    <div class="hero card" style="border-top-color:var(--rd)"><div class="k">Motor sin avanzar</div><div class="v">${nf(pctIdle(C), 1)}<span class="u">%</span></div>
      <div class="f">${nf(C.ralenti)} h de ${nf(C.motor)} h de motor</div></div>
  </div>

  <div class="panel card">
    <div class="panel-t"><h2>Indicadores contra objetivo</h2><span>${mesLbl(cerrado).toUpperCase()} · VARIACIÓN CONTRA ${mesLbl(anterior).toUpperCase()}</span></div>
    <div class="scroll"><table>
      <thead><tr><th style="width:29%">Indicador</th><th class="r">Actual</th><th class="r">Objetivo</th>
        <th class="r">Brecha</th><th class="r">vs mes previo</th><th style="width:15%">Estado</th></tr></thead>
      <tbody>${ind.map(i => `<tr><td class="met"><i class="dot d-${i.e}"></i>${i.n}</td>
        <td class="r act">${i.a}</td><td class="obj r">${i.o}</td><td class="r ${i.e}">${i.br}</td>
        <td class="r"><span class="chg ${i.d.c}">${i.d.t}</span></td>
        <td><span class="st st-${i.e}">${i.e === 'ok' ? 'En meta' : i.e === 'wr' ? 'Fuera de meta' : 'Crítico'}</span></td></tr>`).join('')}</tbody>
    </table></div>
  </div>

  <div class="foot">El rendimiento es el único indicador en meta: <b>la flota consume conforme a ficha y ha mejorado ${((kml(R[cerrado]) / kml(R[meses[0]]) - 1) * 100).toFixed(0)}% desde ${mesLbl(meses[0])}</b>. Lo que cuesta dinero no es cómo maneja, es lo que pasa con el combustible y con el motor encendido. → Vista 2</div>
</section>

<section class="slide" id="v2">
  <header class="hdr card">
    <div class="hdr-l">${lock}
      <div><div class="cliente">Dónde se está yendo el dinero</div>
        <div class="sub">DIÉSEL A $${DIESEL}/L · CIFRAS MEDIDAS, NO PROYECTADAS</div></div>
    </div>
    <div class="hdr-r"><span class="vista">VISTA 2 / 3</span><br>GASTO EN DIÉSEL DEL MES <b>${money(Math.round(C.l * DIESEL))}</b><br>ACUMULADO ${rango.toUpperCase()} · ${money(Math.round(acc.l * DIESEL))}</div>
  </header>

  <div class="leaks">
    <div class="leak card"><div class="k">Diésel drenado · ${mesLbl(cerrado)}</div><div class="v">${money(Math.round(fugaDrain))}</div>
      <div class="y">ACUMULADO ${nf(acc.drainL)} L · ${money(Math.round(acc.drainL * DIESEL))}</div>
      <div class="d">${nf(C.drain)} descargas medidas este mes: <b>${nf(C.drainL)} litros</b>, el ${nf(C.drainL / C.l * 100, 1)}% del combustible. Van <b>${nf(acc.drain)} eventos</b> desde ${mesLbl(desdeDrain)}, sin un solo mes limpio.</div></div>
    <div class="leak warn card"><div class="k">Combustible en ralentí</div><div class="v">${money(Math.round(fugaIdle))}</div>
      <div class="y">ACUMULADO ${nf(Math.round(acc.ralenti))} H · ${money(Math.round(acc.ralenti * IDLE_LH * DIESEL))}</div>
      <div class="d">${nf(C.ralenti)} horas de motor encendido sin avanzar — <b>${nf(pctIdle(C), 1)}% del tiempo motor</b>. Equivale a ${nf(C.ralenti / 24, 0)} días completos de un camión quemando diésel parado.</div></div>
    <div class="leak warn card"><div class="k">Flota sin medir</div><div class="v">${H.sinDatos.length} unidades</div>
      <div class="y">DE ${nf(H.unidades.length + H.sinDatos.length)} REGISTRADAS</div>
      <div class="d">Nunca han entregado un solo viaje ni lectura de motor en ${meses.length} meses. <b>No entran en ninguna cifra</b> de este tablero: su consumo y su riesgo son invisibles.</div></div>
  </div>

  <div class="total card">
    <div><div class="k">Fuga identificada · ${mesLbl(cerrado)}</div>
      <div class="v">${money(Math.round(fugaMes))} <span style="font-size:.38em;font-weight:600;letter-spacing:0;color:var(--t2)">/ mes</span></div></div>
    <div class="n">Es el <b style="color:var(--t)">${nf(fugaMes / (C.l * DIESEL) * 100, 1)}% del gasto en diésel</b> del mes. Eliminar el drenaje y llevar el ralentí al ${OBJ.ralenti}% libera del orden de <b style="color:var(--gr2)">${money(Math.round((fugaDrain + ahorroIdle) * 12))} al año</b>, sin comprar una sola unidad ni cambiar de ruta.</div>
  </div>

  <div class="acts">
    <div class="act-c card"><div class="n">DECISIÓN 01</div><div class="t">Auditar el drenaje de diésel</div>
      <div class="b">Cada una de las ${nf(acc.drain)} descargas del histórico tiene fecha, hora y ubicación. Cruzarlas contra bitácora de carga y ruta identifica el patrón en días. Válvula antisifón en las unidades reincidentes.</div>
      <div class="g">RECUPERA HASTA ${money(Math.round(fugaDrain * 12))} / AÑO</div></div>
    <div class="act-c card"><div class="n">DECISIÓN 02</div><div class="t">Política de apagado y bono al operador</div>
      <div class="b">Apagar en espera mayor a 5 minutos, con el ahorro medido por unidad y una parte compartida con el operador. El ralentí lleva ${meses.length} meses entre ${nf(Math.min(...meses.map(m => pctIdle(R[m]))), 0)}% y ${nf(Math.max(...meses.map(m => pctIdle(R[m]))), 0)}%: es estructural, no un mal mes.</div>
      <div class="g">RECUPERA ~${money(Math.round(ahorroIdle * 12))} / AÑO AL ${OBJ.ralenti}%</div></div>
    <div class="act-c card"><div class="n">DECISIÓN 03</div><div class="t">Conectar la flota que no reporta</div>
      <div class="b">${H.sinDatos.length} unidades sin un solo dato en ${meses.length} meses. Mientras sigan así, ningún tablero las cubre y el ahorro estimado se queda corto por definición.</div>
      <div class="g">HABILITA MEDIR EL 100% DE LA FLOTA</div></div>
  </div>

  <div class="foot">Base: ${nf(acc.km)} km y ${nf(acc.l)} L medidos en ${meses.length} meses · ralentí valorado a ${IDLE_LH} L/h · diésel $${DIESEL}/L. Analítica potencializada por Advance.</div>
</section>

<section class="slide" id="v3">
  <header class="hdr card">
    <div class="hdr-l">${lock}
      <div><div class="cliente">Histórico mensual y desglose por unidad</div>
        <div class="sub">${meses.length} MESES · ${H.unidades.length} UNIDADES CON OPERACIÓN · ${rango.toUpperCase()}</div></div>
    </div>
    <div class="hdr-r"><span class="vista">VISTA 3 / 3</span><br>ACUMULADO <b>${nf(acc.km)} KM</b><br>${nf(acc.l)} L · ${money(Math.round(acc.l * DIESEL))}</div>
  </header>

  <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:clamp(8px,1vw,13px);flex:1;min-height:0">
    <div class="panel card">
      <div class="panel-t"><h2>Rendimiento por mes (km/L)</h2><span>ALTURA = KM RECORRIDOS</span></div>
      <div class="bars">${barras}</div>
    </div>
    <div class="panel card">
      <div class="panel-t"><h2>Totales por mes</h2><span>${meses.length} MESES</span></div>
      <div class="scroll"><table>
        <thead><tr><th>Mes</th><th class="r">Unid.</th><th class="r">km</th><th class="r">Litros</th><th class="r">km/L</th>
          <th class="r">Ralentí</th><th class="r">V.máx</th><th class="r">Excesos</th><th class="r">Drenajes</th><th class="r">Litros</th><th class="r">Pérdida</th></tr></thead>
        <tbody>${filasMes}</tbody></table></div>
    </div>
  </div>

  <div class="panel card" style="flex:1.35">
    <div class="panel-t"><h2>Desglose por unidad</h2>
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" aria-selected="true" data-m="tot">Acumulado</button>
        <button class="tab" role="tab" aria-selected="false" data-m="km">km por mes</button>
        <button class="tab" role="tab" aria-selected="false" data-m="kml">km/L por mes</button>
        <button class="tab" role="tab" aria-selected="false" data-m="idle">Ralentí por mes</button>
        <button class="tab" role="tab" aria-selected="false" data-m="vmax">Vel. máx por mes</button>
        <button class="tab" role="tab" aria-selected="false" data-m="exces">Excesos por mes</button>
        <button class="tab" role="tab" aria-selected="false" data-m="drainL">Litros drenados por mes</button>
      </div>
    </div>
    <div class="scroll">
      <table id="tTot"><thead><tr><th>Unidad</th><th>Modelo</th><th class="r">Meses</th><th class="r">km</th><th class="r">Litros</th>
        <th class="r">km/L</th><th class="r">Ralentí</th><th class="r">V.máx</th><th class="r">Excesos</th><th class="r">L drenados</th><th class="r">Pérdida</th></tr></thead>
        <tbody>${filasU}</tbody></table>
      <table id="tMz" hidden><thead><tr><th class="mz-u" style="text-align:left">Unidad</th>${meses.map(m => `<th class="r">${mesLbl(m)}</th>`).join('')}</tr></thead>
        <tbody>${matriz('km')}</tbody></table>
    </div>
  </div>

  <div class="foot">
    <b>Cobertura de eventos:</b> los excesos de velocidad se registran desde ${mesLbl(desdeExces)} y los drenajes desde ${mesLbl(desdeDrain)}, cuando se configuraron esas alertas. Un cero en meses previos significa «sin registro», no «sin evento».
    Frenada y aceleración bruscas: sin dato — la telemetría instalada no publica acelerómetro ni giroscopio.
    Se descartan saltos de contador físicamente imposibles (mayores a 2,500 km en un día). Analítica potencializada por Advance.
  </div>
</section>
</div>

<nav class="pager" aria-label="Vistas">
  <a href="#v1" aria-label="Vista 1: operación"></a><a href="#v2" aria-label="Vista 2: dinero"></a><a href="#v3" aria-label="Vista 3: histórico"></a>
</nav>

<script>
const MZ=${JSON.stringify(Object.fromEntries(['km', 'kml', 'idle', 'vmax', 'exces', 'drainL'].map(t => [t, matriz(t)])))};
const tot=document.getElementById('tTot'), mz=document.getElementById('tMz');
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(x=>x.setAttribute('aria-selected','false'));
  b.setAttribute('aria-selected','true');
  const m=b.dataset.m;
  if(m==='tot'){tot.hidden=false;mz.hidden=true;}
  else{tot.hidden=true;mz.hidden=false;mz.tBodies[0].innerHTML=MZ[m];}
}));
document.addEventListener('keydown',e=>{
  const d=document.querySelector('.deck');
  if(['ArrowDown','PageDown'].includes(e.key)){e.preventDefault();d.scrollBy({top:innerHeight,behavior:'smooth'});}
  if(['ArrowUp','PageUp'].includes(e.key)){e.preventDefault();d.scrollBy({top:-innerHeight,behavior:'smooth'});}
});
</script>`;
}

const dirs = existsSync('clientes') ? readdirSync('clientes') : [];
let n = 0;
for (const slug of dirs) {
  const f = `clientes/${slug}/historico.json`;
  if (!existsSync(f)) continue;
  const H = JSON.parse(readFileSync(f, 'utf8'));
  writeFileSync(`clientes/${slug}/tablero.html`, construir(H));
  console.log(`[${slug}] OK · clientes/${slug}/tablero.html · ${H.meses.length} meses · ${H.unidades.length} unidades`);
  n++;
}
if (!n) console.error('No hay historico.json. Corre antes: node scripts/build-history.mjs');

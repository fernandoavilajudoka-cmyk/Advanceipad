#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera un dashboard HTML (premium glass, fondo blanco) de renovaciones a partir
de la base homologada + el CRM en vivo.

Entradas:
  salida/clientes_unidades.csv        (unidades con PRÓXIMA RENOVACIÓN, tipo, dispositivo)
  salida/_crm_raw/companies.json      (cuentas nuevas: createdAt)
  salida/_crm_raw/cars.json           (conteo de unidades por empresa -> tipo)

Salida:
  salida/dashboard_renovaciones.html  (autocontenido, datos embebidos; NO se commitea)

Uso:  python3 dashboard.py
"""
import csv, json, os, datetime as dt
from collections import defaultdict

BASE = os.path.dirname(__file__)
SAL = os.path.join(BASE, "salida")

def tipo_por_unidades(n):
    return "AAA" if n >= 20 else "AA" if n >= 10 else "A" if n >= 1 else ""

def main():
    # --- Unidades a renovar (situación Activa, con fecha) ---
    units = []
    with open(os.path.join(SAL, "clientes_unidades.csv"), encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            f = r.get("PRÓXIMA RENOVACIÓN", "").strip()
            if not f or r.get("SITUACIÓN") != "Activa":
                continue
            if not (f[:4].isdigit() and 2024 <= int(f[:4]) <= 2035):
                continue   # descarta fechas basura (p.ej. año 2926)
            units.append({
                "e": r.get("NOMBRE EMPRESA", "").strip() or "(sin nombre)",
                "t": r.get("TIPO DE CLIENTE", "").strip() or "A",
                "d": r.get("TIPO DE DISPOSITIVO", "").strip() or "Sin dato",
                "f": f,
                "id": r.get("ID CLIENTE (MAPON)", "").strip(),
            })

    # --- Cuentas nuevas en el CRM (createdAt) + tipo por nº de unidades ---
    newacc = []
    comp_path = os.path.join(SAL, "_crm_raw", "companies.json")
    cars_path = os.path.join(SAL, "_crm_raw", "cars.json")
    units_by_comp = defaultdict(int)
    if os.path.exists(cars_path):
        for c in json.load(open(cars_path, encoding="utf-8")):
            if c.get("companyId"):
                units_by_comp[str(c["companyId"])] += 1
    if os.path.exists(comp_path):
        for c in json.load(open(comp_path, encoding="utf-8")):
            ca = c.get("createdAt")
            raw = ca.get("raw") if isinstance(ca, dict) else ca
            if not raw:
                continue
            n = units_by_comp.get(str(c.get("id")), 0)
            newacc.append({
                "n": (c.get("name") or "").strip() or "(sin nombre)",
                "f": str(raw)[:10],
                "t": tipo_por_unidades(n),
                "u": n,
            })

    data = {"units": units, "newacc": newacc,
            "generated": dt.date.today().isoformat()}

    html = TEMPLATE.replace("/*__DATA__*/", json.dumps(data, ensure_ascii=False))
    out = os.path.join(SAL, "dashboard_renovaciones.html")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"✓ {out}")
    print(f"  unidades a renovar: {len(units)}  ·  cuentas en CRM: {len(newacc)}")


TEMPLATE = r"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Dashboard de Renovaciones · Advance</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0"></script>
<style>
:root{
  --green:#16a34a; --forest:#0f5132; --mint:#34d399; --ink:#0b1f17; --muted:#5b6b63;
  --aaa:#1d4ed8; --aa:#16a34a; --a:#f59e0b;
  --glass:rgba(255,255,255,.55); --stroke:rgba(255,255,255,.85);
  --shadow:0 10px 30px rgba(16,40,30,.10), 0 2px 8px rgba(16,40,30,.06);
}
*{box-sizing:border-box}
html,body{margin:0}
body{
  font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif;
  color:var(--ink); min-height:100vh; background:#fff; overflow-x:hidden;
  background-image:
    radial-gradient(900px 500px at 8% -8%, rgba(52,211,153,.18), transparent 60%),
    radial-gradient(800px 480px at 102% 0%, rgba(29,78,216,.12), transparent 55%),
    radial-gradient(700px 600px at 50% 120%, rgba(245,158,11,.10), transparent 60%);
}
/* blobs animados de fondo */
.blob{position:fixed;border-radius:50%;filter:blur(60px);opacity:.35;z-index:0;animation:float 18s ease-in-out infinite}
.blob.b1{width:380px;height:380px;background:#34d399;top:-80px;left:-60px}
.blob.b2{width:320px;height:320px;background:#60a5fa;top:40%;right:-80px;animation-delay:-6s}
.blob.b3{width:300px;height:300px;background:#fbbf24;bottom:-90px;left:30%;animation-delay:-11s}
@keyframes float{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.08)}}
.wrap{position:relative;z-index:1;max-width:1280px;margin:0 auto;padding:26px 20px 60px}
header.top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.brand{display:flex;align-items:center;gap:14px}
.logo{width:46px;height:46px;border-radius:13px;background:linear-gradient(135deg,var(--green),var(--forest));
  display:grid;place-items:center;color:#fff;font-weight:800;box-shadow:var(--shadow);font-size:20px}
h1{margin:0;font-size:25px;letter-spacing:-.4px}
.sub{color:var(--muted);font-size:13px;margin-top:2px}
/* glass card */
.glass{background:var(--glass);backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);
  border:1px solid var(--stroke);border-radius:20px;box-shadow:var(--shadow);position:relative;overflow:hidden}
.glass::before{content:"";position:absolute;inset:0;border-radius:20px;pointer-events:none;
  background:linear-gradient(120deg,rgba(255,255,255,.55),rgba(255,255,255,0) 40%)}
/* filtros */
.filters{display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:14px 16px}
.filters .fl{display:flex;flex-direction:column;gap:4px}
.filters label{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
select{appearance:none;border:1px solid rgba(15,81,50,.18);background:rgba(255,255,255,.9);color:var(--ink);
  padding:9px 34px 9px 12px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;min-width:130px;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%230f5132'><path d='M2 4l4 4 4-4'/></svg>");
  background-repeat:no-repeat;background-position:right 12px center;transition:.2s}
select:hover{border-color:var(--green);box-shadow:0 0 0 3px rgba(22,163,74,.12)}
.pill{margin-left:auto;font-size:12px;color:var(--forest);background:rgba(22,163,74,.10);
  padding:8px 14px;border-radius:999px;font-weight:700;border:1px solid rgba(22,163,74,.18)}
/* KPIs */
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin:16px 0}
.kpi{padding:16px 16px 14px;animation:rise .6s both}
.kpi .k-top{display:flex;align-items:center;justify-content:space-between}
.kpi .dot{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:#fff;font-size:16px;box-shadow:var(--shadow)}
.kpi .v{font-size:30px;font-weight:800;letter-spacing:-1px;margin-top:8px;line-height:1}
.kpi .l{font-size:12px;color:var(--muted);margin-top:3px;font-weight:600}
.kpi .sp{font-size:11px;margin-top:6px;color:var(--forest);font-weight:700}
/* grid */
.grid{display:grid;gap:16px}
.g2{grid-template-columns:1fr 1fr}
.g3{grid-template-columns:1.2fr 1fr}
.card{padding:16px 18px;animation:rise .7s both}
.card h3{margin:0 0 4px;font-size:15px}
.card .hint{font-size:12px;color:var(--muted);margin-bottom:8px}
.cv{position:relative;height:300px}
.cv.sm{height:270px}
/* listas */
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{text-align:left;color:var(--muted);font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.4px;
  padding:8px 10px;border-bottom:1px solid rgba(15,81,50,.10);position:sticky;top:0;background:rgba(255,255,255,.7);backdrop-filter:blur(6px)}
.tbl td{padding:8px 10px;border-bottom:1px solid rgba(15,81,50,.06)}
.tbl tr:hover td{background:rgba(22,163,74,.06)}
.scroll{max-height:320px;overflow:auto;border-radius:12px}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:800;color:#fff}
.b-AAA{background:var(--aaa)} .b-AA{background:var(--aa)} .b-A{background:var(--a)}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.chip{font-size:12px;font-weight:700;padding:6px 11px;border-radius:999px;border:1px solid rgba(15,81,50,.14);
  background:rgba(255,255,255,.7)}
.chip b{color:var(--forest)}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.kpi:nth-child(1){animation-delay:.03s}.kpi:nth-child(2){animation-delay:.08s}.kpi:nth-child(3){animation-delay:.13s}
.kpi:nth-child(4){animation-delay:.18s}.kpi:nth-child(5){animation-delay:.23s}
.foot{color:var(--muted);font-size:11px;text-align:center;margin-top:24px}
@media(max-width:980px){.kpis{grid-template-columns:repeat(2,1fr)}.g2,.g3{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
<div class="wrap">
  <header class="top">
    <div class="brand">
      <div class="logo">A</div>
      <div><h1>Dashboard de Renovaciones</h1>
      <div class="sub">Advance · Telematics &amp; Smart-Connect — base homologada + CRM en vivo</div></div>
    </div>
  </header>

  <div class="glass filters">
    <div class="fl"><label>Año</label><select id="fYear"></select></div>
    <div class="fl"><label>Mes</label><select id="fMonth"></select></div>
    <div class="fl"><label>Semana (ISO)</label><select id="fWeek"></select></div>
    <div class="fl"><label>Dispositivo</label><select id="fDev"></select></div>
    <div class="pill" id="periodPill">Periodo: Todos</div>
  </div>

  <section class="kpis">
    <div class="kpi glass"><div class="k-top"><div class="l">Unidades a renovar</div><div class="dot" style="background:linear-gradient(135deg,#16a34a,#0f5132)">⟳</div></div><div class="v" id="kUnits">0</div><div class="sp" id="kUnitsSp">en el periodo</div></div>
    <div class="kpi glass"><div class="k-top"><div class="l">Clientes a renovar</div><div class="dot" style="background:linear-gradient(135deg,#1d4ed8,#1e3a8a)">★</div></div><div class="v" id="kClients">0</div><div class="sp" id="kClientsSp">empresas distintas</div></div>
    <div class="kpi glass"><div class="k-top"><div class="l">AAA / AA / A</div><div class="dot" style="background:linear-gradient(135deg,#f59e0b,#b45309)">▦</div></div><div class="v" id="kMix" style="font-size:20px">0 / 0 / 0</div><div class="sp">por tipo de cliente</div></div>
    <div class="kpi glass"><div class="k-top"><div class="l">Dispositivo top</div><div class="dot" style="background:linear-gradient(135deg,#0ea5e9,#0369a1)">▣</div></div><div class="v" id="kDev" style="font-size:19px">—</div><div class="sp" id="kDevSp">más renovaciones</div></div>
    <div class="kpi glass"><div class="k-top"><div class="l">Cuentas nuevas CRM</div><div class="dot" style="background:linear-gradient(135deg,#34d399,#059669)">＋</div></div><div class="v" id="kNew">0</div><div class="sp">altas en el periodo</div></div>
  </section>

  <div class="grid g2" style="margin-bottom:16px">
    <div class="card glass"><h3>Distribución por tipo de cliente</h3><div class="hint">Unidades a renovar en el periodo</div><div class="cv sm"><canvas id="pieClient"></canvas></div></div>
    <div class="card glass"><h3>Distribución por tipo de dispositivo</h3><div class="hint">Unidades a renovar en el periodo</div><div class="cv sm"><canvas id="pieDev"></canvas></div></div>
  </div>

  <div class="card glass" style="margin-bottom:16px">
    <h3>Tendencia mensual de renovaciones por dispositivo</h3>
    <div class="hint">Barras apiladas · cantidad de unidades por mes y modelo GPS</div>
    <div class="cv"><canvas id="barMonth"></canvas></div>
  </div>

  <div class="card glass" style="margin-bottom:16px">
    <h3>Tendencia semanal de renovaciones por dispositivo</h3>
    <div class="hint">Vista por semana ISO del periodo seleccionado</div>
    <div class="cv"><canvas id="barWeek"></canvas></div>
  </div>

  <div class="grid g2">
    <div class="card glass"><h3>Dispositivos a renovar en el periodo</h3>
      <div class="hint" id="devBoxHint">Resumen por modelo</div>
      <div class="chips" id="devChips"></div>
      <div class="scroll" style="margin-top:10px"><table class="tbl"><thead><tr><th>VIN / Empresa</th><th>Cliente</th><th>Dispositivo</th><th>Renovación</th></tr></thead><tbody id="devRows"></tbody></table></div>
    </div>
    <div class="card glass"><h3>Cuentas nuevas en el CRM</h3>
      <div class="hint" id="newBoxHint">Altas de empresas en el periodo</div>
      <div class="scroll"><table class="tbl"><thead><tr><th>Empresa</th><th>Tipo</th><th>Unidades</th><th>Alta CRM</th></tr></thead><tbody id="newRows"></tbody></table></div>
    </div>
  </div>

  <div class="foot" id="foot"></div>
</div>

<script>
const DATA = /*__DATA__*/;
Chart.register(ChartDataLabels);
Chart.defaults.font.family="'Segoe UI',system-ui,sans-serif";
Chart.defaults.color="#5b6b63";

const MES=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const C_CLIENT={AAA:"#1d4ed8",AA:"#16a34a",A:"#f59e0b"};
const DEV_PALETTE=["#16a34a","#1d4ed8","#f59e0b","#0ea5e9","#a855f7","#ef4444","#14b8a6","#64748b"];

// ---- preparación ----
function isoWeek(d){const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  const day=(t.getUTCDay()+6)%7;t.setUTCDate(t.getUTCDate()-day+3);
  const first=new Date(Date.UTC(t.getUTCFullYear(),0,4));
  return 1+Math.round(((t-first)/86400000-3+((first.getUTCDay()+6)%7))/7);}
DATA.units.forEach(u=>{const d=new Date(u.f+"T00:00:00");u.y=d.getFullYear();u.m=d.getMonth()+1;u.w=isoWeek(d);u._d=d;});
DATA.newacc.forEach(a=>{const d=new Date(a.f+"T00:00:00");a.y=d.getFullYear();a.m=d.getMonth()+1;a.w=isoWeek(d);});

// dispositivos top (global) -> resto "Otros"
const devCount={};DATA.units.forEach(u=>devCount[u.d]=(devCount[u.d]||0)+1);
const topDevs=Object.entries(devCount).sort((a,b)=>b[1]-a[1]).slice(0,7).map(x=>x[0]);
const devName=d=>topDevs.includes(d)?d:"Otros";
const DEVS=[...topDevs,"Otros"];
const devColor={};DEVS.forEach((d,i)=>devColor[d]=DEV_PALETTE[i%DEV_PALETTE.length]);

const years=[...new Set(DATA.units.map(u=>u.y))].sort();
// ---- filtros UI ----
const fYear=document.getElementById("fYear"),fMonth=document.getElementById("fMonth"),
      fWeek=document.getElementById("fWeek"),fDev=document.getElementById("fDev");
function opt(sel,val,txt){const o=document.createElement("option");o.value=val;o.textContent=txt;sel.appendChild(o);}
opt(fYear,"all","Todos");years.forEach(y=>opt(fYear,y,y));
opt(fDev,"all","Todos");[...topDevs,"Otros"].forEach(d=>opt(fDev,d,d));
function rebuildMonths(){fMonth.innerHTML="";opt(fMonth,"all","Todos");for(let m=1;m<=12;m++)opt(fMonth,m,MES[m-1]);}
function rebuildWeeks(){fWeek.innerHTML="";opt(fWeek,"all","Todas");
  let pool=DATA.units.filter(u=>(fYear.value==="all"||u.y==+fYear.value)&&(fMonth.value==="all"||u.m==+fMonth.value));
  [...new Set(pool.map(u=>u.w))].sort((a,b)=>a-b).forEach(w=>opt(fWeek,w,"Sem "+w));}
rebuildMonths();rebuildWeeks();

function fu(){return DATA.units.filter(u=>
  (fYear.value==="all"||u.y==+fYear.value)&&
  (fMonth.value==="all"||u.m==+fMonth.value)&&
  (fWeek.value==="all"||u.w==+fWeek.value)&&
  (fDev.value==="all"||devName(u.d)===fDev.value));}
function fa(){return DATA.newacc.filter(a=>
  (fYear.value==="all"||a.y==+fYear.value)&&
  (fMonth.value==="all"||a.m==+fMonth.value)&&
  (fWeek.value==="all"||a.w==+fWeek.value));}

// ---- charts ----
const dl={color:"#0b1f17",font:{weight:"700",size:11}};
let pieC,pieD,barM,barW;
function makePie(id,labels,data,colors){
  return new Chart(document.getElementById(id),{type:"doughnut",
    data:{labels,datasets:[{data,backgroundColor:colors,borderColor:"#fff",borderWidth:3,hoverOffset:10}]},
    options:{cutout:"55%",animation:{animateRotate:true,duration:900},
      plugins:{legend:{position:"bottom",labels:{usePointStyle:true,padding:14,font:{size:12,weight:"600"}}},
        datalabels:{color:"#fff",font:{weight:"800",size:13},
          formatter:(v,c)=>{const t=c.dataset.data.reduce((a,b)=>a+b,0);return v?Math.round(v/t*100)+"%":"";}},
        tooltip:{callbacks:{label:c=>` ${c.label}: ${c.raw} u`}}}}});
}
function makeBar(id){
  return new Chart(document.getElementById(id),{type:"bar",
    data:{labels:[],datasets:[]},
    options:{animation:{duration:850,easing:"easeOutQuart"},responsive:true,maintainAspectRatio:false,
      scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,grid:{color:"rgba(15,81,50,.07)"},ticks:{precision:0}}},
      plugins:{legend:{position:"bottom",labels:{usePointStyle:true,padding:12,font:{size:11,weight:"600"}}},
        datalabels:{display:c=>c.dataset.data[c.dataIndex]>0,color:"#0b1f17",font:{weight:"700",size:10},anchor:"center"},
        tooltip:{mode:"index",intersect:false}}}});
}
function animateNum(el,to){const from=+(el.dataset.v||0);const t0=performance.now();
  function step(t){const p=Math.min(1,(t-t0)/600);const val=Math.round(from+(to-from)*(1-Math.pow(1-p,3)));
    el.textContent=val.toLocaleString("es-MX");if(p<1)requestAnimationFrame(step);else el.dataset.v=to;}requestAnimationFrame(step);}

function render(){
  const U=fu(),A=fa();
  // KPIs
  animateNum(document.getElementById("kUnits"),U.length);
  animateNum(document.getElementById("kClients"),new Set(U.map(u=>u.e)).size);
  const mix={AAA:0,AA:0,A:0};U.forEach(u=>mix[u.t]=(mix[u.t]||0)+1);
  document.getElementById("kMix").textContent=`${mix.AAA} / ${mix.AA} / ${mix.A}`;
  const dc={};U.forEach(u=>{const n=devName(u.d);dc[n]=(dc[n]||0)+1;});
  const top=Object.entries(dc).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById("kDev").textContent=top?top[0]:"—";
  document.getElementById("kDevSp").textContent=top?top[1]+" unidades":"—";
  animateNum(document.getElementById("kNew"),A.length);
  // periodo pill
  const p=[];if(fYear.value!=="all")p.push(fYear.value);if(fMonth.value!=="all")p.push(MES[+fMonth.value-1]);
  if(fWeek.value!=="all")p.push("Sem "+fWeek.value);if(fDev.value!=="all")p.push(fDev.value);
  document.getElementById("periodPill").textContent="Periodo: "+(p.length?p.join(" · "):"Todos");

  // Pie cliente
  const cl=["AAA","AA","A"],cld=cl.map(t=>mix[t]||0);
  if(pieC){pieC.data.datasets[0].data=cld;pieC.update();}else pieC=makePie("pieClient",cl,cld,cl.map(t=>C_CLIENT[t]));
  // Pie dispositivo
  const dl2=DEVS.filter(d=>dc[d]);const dd=dl2.map(d=>dc[d]);
  if(pieD){pieD.data.labels=dl2;pieD.data.datasets[0].data=dd;pieD.data.datasets[0].backgroundColor=dl2.map(d=>devColor[d]);pieD.update();}
  else pieD=makePie("pieDev",dl2,dd,dl2.map(d=>devColor[d]));

  // Barras mensuales (por año seleccionado, o agregado por mes de todos los años)
  const Umonth=DATA.units.filter(u=>(fYear.value==="all"||u.y==+fYear.value)&&(fDev.value==="all"||devName(u.d)===fDev.value));
  const labM=MES.map((m,i)=>m);
  const dsM=DEVS.map(dev=>({label:dev,backgroundColor:devColor[dev],borderRadius:6,
    data:labM.map((_,mi)=>Umonth.filter(u=>u.m===mi+1&&devName(u.d)===dev).length)}))
    .filter(ds=>ds.data.some(v=>v>0));
  barM.data.labels=labM;barM.data.datasets=dsM;barM.update();

  // Barras semanales
  const Uw=DATA.units.filter(u=>(fYear.value==="all"||u.y==+fYear.value)&&(fMonth.value==="all"||u.m==+fMonth.value)&&(fDev.value==="all"||devName(u.d)===fDev.value));
  const weeks=[...new Set(Uw.map(u=>u.w))].sort((a,b)=>a-b);
  const dsW=DEVS.map(dev=>({label:dev,backgroundColor:devColor[dev],borderRadius:6,
    data:weeks.map(w=>Uw.filter(u=>u.w===w&&devName(u.d)===dev).length)}))
    .filter(ds=>ds.data.some(v=>v>0));
  barW.data.labels=weeks.map(w=>"Sem "+w);barW.data.datasets=dsW;barW.update();

  // Box dispositivos
  const chips=Object.entries(dc).sort((a,b)=>b[1]-a[1]);
  document.getElementById("devChips").innerHTML=chips.map(([d,n])=>`<span class="chip">${d} <b>${n}</b></span>`).join("");
  document.getElementById("devBoxHint").textContent=`${U.length} unidades · ${chips.length} modelos`;
  const rowsU=U.slice().sort((a,b)=>a._d-b._d).slice(0,250);
  document.getElementById("devRows").innerHTML=rowsU.map(u=>
    `<tr><td>${u.e}</td><td><span class="badge b-${u.t}">${u.t}</span></td><td>${u.d}</td><td>${u.f}</td></tr>`).join("")
    || `<tr><td colspan="4" style="color:#9aa">Sin datos en el periodo</td></tr>`;
  // Box cuentas nuevas
  document.getElementById("newBoxHint").textContent=`${A.length} altas en el periodo`;
  const rowsA=A.slice().sort((a,b)=>b.f.localeCompare(a.f)).slice(0,250);
  document.getElementById("newRows").innerHTML=rowsA.map(a=>
    `<tr><td>${a.n}</td><td><span class="badge b-${a.t||'A'}">${a.t||'A'}</span></td><td>${a.u}</td><td>${a.f}</td></tr>`).join("")
    || `<tr><td colspan="4" style="color:#9aa">Sin altas en el periodo</td></tr>`;
}

barM=makeBar("barMonth");barW=makeBar("barWeek");
[fYear,fMonth,fWeek,fDev].forEach(s=>s.addEventListener("change",e=>{
  if(e.target===fYear){rebuildMonths();rebuildWeeks();}
  if(e.target===fMonth){rebuildWeeks();}
  render();}));
document.getElementById("foot").textContent="Generado "+DATA.generated+" · "+DATA.units.length.toLocaleString("es-MX")+" unidades activas con renovación · "+DATA.newacc.length+" empresas en el CRM";
render();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()

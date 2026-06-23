# Informes Gerenciales de Flota — Advance

Plantilla **reutilizable** de informe gerencial de telemetría (Telematics Advance / Smart‑Connect · Mapon API).
Un mismo análisis sirve para **cualquier cliente**: solo cambian los datos, que se leen del API key de cada uno.

> **Idea central:** hay **un solo informe** (`index.html`, el "motor" data‑driven). El pipeline
> le inyecta los datos reales de cada cliente y produce `clientes/<cliente>/index.html`.
> **Dar de alta un cliente = agregar un secret `MAPON_<CLIENTE>`** y correr el workflow.

---

## 1. Estructura del repositorio

```
.
├── index.html                      ← LA PLANTILLA (el análisis). Misma estructura para todos.
├── scripts/
│   └── build-report.mjs            ← Build: descubre los secrets MAPON_* y genera un informe por cliente.
├── clientes.json                   ← Config OPCIONAL por cliente (nombre + benchmarks por modelo).
├── clientes/
│   └── <cliente>/index.html        ← Informe GENERADO de cada cliente (lo crea el build). Una carpeta = una liga.
├── .github/workflows/
│   └── update-report.yml           ← Automatización: corre el build a diario y en cada push, y commitea.
├── netlify.toml                    ← Config de Netlify (qué se publica y qué muestra la raíz "/").
└── README.md                       ← Este archivo.
```

## 2. Estructura del informe (las secciones acordadas)

Cada informe contiene, en este orden:

1. **Portada** — identidad del cliente, estado de la flota y resumen del periodo.
2. **Resumen ejecutivo** — KPIs: rendimiento general, distancia, ralentí, excesos, probabilidad de accidente/robo.
3. **Rendimiento real por modelo vs fabricante** — km/L medido contra ficha del fabricante.
4. **Rendimiento por sede vs distancia** — comparativa por zona/sede.
5. **Sede más vs menos productiva** — índice = distancia × rendimiento.
6. **Seguridad vial** — tendencia (mejora/empeora), top 10 más seguras/inseguras, concentrado de alertas,
   franja horaria, zonas más inseguras.
7. **Tablero de unidades** — 15 unidades con mayor distancia, encabezados ordenables (clic = mayor→menor; otro clic invierte).
8. **Combustible y costo** — costo, costo/km, ralentí, descargas de diésel, gasto por zona y
   **bono al operador** (modelo de 3 pilares —Seguridad + Ralentí + Rendimiento— en escenario *«¿qué pasaría si?»*: de la métrica actual a un objetivo, con el ahorro y la parte que le toca al operador).
9. **Monetización del desempeño** — ahorro potencial.
10. **Metodología y parámetros** — supuestos económicos y objetivos editables (precio diésel, norma L/100, objetivos del bono, etc.).

Filtros globales en la **barra lateral** (**Mes · Semana · Día · Zona**): se filtra desde cualquier sección.
Botón **Descargar PDF**. Todas las gráficas muestran **etiquetas numéricas / porcentaje** y tienen diseño de cristal translúcido (Chart.js por CDN).

---

## 3. Montaje en GitHub (equipo de soporte)

1. Crear un repositorio (privado recomendado) y subir **todos** estos archivos respetando las rutas.
2. **Settings → Secrets and variables → Actions → New repository secret**
   - Name: **`MAPON_TEPEYAC`** · Secret: *«API key de Mapon del cliente»*
   - (El nombre del secret define el slug: `MAPON_TEPEYAC` → carpeta `clientes/tepeyac/`.)
3. **Actions** → habilitar workflows si GitHub lo pide → seleccionar **"Generar informes de clientes"** → **Run workflow**.
   - El job consulta la API, genera `clientes/tepeyac/index.html` y lo commitea.
   - Después corre **solo, a diario** (cron 12:00 UTC ≈ 06:00–07:00 MX).

> El workflow recibe `ALL_SECRETS = ${{ toJSON(secrets) }}` y el script toma **solo** los `MAPON_*`.
> Por eso **no hay que editar el workflow** al agregar clientes.

## 4. Publicar en Netlify (generar la liga)

1. En Netlify: **Add new site → Import an existing project → GitHub** y elegir el repo.
2. Build command: *(vacío)* · Publish directory: `.` (ya está en `netlify.toml`).
3. Deploy. La raíz `/` mostrará el informe de Tepeyac; cada cliente queda en `/<carpeta>`:
   - `https://<tu-sitio>.netlify.app/` → Tepeyac (raíz, configurable en `netlify.toml`)
   - `https://<tu-sitio>.netlify.app/clientes/<cliente>/` → cualquier otro cliente
4. **Recomendado:** renombrar el sitio a algo neutro (Site settings → *Change site name*),
   ej. `informes-advance`, para que las ligas se vean `informes-advance.netlify.app/clientes/<cliente>`.

Cada push del bot (informe actualizado) redespliega Netlify automáticamente.

---

## 5. Dar de alta un cliente nuevo (los únicos 2 pasos)

1. **Agregar secret** `MAPON_<NUEVOCLIENTE>` con su API key (Settings → Secrets → Actions).
2. **Actions → Generar informes de clientes → Run workflow** (o esperar el cron diario).

Listo: el informe queda en `clientes/<nuevocliente>/index.html` y se actualiza solo cada día.
**No se edita código ni el workflow.**

## 6. Afinar un cliente (opcional) — `clientes.json`

Solo si quieres nombre bonito o benchmarks precisos. La clave es el slug (lo de después de `MAPON_`):

```json
{
  "concretos": {
    "nombre": "Concretos Técnicos",
    "bench": { "S3": 3.0, "EST-A X13": 2.6 },   // km/L de ficha del fabricante por modelo
    "tank":  { "S3": 100, "EST-A X13": 400 }     // capacidad del tanque (L) por modelo
  }
}
```

Si un cliente **no** aparece en `clientes.json`, el informe corre igual con valores por defecto
(modelos detectados solos desde la API; `bench` 3.0 km/L; `tank` 100 L).

## 7. Cambiar qué informe muestra la raíz "/"

Editar el primer `redirect` de `netlify.toml`:

```toml
[[redirects]]
  from = "/"
  to = "/clientes/tepeyac/index.html"   # cambiar al cliente que se quiera destacar
  status = 200
```

---

## 8. Probar el build en local (opcional, para desarrollo)

```bash
# Node 18+ . La key va SOLO por variable de entorno, nunca al código.
MAPON_TEPEYAC=«apikey» node scripts/build-report.mjs
# genera clientes/tepeyac/index.html
```

## 9. Notas importantes

- **La API key NUNCA se escribe en el HTML ni en los logs.** Vive solo como secret de GitHub.
- La API de rutas/CAN limita las consultas a **~30 días**; el informe usa una **ventana móvil de 30 días**.
- El informe es un **HTML estático** (Chart.js por CDN); no requiere servidor ni build especial.
- Para subdominio propio por cliente (`cliente.netlify.app` en vez de subruta), crear un sitio Netlify
  con **base directory** = `clientes/<cliente>` (un paso manual por cliente en Netlify).

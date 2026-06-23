# CLAUDE.md — Informes Gerenciales de Flota (Advance)

Contexto para Claude Code. Léelo antes de tocar nada.

## Qué es este proyecto
Plantilla **reutilizable** de informe gerencial de telemetría (Telematics Advance / Smart-Connect · Mapon API).
Hay **un solo informe** —`index.html`, el “motor” data-driven— que sirve para **cualquier cliente**: el pipeline
le inyecta los datos reales de cada cliente (leídos de su API key de Mapon) y produce `clientes/<cliente>/index.html`.
**Dar de alta un cliente = agregar un secret `MAPON_<CLIENTE>` y correr el workflow.** No se edita código por cliente.

## Estructura
```
index.html                       ← LA PLANTILLA / motor del informe (aquí va el 95% del trabajo)
scripts/build-report.mjs         ← Build: descubre los secrets MAPON_* y genera un informe por cliente
clientes.json                    ← Config OPCIONAL por cliente (nombre + benchmarks/tanque por modelo)
clientes/<cliente>/index.html    ← Informe GENERADO (lo crea el build; no editar a mano)
.github/workflows/update-report.yml  ← Corre el build a diario y en cada push, y commitea
netlify.toml                     ← Qué publica Netlify y qué muestra la raíz "/"
README.md                        ← Doc completa (arquitectura + despliegue)
Guia-Despliegue-Advance.pdf      ← Guía de despliegue para Desarrollo/Soporte
```

## Cómo está hecho `index.html` (importante)
Es un **HTML estático de una sola página**, Chart.js + chartjs-plugin-datalabels por CDN. Dos partes:

1. **Bloque de configuración del cliente** (cerca del inicio del `<script>`): constantes `RAW`, `REALW`,
   `MODELS`, `ZONAS`, `ZRISK_*`, `PLACAS`, `META`. Es lo único que cambia por cliente (lo inyecta el build).
2. **El “motor”** (el resto del `<script>`): no requiere edición por cliente. Funciones `aggregate()`,
   `render()`, y un `buildX()` por sección/gráfica.

Secciones del informe (numeradas 01–10 en el `<nav>` lateral): Portada, Resumen ejecutivo, Rendimiento por
modelo, Rendimiento por sede, Productividad de sedes, Seguridad vial, Tablero de unidades, Combustible y costo,
Monetización, Metodología.

### Convenciones de UI ya establecidas
- **Tema**: “premium glass” verde Advance. Paleta y variables en `:root` (primario `#16a34a`, bosque `#0f5132`).
- **Filtros globales** (Mes/Semana/Día/Zona) viven en la **barra lateral** (`.nav-filters`), no en una sección.
  Mismos IDs `selMonth/selWeek/selDay/selZona`; el motor no se toca al moverlos.
- **Gráficas**: todas llevan etiquetas (números/%) vía `chartjs-plugin-datalabels`. Helpers: `dlV` (vertical),
  `dlH` (horizontal), `dlIn` (interior). Por defecto las etiquetas están **apagadas** y se activan por gráfica.
- **Regla de tooltips**: el tooltip **no repite** el valor de la etiqueta. Si la etiqueta muestra conteo, el
  tooltip da el %, y viceversa. Mantener esa regla al agregar gráficas.
- **Bono al operador** (sección 08): modelo de **3 pilares** (Seguridad + Ralentí + Rendimiento) en escenario
  **“¿qué pasaría si?”**: de la métrica **actual** a un **objetivo**, calcula el **ahorro** y la **parte del
  operador** (% de reparto). Objetivos configurables en Metodología (`pIdleTarget`, `pKmlTarget`, `pExcTarget`,
  `pBonusShare`).

## Flujo de trabajo
- **Rama de desarrollo**: trabajar en una rama (no `main`). La entrega vive en `claude/practical-shannon-9jv0uz`.
- **Verificar cambios**: abrir `index.html` en un navegador (requiere internet por el CDN). Para validar la
  sintaxis del JS sin navegador: extraer el `<script>` inline y `node --check`.
- **Seguridad**: la API key **NUNCA** se escribe en el HTML ni en logs; vive solo como secret de GitHub.
  El workflow pasa `ALL_SECRETS = ${{ toJSON(secrets) }}` y el script toma solo los `MAPON_*`.

## Despliegue (resumen — detalle en README.md / la guía PDF)
1. **GitHub**: subir repo → secret `MAPON_<cliente>` → Actions → “Generar informes de clientes” → Run workflow.
2. **Netlify**: importar repo · build vacío · publish `.` · deploy. Liga por cliente: `…/clientes/<cliente>/`.

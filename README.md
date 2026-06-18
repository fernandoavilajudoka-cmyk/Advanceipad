# Informe Gerencial de Flota — Concretos Técnicos

Informe ejecutivo (estilo Canva, tema oscuro tipo presentación CEO Advance) que
se genera a partir de **tus APIs de Telematics Advance** (plataforma Mapon) y
presenta los indicadores clave de la flota de **Concretos Técnicos de México**.

> Reemplaza al demo `demoadvance01.netlify.app` con datos **reales y en vivo** de
> la flota, manteniendo la misma estructura de 8 secciones.

## ¿Qué incluye?

| # | Sección | Contenido |
|---|---------|-----------|
| 01 | Portada + Índice | Logo del cliente, periodo, totales |
| 02 | Resumen ejecutivo | 8 KPIs, distribución de tiempo de motor, alerta de cobertura GPS |
| 03 | Rendimiento | Tendencia diaria de distancia, top 5 y unidades de baja actividad |
| 04 | Combustible | Sensor Escort de varilla (BLE): consumo real vs. estimado, recargas y descargas por unidad |
| 05 | Plantas | Comparativo por planta / base operativa |
| 06 | Seguridad | Velocidad por unidad, excesos sobre el límite |
| 07 | Montacargas | Sección N/A (se activa con equipos de baja velocidad) |
| 08 | Ranking operativo | Score 0–100 (seguridad 40% + eficiencia 30% + actividad 30%) |
| 09 | Monetización | Impacto económico estimado (semanal/mensual/anual, MXN) |
| 10 | Metodología | Parámetros editables en vivo + naturaleza de los datos |

El logo de **Concretos Técnicos** aparece de forma discreta y elegante en la
esquina superior de cada página, y en grande en la portada.

## Arquitectura

```
scripts/fetch-data.mjs   → extrae y agrega datos de la API → web/data.json
web/index.html           → estructura del informe
web/styles.css           → tema ejecutivo oscuro (cian + dorado de marca)
web/app.js               → renderiza el informe y los gráficos desde data.json
web/data.json            → datos agregados (sin credenciales, se puede publicar)
web/assets/              → logo del cliente
```

El **token nunca llega al navegador**: la extracción ocurre en el generador y
solo se publica `data.json` con datos agregados.

## Uso

### 1. Generar / refrescar los datos

```bash
# con variable de entorno (recomendado)
MAPON_KEY=tu_api_key node scripts/fetch-data.mjs

# o con un periodo específico
MAPON_KEY=tu_api_key node scripts/fetch-data.mjs --from 2026-06-09 --till 2026-06-15
```

Alternativa: copia `config.example.json` a `config.local.json` y coloca tu key
(ese archivo está en `.gitignore`).

Por defecto analiza **todo el año en curso** (1 de enero → ayer), de modo que
los conectores de **Mes** y **Semana** incluyen todos los meses con actividad.

### 2. (Opcional) Empaquetar en un solo archivo HTML

```bash
node scripts/build-standalone.mjs
# → web/informe-concretos-tecnicos.html  (CSS, JS, datos, Chart.js y logo incrustados)
```

Archivo autónomo que se abre directo en el navegador o se comparte por correo.

### 3. Ver el informe localmente

```bash
python3 -m http.server 8080 --directory web
# abre http://localhost:8080
```

### 3. Publicar en Netlify

El sitio es estático: publica la carpeta `web/`. Ver `netlify.toml`.
Para refrescar datos en cada build, define `MAPON_KEY` como variable de
entorno en Netlify y descomenta el `command` en `netlify.toml`.

## Fuente de datos (API)

Base: `https://portal.telematicsadvance.com.mx/api/v1/` · autenticación con
`?key=...`. Endpoints utilizados (los disponibles para la API key actual):

- `company/get` — datos de la empresa
- `unit/list` — inventario de unidades, odómetro, estado
- `route/list` — tramos de manejo/detención por unidad y periodo
- `driver/list` — conductores
- `fuel/summary` — consumo real (flujo/CAN) y nivel del sensor por unidad
- `fuel/changes` — eventos de recarga (+) y descarga (−) del sensor Escort de varilla

### Datos medidos vs. estimados

- **Medidos:** distancia, tiempos de manejo/detención, tramos, velocidad
  promedio por tramo, odómetro (GPS); **consumo real de combustible** (flujo/CAN)
  y **eventos del sensor Escort de varilla** (recargas y descargas).
- **Estimados (modelo configurable):** combustible por norma l/100km (comparativo),
  ralentí y costos de monetización.

**Sensores Escort de varilla (BLE):** se leen vía `fuel/summary` y `fuel/changes`
(20 de 23 unidades equipadas). Las recargas/descargas se toman **únicamente del
sensor de varilla** (nivel físico del tanque); los eventos de la fuente CAN se
descartan porque provienen del contador acumulado de combustible del motor y
generan falsos negativos pequeños (ruido), no descargas reales del tanque. Además
se filtran las **oscilaciones del sensor** (un opuesto de magnitud similar dentro
de ±3 h se considera ruido), de modo que solo sobreviven las caídas reales sin
recarga simétrica de regreso. Las **descargas son indicios a validar en sitio**,
no conclusiones de robo. La velocidad instantánea aún requiere telemetría ampliada.

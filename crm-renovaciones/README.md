# Base homologada de clientes y renovaciones — Advance · Mapon CRM

Pipeline reproducible que unifica los archivos históricos/operativos de Advance
en **una sola base de datos por VIN**, lista para sincronizarse contra el **CRM
de Mapon** (PartnerAPI), con foco en el **control de renovaciones de servicio**.

> Llave de cruce de toda la información: **VIN**.

## Qué produce

`salida/` (no se versiona — contiene datos de clientes; ver *Seguridad*):

| Archivo | Contenido |
|---|---|
| `base_homologada.xlsx` | Hojas **Unidades** (1 fila/VIN), **Empresas** (1 fila/empresa), **Conflictos** (fechas que no concuerdan entre fuentes), **Metodologia** |
| `clientes_unidades.csv` | 1 fila por VIN, encabezados alineados al CRM de Mapon |
| `empresas.csv` | 1 fila por empresa con tipo AAA/AA/A |
| `reconciliacion_crm.csv` | Diff base ⇄ CRM en vivo (lo genera `reconciliar_crm.py`) |

### Columnas de la hoja *Unidades*
`VIN · FECHA DE ALTA · FECHA DE RENOVACIÓN (real) · FUENTE · PRÓXIMA RENOVACIÓN
· LÍMITE PRÓRROGA (+90d) · ORIGEN PRÓXIMA RENOVACIÓN · NOMBRE EMPRESA · ID
CLIENTE (MAPON) · NOMBRE CONTACTO · TELÉFONO · CORREO · NÚMERO DE UNIDADES ·
TIPO DE CLIENTE · ESTATUS RENOVACIÓN · VIGENCIA · ÚLTIMA CONEXIÓN · ESTADO ·
ACTIVA · # FUENTES`

## Cómo correrlo

```bash
pip install openpyxl
# 1) (opcional) jala el CRM en vivo a ./salida/_crm_raw  (requiere token)
export MAPON_TOKEN='eyJ...'                 # JWT del CRM (NO se commitea, vida ~7h)
python3 reconciliar_crm.py --probe         # diagnóstico de 1 llamada + headers
python3 reconciliar_crm.py                  # dump companies.json + cars.json

# 2) coloca los Excel de origen en ./fuentes  (ver lista abajo) y homologa
python3 homologar.py                        # toma ./fuentes + ./salida/_crm_raw → ./salida
```

`homologar.py` corre con o sin CRM. Si existe `./salida/_crm_raw`, usa el CRM como
fuente autoritativa (alta = `cars.createDateTime`, identidad de empresa, conteo de
unidades en vivo, última recepción) y la "Próxima Renovación" de las notas como P0.

### Archivos de origen esperados en `./fuentes`
- `RENOVACIONES_ACTUALIZADO_Operaciones.xlsx` — hojas mensuales de Operaciones (P1).
- `RENOVACIONES_230126_ERI_OK.xlsx` — *Unidades nuevas*, *Hoja 34*, *Missa*, *Agosto* (P2) + altas.
- `BASE_DE_DATOS_JUNIO_2026.xlsx` — export del CRM: *Base de datos*, *Detalle_Clientes/Unidades/Usuarios* (P3).
- `Bot_API_fechas_de_vencimiento.xlsx` — jalado crudo de la API (P4).

El script detecta columnas por **encabezado** (no por posición), así que tolera
que cambien los layouts entre meses.

## Regla de decisión para FECHA DE RENOVACIÓN

Cuando un mismo VIN trae fechas distintas, se elige por **prioridad de fuente**:

1. **P1 — RENOVACIONES ACTUALIZADO** (Operaciones, validada a mano)
2. **P2 — Operaciones complementarias** (Unidades nuevas / Hoja 34 / Missa / Agosto)
3. **P3 — Export BASE DE DATOS JUNIO** (snapshot de la API)
4. **P4 — Bot_API** (jalado crudo)

El **CRM en vivo es la verdad final** (`reconciliar_crm.py`). Si dos fuentes
difieren **> 7 días**, el VIN se lista en la hoja **Conflictos** para revisión.
Se descartan fechas con año fuera de 2019–2035 (basura: 0207, 1935, 2926…).

## PRÓXIMA RENOVACIÓN (estimación cuando no hay fecha)

Ver `RECOMENDACION_FECHAS.md`. Resumen:

- Ancla = última fecha real → si no hay, **fecha de alta** → última conexión → creación de empresa.
- `PRÓXIMA RENOVACIÓN` = **aniversario anual** del ancla rodado hacia adelante hasta ≥ hoy
  (validado: la mediana real alta→renovación es **exactamente 365 días**).
- **Sólo se proyecta a unidades activas.** Las inactivas (offline prolongado /
  BAJA / "No renovó") se dejan **sin proyección**: son recuperación, no renovación.
- `LÍMITE PRÓRROGA (+90d)` = vencimiento + 90 días (ventana de gracia/cobranza).

## Clasificación de cliente (imagen de referencia)

| Tipo | Unidades | Prioridad |
|---|---|---|
| **AAA** | 20 en adelante | Alta |
| **AA** | 10 a 19 | Media |
| **A** | 1 a 9 | Estándar |

## Mapeo al CRM de Mapon (PartnerAPI)

Referencia: `mapon-crm-openapi.json` (espec OpenAPI). Endpoints útiles:
`GET/POST /companies`, `GET /companies/{id}/contacts`, `GET/POST /cars`,
`GET /cars/vin-lookup/{vin}`.

| Campo de la base | Entidad / campo CRM | Notas |
|---|---|---|
| VIN | `cars.vinNumber` | Llave natural |
| FECHA DE ALTA | `cars.createDateTime` | El CRM es autoritativo |
| NOMBRE EMPRESA | `companies.name` | |
| ID CLIENTE (MAPON) | `companies.id` | |
| NOMBRE CONTACTO / TELÉFONO / CORREO | `companies/{id}/contacts` → `name` / `phone` / `email` | |
| NÚMERO DE UNIDADES | conteo de `cars` por `companyId` | |
| ESTADO / ÚLTIMA CONEXIÓN | `cars.lastDataReceived` | |
| **FECHA DE RENOVACIÓN** | *(sin campo nativo)* | Guardar como **campo personalizado** de la empresa o en `companies.statusTill`; el CRM no modela vencimientos por unidad |
| **TIPO DE CLIENTE (AAA/AA/A)** | `companies.clientCategories` (campo personalizado) | Derivado del número de unidades |

> **Importante:** Mapon **no** tiene un campo nativo de "fecha de renovación" por
> unidad. Por eso esta base es la fuente de verdad de renovaciones y, si se
> quiere reflejar en Mapon, se escribe como **campo personalizado**.
>
> **"Notas de Referencia":** el campo del UI donde los analistas anotaban la
> próxima renovación es a nivel **dispositivo** y **el CRM PartnerAPI no lo
> expone** (`cars.notes` regresa "/", `/devices/{id}` no trae notas,
> `/companies/{id}/notes` → 403). Esas fechas, sin embargo, **ya están en los
> archivos de Operaciones**. Para recuperarlas al 100% habría que usar la API
> principal de Mapon (`api.mapon.com`, `unit.notes`).

## Seguridad

- El **API key/JWT** vive **sólo** en la variable de entorno `MAPON_TOKEN`.
  Nunca se escribe a archivos, logs ni se commitea.
- `./fuentes` y `./salida` contienen **PII de clientes** (teléfonos, correos) y
  están en `.gitignore`. **No** se publican. Este repo se despliega en Netlify
  con `publish="."`; `netlify.toml` además bloquea `/crm-renovaciones/*`.
- Mantener el repositorio **privado**.

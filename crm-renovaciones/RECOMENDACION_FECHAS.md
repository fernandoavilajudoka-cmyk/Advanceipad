# Recomendación: qué fecha de renovación poner a las unidades sin fecha

**Contexto.** Das **1 año de servicio**. ~70% de las unidades **no** trae fecha
de renovación en los archivos. Tu idea inicial: *alta + 12 meses + 3 de prórroga*.
Esto lo analiza con los datos reales y propone un modelo más preciso.

## Lo que dicen los datos

Sobre la base homologada (10,259 VINs):

| Señal | Valor | Implicación |
|---|---|---|
| Mediana real **alta → renovación** (2,998 unidades con ambas fechas) | **365 días exactos** | El servicio **es anual desde la fecha de alta**. Tu hipótesis de 12 meses queda **confirmada con datos**. |
| Bucket más frecuente alta→renov | **12 meses (55%)**, luego 24m | Renovaciones en aniversarios anuales (12/24/36…). |
| Unidades sin renovación que **sí tienen fecha de alta** | **91%** (6,553 de 7,137) | Para casi todas podemos estimar con precisión usando el alta. |
| Estado de las unidades | **Activas 6,436 · Inactivas 3,547 · ?: 276** | ~35% están inactivas: proyectarles renovación es inventar ingreso que no existe. |

## Recomendación

**1. Ancla = la mejor fecha disponible, en este orden:**
   `fecha de renovación real → fecha de alta → última conexión → creación de la empresa`.
   Cuando conectemos el CRM, `cars.createDateTime` será el alta **autoritativa** y
   recalcula todo con más precisión.

**2. Renovación = aniversario anual del ancla**, rodado hacia adelante hasta que
   sea **≥ hoy** (no "alta + 12 meses" fijo). Ejemplo: una unidad dada de alta el
   2023-05-29 ya cumplió 2 ciclos; su **próxima** renovación es 2026-05-29 → si ya
   pasó, 2027-05-29. Así la fecha siempre es **accionable**, no histórica.

**3. Los 3 meses de prórroga: NO los sumes a la fecha de vencimiento.**
   Si pones *alta + 12 + 3*, recorres **todo** el calendario 3 meses y pierdes el
   momento óptimo de contacto y cobro. Mejor:
   - **Fecha de renovación** = aniversario (mes 12).
   - **Límite de prórroga** = renovación **+ 90 días** (columna `LÍMITE PRÓRROGA (+90d)`).
     Es la fecha tope de cobranza antes de dar de baja. Contactas **antes** del
     vencimiento y das gracia **después**.

**4. Sólo proyectar a unidades ACTIVAS.** Para las inactivas
   (offline prolongado / `BAJA` / "No renovó"), **no inventes** una renovación:
   van a una lista de **recuperación / win-back**, no al calendario de renovaciones.
   En la base se marcan con `ORIGEN PRÓXIMA RENOVACIÓN = "no proyectada (unidad inactiva)"`.

### Variables de precisión (de mayor a menor valor)
1. `cars.createDateTime` (alta del CRM) — la más precisa, autoritativa.
2. `lastDataReceived` / última conexión — define si la unidad sigue viva.
3. `Vigencia` / `Estatus de renovación` (Activo / Vencida / BAJA / No renovó).
4. `Estado` Online/Offline.
5. Fecha de creación de la empresa — último recurso si no hay alta.

## Resultado al aplicar el modelo (con CRM en vivo integrado)

Confirmaste **+90 días** para las que no traen fecha real → ya aplicado.

| Origen de la PRÓXIMA RENOVACIÓN | Unidades |
|---|---|
| Fecha real (archivos + CRM): 1,461 ya futuras + 1,661 rodadas a próximo aniversario | **3,122** |
| Estimada = aniversario de alta **+ 90 días** (unidades activas) | **4,521** |
| Estimada por última conexión / creación de empresa +90d | **10** |
| No proyectada por unidad inactiva (→ recuperación) | **2,478** |
| Sin dato suficiente | **128** |

→ **7,653 unidades (74%) con fecha de renovación accionable** (≥ hoy), y 2,478
inactivas separadas para recuperación en vez de meterlas al calendario.

## Lo que aportó el CRM en vivo
- **Fecha de alta autoritativa** (`cars.createDateTime`) para **4,792 VINs** —
  reemplaza la de archivos donde existe, subiendo la precisión de toda la estimación.
- **Identidad de empresa** (companyId/nombre) y **conteo de unidades en vivo** → AAA/AA/A más exacto.
- **Última recepción** fresca para decidir activa/inactiva.

## ⚠️ Sobre las "Notas de Referencia" del CRM
Donde los analistas escribían "Próxima Renovación: dd/mm/aaaa" es un campo a
nivel **dispositivo**, y **este CRM API (PartnerAPI) NO lo expone** (ni en
`/cars/{id}.notes`, que regresa "/", ni en `/devices/{id}`, que no trae notas;
`/companies/{id}/notes` da 403). Verifiqué el dispositivo de tu captura
(IMEI 862524061126955) y coincide, pero la nota no viene en la API.
**La buena noticia:** esas fechas **ya estaban capturadas en tus archivos de
Operaciones** (p. ej. el TR-34 de tu captura, 26/02/2027, salió de los archivos).
Si quieres recuperar el 100% de esas notas habría que usar la **API principal de
Mapon** (api.mapon.com, `unit.notes`) o un export del campo — dime y lo conecto.

## Decisión pendiente
- Para las **inactivas**: ¿(a) dejarlas sin fecha como ahora (recomendado), o
  (b) proyectarlas igual marcadas "tentativas" para cobranza agresiva?

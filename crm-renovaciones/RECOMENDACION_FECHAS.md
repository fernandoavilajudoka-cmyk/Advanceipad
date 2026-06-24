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

## Resultado al aplicar el modelo

| Origen de la PRÓXIMA RENOVACIÓN | Unidades |
|---|---|
| Fecha real de archivos (1,461 ya futuras + 1,661 rodadas a próximo aniversario) | **3,122** |
| Estimada por aniversario de alta (unidades activas) | **4,132** |
| Estimada por última conexión / creación de empresa | **12** |
| No proyectada por unidad inactiva (→ recuperación) | **2,863** |
| Sin dato suficiente | **130** |

→ **7,266 unidades con fecha de renovación accionable** (≥ hoy), y 2,863 inactivas
correctamente separadas para recuperación en vez de meterlas al calendario.

## Decisión pendiente contigo
- ¿Confirmas **90 días** de prórroga, o prefieres otro número (p. ej. 60)?
- ¿Para las **inactivas** quieres (a) dejarlas sin fecha como ahora, o (b)
  proyectarlas igual marcándolas "tentativas" para cobranza agresiva?

Ambas son un cambio de una línea en `homologar.py` (`grace=90` y la regla de
unidad inactiva). Dime y lo ajusto.

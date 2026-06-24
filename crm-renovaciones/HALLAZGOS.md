# Hallazgos — Base homologada de clientes y renovaciones (Advance)

**Para:** Equipo de Servicio a Cliente · **Fecha:** 2026-06-24
**Fuente:** consolidación de 4 archivos históricos/operativos + CRM de Mapon en vivo. Llave de cruce: **VIN**.

---

## 1. Resumen ejecutivo
- Se unificó **una sola base por VIN**: **10,259 unidades** de **1,407 empresas**.
- Antes solo **30% (3,122)** de las unidades tenían fecha de renovación registrada.
  Tras homologar y estimar, **74% (7,653)** ya tienen una **próxima renovación accionable**.
- Hallazgo crítico para cobranza: **424 unidades marcadas "BAJA" siguen reportando al CRM**
  (357 conectaron el mismo día) → probable servicio activo no facturado.
- El servicio es **anual**: la mediana real entre alta y renovación es **exactamente 365 días**.

---

## 2. Cobertura de fechas de renovación
| | Unidades | % |
|---|---|---|
| Con fecha **real** (de archivos / CRM) | 3,122 | 30% |
| Con fecha **estimada** (aniversario de alta +90 días) | 4,531 | 44% |
| **Total con próxima renovación accionable** | **7,653** | **74%** |
| Sin fecha (baja o sin dato suficiente) | 2,606 | 26% |
| Con fecha de alta | 9,558 | 93% |
| Con teléfono o correo | 10,199 | 99% |

**Regla de estimación (acordada):** a las unidades **activas sin fecha** se les asigna el
**aniversario de su fecha de alta + 90 días de prórroga**. A las inactivas **no** se les
proyecta fecha (van a recuperación, no a renovación).

---

## 3. Situación de las unidades
| Situación | Unidades | Definición |
|---|---|---|
| **Activa** | 7,201 | En servicio → con próxima renovación |
| **Baja** | 2,634 | Vigencia=BAJA / "No renovó" / sin señal +120 días |
| **Pendiente de revisión** | 424 | Marcada BAJA en el archivo **pero sigue reportando** al CRM |

### ⚠️ Acción prioritaria: las 424 "Pendiente de revisión"
- **357 conectaron el mismo día** del corte; las demás en los últimos 30 días.
- El flag "BAJA" del archivo está **desactualizado** para clientes grandes
  (Tres Guerras 75, Jet Van Car Rental 59, JetVan 35, Quality Post 31, BINNIBUS 23, Clear Leasing 22…).
- **Riesgo:** servicio prestado sin cobro / cliente activo dado de baja por error.
- **Acción:** validar con el cliente, corregir el estatus en el CRM y, si aplica, reactivar facturación.
- Documento dedicado entregado: *Unidades pendiente de revisión (357)*.

---

## 4. Clasificación de clientes (por nº de unidades)
| Tipo | Empresas | Criterio | Prioridad |
|---|---|---|---|
| **AAA** | 72 | 20+ unidades | Alta |
| **AA** | 27 | 10–19 unidades | Media |
| **A** | 1,307 | 1–9 unidades | Estándar |

---

## 5. Conflictos y calidad de datos
- **139 VINs** tienen fechas de renovación **distintas entre fuentes** (>7 días de diferencia).
  Se resolvieron por prioridad **Operaciones > Export BASE > API**, y quedaron listados en la
  hoja **"Conflictos"** para revisión manual.
- Se descartaron ~9 fechas basura (años 0207, 1935, 2926).
- **Nombres de empresa fragmentados:** ej. *JetVan* y *Jet Van Car Rental* aparecen separados —
  **confirmado que son clientes distintos**. El cruce por VIN→companyId del CRM canoniza la identidad.
- **128 unidades** no tienen fecha ni dato suficiente para estimarla.

---

## 6. Dispositivos (modelo GPS) a renovar
| Modelo | Unidades |
|---|---|
| GV350CEU | 5,079 |
| GV58LAU | 2,704 |
| FMC920 | 471 |
| GV500MAP | 293 |
| Otros (ME40, CAN006, GL601, etc.) | ~50 |
| Sin dato de modelo | 1,658 |

---

## 7. Hallazgos del CRM de Mapon (PartnerAPI)
- El CRM tiene **536 empresas** y **5,801 vehículos** (cuenta/distribuidor Advance).
- **Aportó como verdad autoritativa:** fecha de alta real (`createDateTime`) para **4,792 VINs**,
  identidad de empresa (companyId), conteo de unidades en vivo y última recepción de datos.
- **"Notas de Referencia" no se exponen por este API.** Es donde los analistas anotaban la
  "Próxima Renovación", pero es un campo a nivel **dispositivo** que el PartnerAPI no entrega
  (`cars.notes` regresa "/", `/devices/{id}` no trae notas, `/companies/{id}/notes` → 403 sin permiso).
  **La buena noticia:** esas fechas ya estaban capturadas en los archivos de Operaciones.
  Para recuperarlas al 100% se requiere la **API principal de Mapon** (`api.mapon.com`, `unit.notes`).
- El token del CRM es de **vida corta (~7 h)** y rota en cada uso.

---

## 8. Recomendaciones para Servicio a Cliente
1. **Atacar primero las 357 unidades "BAJA pero reportando"** — posible ingreso no cobrado y
   corrección de estatus en el CRM.
2. **Usar la "Próxima renovación" + "Límite prórroga (+90d)"** como cola de contacto/cobranza.
3. **Priorizar por tipo de cliente** (AAA → AA → A) y por proximidad de la fecha.
4. **Revisar la hoja "Conflictos"** para cerrar las 139 fechas en disputa con el dato correcto.
5. **Mantener la base viva:** reejecutar el pipeline cuando cambien los archivos o el CRM;
   evaluar conectar la API principal de Mapon para traer las "Notas de Referencia".

---

## 9. Entregables
- **`base_homologada.xlsx`** — Unidades · Empresas · Conflictos · Metodología.
- **`clientes_unidades.csv` / `empresas.csv`** — alineados al CRM de Mapon.
- **`dashboard_renovaciones.html`** — tablero interactivo (Año/Mes/Semana/Dispositivo/Tipo).
- **Google Sheet "Unidades pendiente de revisión (357)"** — las BAJA que siguen reportando.
- **Este documento de hallazgos.**

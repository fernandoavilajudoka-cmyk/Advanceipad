# Presentación — Advance 3.0 × JET VAN

Propuesta comercial de Telematics Advance (LDR Solutions) para **Jet Van Car Rental**, arrendadora
de flotas vehiculares con operación en el sector público y privado.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | **La presentación.** 23 láminas, un solo archivo autocontenido (imágenes incrustadas). Se abre con doble clic, sin internet. |
| `Advance-JetVan-Presentacion.pdf` | La misma presentación exportada a PDF 16:9, para enviar por correo o imprimir. |
| `BRIEFING-INTERNO.md` | **No compartir con el cliente.** Preparación de la junta: perfil, ángulos de venta, objeciones y preguntas de descubrimiento. |
| `_fuente/` | Plantilla e imágenes para regenerar la presentación. |

## Cómo se presenta

- **→ / ← / barra espaciadora** — avanzar y retroceder
- **I** — índice de láminas (o el botón *Índice*)
- **PDF** — imprime en 16:9; en el diálogo del navegador hay que dejar activados los gráficos de fondo
- En tableta y celular funciona el deslizamiento lateral

La lámina 18 (**el número**) es interactiva: los supuestos se editan enfrente del cliente y el resultado
se recalcula solo. El interruptor *escenario conservador* viene activado a propósito — deja el retorno
en la mitad del beneficio publicado, que es como conviene abrir la conversación.

## Estructura

| # | Lámina | # | Lámina |
|---|---|---|---|
| 01 | Portada | 13 | El informe, con su nombre |
| 02 | Lo que entendemos de JET VAN | 14 | Nabi — la flota por WhatsApp |
| 03 | El momento: la escala cambió | 15 | Copiloto y Advance GO |
| 04 | Los cinco riesgos del arrendador | 16 | Evidencia auditable |
| 05 | GPS vs. Advance 3.0 | 17 | De arrendadora a flota gestionada |
| 06 | Advance 3.0 en una lámina | 18 | El número (calculadora en vivo) |
| 07 | Seguridad patrimonial | 19 | Hardware por tipo de unidad |
| 08 | Mantenimiento con IA | 20 | Plan 30 · 60 · 90 |
| 09 | Combustible y CANBus | 21 | Por qué Advance |
| 10 | Seguridad vial y video con IA | 22 | Siguiente paso |
| 11 | Modelos PA y PR | 23 | Fuentes y notas |
| 12 | DataLab 3.0 | | |

## Regenerar

Las capturas de las láminas 12, 13 y 17 salen de la plantilla de informe de este mismo repositorio
(`../../index.html`), rotulada como **JET VAN · Demo** y con **datos de demostración** — no hay
información de ningún cliente real.

```bash
node _fuente/build.mjs      # incrusta _fuente/img/*.jpg en la plantilla y reescribe index.html
```

Para cambiar textos se edita `_fuente/deck.template.html` y se vuelve a correr el build.
El PDF se regenera imprimiendo desde el navegador o con Playwright a 1280×720 px.

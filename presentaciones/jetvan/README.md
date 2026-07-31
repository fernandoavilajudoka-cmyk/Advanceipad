# Presentación — Advance 3.0 × JET VAN

Propuesta comercial de Telematics Advance (LDR Solutions) para **Jet Van Car Rental**, arrendadora
de flotas vehiculares con operación en el sector público y privado.

## Tres versiones, un mismo diseño

| Versión | Láminas | Para qué |
|---|---|---|
| `index.html` · `Advance-JetVan-Presentacion.pdf` | **4** | **La junta.** Qué podemos hacer, cómo funciona la gestión de flota y el walk-around fotográfico. |
| `ampliada.html` · `Advance-JetVan-Ampliada.pdf` | 10 | Si hay más tiempo o piden el caso de negocio: contexto, GPS vs. Advance, informe DataLab y el modelo de impacto. |
| `completa.html` · `Advance-JetVan-Completa.pdf` | 23 | Sesión técnica de seguimiento: el detalle módulo por módulo, hardware y plan de despliegue. |

Además: **`BRIEFING-INTERNO.md`** — preparación de la junta (perfil, ángulos de venta, objeciones y preguntas
de descubrimiento). **No se comparte con el cliente** y `netlify.toml` lo bloquea de la publicación.

## La versión de 4 láminas

1. **Portada**
2. **Lo que podemos hacer** — las cinco cifras de resultado y los módulos: seguridad patrimonial,
   DataLab 3.0, Nabi por WhatsApp y modelos PA/PR
3. **Cómo funciona la gestión de flota** — del motor a la decisión en cuatro pasos: el dato, la plataforma,
   la IA y quién decide
4. **Walk-around** — inspección fotográfica de entrega y devolución con la app Copiloto, con el diagrama
   de los ocho puntos del recorrido

## Cómo se presenta

- **→ / ← / barra espaciadora** — avanzar y retroceder
- **I** — índice de láminas (o el botón *Índice*)
- **PDF** — imprime en 16:9; en el diálogo del navegador hay que dejar activados los gráficos de fondo
- En tableta y celular funciona el deslizamiento lateral

En la versión ampliada, la lámina del **modelo de impacto** es interactiva: los supuestos se editan enfrente
del cliente y el resultado se recalcula. El interruptor *escenario conservador* viene activado a propósito —
deja el retorno en la mitad del beneficio publicado, que es como conviene abrir la conversación.

## Regenerar

Las capturas de las versiones ampliada y completa salen de la plantilla de informe de este mismo repositorio
(`../../index.html`), rotulada como **JET VAN · Demo** y con **datos de demostración** — no hay información
de ningún cliente real.

```bash
node _fuente/build.mjs      # incrusta _fuente/img/*.jpg y reescribe los tres HTML
```

Para cambiar textos se edita la plantilla correspondiente en `_fuente/` y se vuelve a correr el build.
Los PDF se regeneran imprimiendo desde el navegador o con Playwright a 1280×720 px.

/* Ensambla las presentaciones autocontenidas: incrusta las capturas del informe
   como data URI en cada plantilla y escribe los HTML de la carpeta superior.

   Uso:  node _fuente/build.mjs                                                  */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const IMGS = { PORTADA:'portada', EJECUTIVO:'ejecutivo', SEGURIDAD:'seguridad',
               COMBUSTIBLE:'combustible', MONETIZACION:'monetizacion' };

const DECKS = [
  { src:'deck.template.html',          out:'index.html',    title:'Advance 3.0 × JET VAN — Propuesta' },
  { src:'deck-ampliado.template.html', out:'ampliada.html', title:'Advance 3.0 × JET VAN — Versión ampliada' },
  { src:'deck-completo.template.html', out:'completa.html', title:'Advance 3.0 × JET VAN — Versión completa' },
];

const dataUri = f => 'data:image/jpeg;base64,' +
  readFileSync(join(here, 'img', f + '.jpg')).toString('base64');

for (const deck of DECKS) {
  let html = readFileSync(join(here, deck.src), 'utf8');
  for (const [token, file] of Object.entries(IMGS)) {
    if (html.includes(`__IMG_${token}__`)) html = html.replaceAll(`__IMG_${token}__`, dataUri(file));
  }
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${deck.title}</title>`);
  writeFileSync(join(here, '..', deck.out), html);
  const n = (html.match(/<section class="slide/g) || []).length;
  console.log(`${deck.out.padEnd(14)} ${String(n).padStart(2)} láminas  ${(html.length/1024/1024).toFixed(2)} MB`);
}

/* Ensambla la presentación autocontenida: incrusta las imágenes del informe
   como data URI dentro de deck.template.html y escribe ../index.html          */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const IMGS = { PORTADA:'portada', EJECUTIVO:'ejecutivo', SEGURIDAD:'seguridad',
               COMBUSTIBLE:'combustible', MONETIZACION:'monetizacion' };

let html = readFileSync(join(here,'deck.template.html'),'utf8');
for (const [token,file] of Object.entries(IMGS)) {
  const b64 = readFileSync(join(here,'img',file+'.jpg')).toString('base64');
  html = html.replaceAll(`__IMG_${token}__`, `data:image/jpeg;base64,${b64}`);
}
const out = join(here,'..','index.html');
writeFileSync(out, html);
console.log('OK →', out, (html.length/1024/1024).toFixed(2)+' MB');

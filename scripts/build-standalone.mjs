#!/usr/bin/env node
/**
 * Empaqueta el informe en un único archivo HTML autónomo
 * (CSS, JS, datos, Chart.js y logo incrustados), apto para abrir
 * directamente en el navegador o compartir por correo.
 *
 *   node scripts/build-standalone.mjs
 *   → web/informe-concretos-tecnicos.html
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const W = (p) => resolve(ROOT, 'web', p);
const read = (p) => readFileSync(W(p), 'utf8');

const html = read('index.html');
const css = read('styles.css');
const chartjs = read('assets/chart.umd.min.js');
let appjs = read('app.js');
const data = read('data.json');
const logoB64 = readFileSync(W('assets/concretos-tecnicos.png')).toString('base64');
const logoURI = `data:image/png;base64,${logoB64}`;

// El logo se referencia como ruta en app.js e index.html → incrustar como data URI
appjs = appjs.split('assets/concretos-tecnicos.png').join(logoURI);

// Override de fetch para servir data.json incrustado, así app.js funciona sin cambios
const bootstrap = `
const __DATA__ = ${data};
(function(){ const o = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = (u, ...a) => (u && String(u).indexOf('data.json') >= 0)
    ? Promise.resolve({ json: async () => __DATA__ })
    : (o ? o(u, ...a) : Promise.reject(new Error('offline')));
})();
`;

// Se usa split/join (no String.replace) para evitar que secuencias como $'
// dentro del JS se interpreten como patrones de reemplazo.
let out = html
  .split('<link rel="stylesheet" href="styles.css" />').join(`<style>\n${css}\n</style>`)
  .split('<script src="assets/chart.umd.min.js"></script>').join(`<script>${chartjs}</script>`)
  .split('<script src="app.js"></script>').join(`<script>${bootstrap}\n${appjs}</script>`)
  .split('assets/concretos-tecnicos.png').join(logoURI);

const OUT = W('informe-concretos-tecnicos.html');
writeFileSync(OUT, out);
console.error(`✔ ${OUT} (${(out.length / 1024).toFixed(0)} KB) — abre este archivo en el navegador`);

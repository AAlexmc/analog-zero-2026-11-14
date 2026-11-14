// Búsqueda por objetivo de misión en la pantalla de resultados, en Chromium: lugares, ficha, Metrics, Compare, Portfolio
// y capa de similitud iguales a motor.js en node con los mismos parámetros y referencia; misión nueva; URL; móvil; contraste.
// Uso: node scripts/captura_misiones.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { cargar } from '../web/buscar/motor.js';
import { formatoLatLon } from '../web/explorar/geo.js';
import { fmtPct, formatoValor as formatoValorSup, planoSup, minMax, pintarMapa, nombreCorto, titularCartera, letra } from '../web/analogos/metricas.js';
import { parametrosDe, referenciaDe, noMedidas, textoOpcion, resumenLugar, lineaResumen, activaDeCatalogo, activaNueva, opcionesBusqueda, frasesNoUsados } from '../web/analogos/misiones.js';
import { contraste } from '../web/marca/contraste.js';
import { ORIGENES_EXTERNOS } from '../web/relieve/calculo.js';

const formatoValor = (v, u, p) => planoSup(formatoValorSup(v, u, p));

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'misiones');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

const fallos = [];
const falla = (m) => { fallos.push(m); console.error(`FAIL ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);

// ---------- Referencia en node ----------
const M = await cargar(join(WEB, 'data/cuerpos') + '/', async (ruta, tipo) => {
  const b = await readFile(ruta);
  return tipo === 'json' ? JSON.parse(b.toString('utf8')) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});
const P = Object.fromEntries([...M.indice.parametros, ...M.indice.parametros_tierra].map((p) => [p.id, p]));
const corto = (id) => nombreCorto(id, P);
const SITIOS = JSON.parse(readFileSync(join(WEB, 'data/sitios_ensayo.json'), 'utf8')).sitios;
const CATALOGO = JSON.parse(readFileSync(join(WEB, 'data/misiones.json'), 'utf8')).misiones;
const mision = (id) => CATALOGO.find((m) => m.id === id);
const J = { lat: 18.38, lon: 77.58 };
const URL_J = `/analogos/index.html?mundo=mars&lat=${J.lat}&lon=${J.lon}&nombre=Jezero`;
const oJ = M.leerPunto('mars', J.lat, J.lon);
const nodo = (activa) => ({ r: M.buscar(oJ, opcionesBusqueda(activa)), c: M.cartera(oJ, opcionesBusqueda(activa)) });

// ---------- Navegador ----------
const servidor = createServer(async (req, res) => {
  const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = join(WEB, ruta.endsWith('/') ? `${ruta}index.html` : ruta);
  if (!f.startsWith(WEB)) { res.writeHead(403).end(); return; }
  try {
    const b = await readFile(f);
    res.writeHead(200, { 'content-type': TIPOS[extname(f)] ?? 'application/octet-stream' }).end(b);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${servidor.address().port}`;
await mkdir(SALIDA, { recursive: true });
const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function pagina(ancho, alto, etiqueta, opciones = {}) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: alto }, ...opciones });
  const pag = await ctx.newPage();
  pag.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') falla(`console ${m.type()} (${etiqueta}): ${m.text()}`); });
  pag.on('pageerror', (e) => falla(`page error (${etiqueta}): ${e.message}`));
  return pag;
}
async function esperarQue(pag, f, que, ms = 20000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await pag.evaluate(f, arg)) return; await pag.waitForTimeout(80); }
  throw new Error(`timeout waiting for ${que}`);
}
const abrir = async (pag, url) => {
  await pag.goto(`${baseUrl}${url}`);
  await pag.waitForFunction(() => window.__az?.analogos?.listo === true, null, { timeout: 120000 });
  await pag.evaluate(() => { window.__az.analogos.autoTerreno = false; });
  const e = await pag.evaluate(() => window.__az.analogos.errores);
  if (e.length) falla(`analogs page errors: ${e.join('; ')}`);
};
const quieta = (pag) => esperarQue(pag, () => new Promise((ok) => {
  const v = window.__az.analogos.vista, a = v.camara.position.clone();
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => ok(!v.animando() && v.camara.position.distanceTo(a) < 1e-12))));
}), 'the camera to stop');

const leerLugares = (pag, sel = '#lista') => pag.evaluate((sel) => [...document.querySelectorAll(`${sel} > .tarjeta`)].map((t) => ({
  pct: t.querySelector('.pct span').textContent, coords: t.querySelector('.coords').textContent, resumen: t.querySelector('.resumen')?.textContent ?? null,
})), sel);
function compararLugares(que, dom, esperado, conResumen) {
  if (dom.length !== esperado.length) { falla(`${que}: ${dom.length} cards on screen, node has ${esperado.length}`); return; }
  esperado.forEach((x, k) => {
    const quiero = { pct: fmtPct(x.similitud_pct), coords: formatoLatLon(x.lat, x.lon).texto, resumen: conResumen ? lineaResumen(resumenLugar(x), corto) : null };
    for (const [kk, v] of Object.entries(quiero)) if (dom[k][kk] !== v) falla(`${que} card ${k + 1} ${kk}: screen "${dom[k][kk]}" ≠ node "${v}"`);
  });
  ok(`${que}: ${dom.map((d, k) => `${k + 1}. ${d.pct} ${d.coords}${d.resumen ? ` «${d.resumen}»` : ''}`).join(' | ')} = node`);
}
const leerFicha = (pag) => pag.evaluate(() => {
  const f = document.getElementById('mision-ficha');
  return {
    oculta: f.hidden, texto: f.textContent, titulo: f.querySelector('.mision-titulo')?.textContent ?? null, tituloHtml: f.querySelector('.mision-titulo')?.innerHTML ?? null,
    que: f.querySelector('.mision-que')?.textContent ?? null, campanas: [...f.querySelectorAll('ul.campanas > li')].map((li) => ({ t: li.textContent, fuente: li.querySelector('a')?.getAttribute('href'), cita: li.querySelector('blockquote')?.textContent ?? null })),
    resumenCampanas: f.querySelector('.campanas-caja summary')?.textContent ?? null,
    chips: [...f.querySelectorAll('ul.chips > li')].map((c) => c.dataset.id), propio: [...f.querySelectorAll('.mision-sub .marca-chip')].map((c) => c.textContent),
    ref: f.querySelector('.ref')?.textContent ?? null, noMedido: f.querySelector('.no-medido-caja summary')?.textContent ?? null,
    noMedidoItems: [...f.querySelectorAll('ul.no-medido > li')].map((li) => li.textContent), avisos: [...f.querySelectorAll('.aviso')].map((p) => p.textContent),
  };
});
const leerMetricas = (pag) => pag.evaluate(() => [...document.querySelectorAll('#metricas .grupo .fila')].map((f) => ({
  id: f.dataset.id, rotulo: f.querySelector('.valores dt').textContent, objetivo: f.querySelector('[data-v=objetivo]').textContent, tierra: f.querySelector('[data-v=tierra]').textContent, desv: f.querySelector('[data-v=desv]').textContent,
})));
function compararMetricas(que, dom, x, rotuloRef) {
  const comparables = x.parametros.filter((p) => p.estado === 'ok' || p.estado === 'sin_dato_tierra');
  if (dom.length !== comparables.length) falla(`${que}: ${dom.length} rows, node has ${comparables.length}`);
  for (const p of comparables) {
    const f = dom.find((z) => z.id === p.id);
    if (!f) { falla(`${que}: row ${p.id} missing`); continue; }
    const quiero = { rotulo: p.origen_objetivo === 'referencia' ? rotuloRef : 'Mars', objetivo: formatoValor(p.valor_objetivo, P[p.id].unidad, P[p.id]), tierra: formatoValor(p.valor_tierra, P[p.id].unidad, P[p.id]), desv: p.desviacion_pct === null ? 'no data' : `${fmtPct(p.desviacion_pct)} off` };
    for (const [k, v] of Object.entries(quiero)) if (f[k] !== v) falla(`${que} ${p.id} ${k}: screen "${f[k]}" ≠ node "${v}"`);
  }
  ok(`${que}: ${dom.map((f) => `${f.id} [${f.rotulo} ${f.objetivo} / Earth ${f.tierra}] ${f.desv}`).join(' · ')} = node`);
}
// Teselas sintéticas para la vista de terreno (sin red): rampa de relieve y una imagen lisa.
function png(rgbDe) {
  const crudo = Buffer.alloc((256 * 3 + 1) * 256);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) crudo.set(rgbDe(i, j), j * (256 * 3 + 1) + 1 + i * 3);
  const trozo = (tipo, datos) => {
    const t = Buffer.from(tipo, 'latin1'), l = Buffer.alloc(4), c = Buffer.alloc(4);
    l.writeUInt32BE(datos.length); c.writeUInt32BE(crc32(Buffer.concat([t, datos])) >>> 0);
    return Buffer.concat([l, t, datos, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))]);
}
const TESELA_RELIEVE = png((i, j) => { const h = 32768 + 1000 + 3 * i + 2 * j; return [Math.floor(h / 256), h % 256, 0]; });
const TESELA_IMAGEN = png(() => [170, 140, 100]);
const redSintetica = async (pag) => {
  await pag.route(`${ORIGENES_EXTERNOS[0]}/**`, (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: TESELA_RELIEVE }));
  await pag.route(`${ORIGENES_EXTERNOS[1]}/**`, (r) => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: TESELA_IMAGEN }));
};

const elegirMision = async (pag, id) => { await pag.selectOption('#mision', id); await pag.waitForTimeout(150); };
const ver = async (pag, tab) => { await pag.click(`#tab-${tab}`); await pag.waitForTimeout(250); };

// Textos visibles de una zona: color y fondo efectivo; sin fondo opaco se toma blanco (panel translúcido sobre el globo más claro).
const leerContraste = (pag, selector) => pag.evaluate((selector) => {
  const rgba = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(',').map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; };
  const vistos = new Map();
  for (const raiz of document.querySelectorAll(selector)) {
    const nodos = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    for (let n = nodos.nextNode(); n; n = nodos.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest('[hidden], option, details:not([open]) > :not(summary)')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || el.closest('button:disabled')) continue;
      const color = rgba(cs.color);
      const capas = [];
      for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
        const b = rgba(getComputedStyle(a).backgroundColor);
        if (b && b[3] > 0) capas.push(b);
        if (b && b[3] >= 1) break;
      }
      let fondo = [255, 255, 255];
      for (const c of capas.reverse()) fondo = fondo.map((v, i) => c[3] * c[i] + (1 - c[3]) * v);
      const texto = color.slice(0, 3).map((v, i) => color[3] * v + (1 - color[3]) * fondo[i]);
      const clave = `${texto.map(Math.round)}|${fondo.map(Math.round)}`;
      if (!vistos.has(clave)) vistos.set(clave, { texto, fondo, muestra: n.textContent.trim().slice(0, 40), rojo: (color[0] === 228 && color[1] === 55 && color[2] === 0) || (color[0] === 142 && color[1] === 17 && color[2] === 0) });
    }
  }
  return [...vistos.values()];
}, selector);
async function revisarContraste(pag, que, selector) {
  const t = await leerContraste(pag, selector);
  const malas = t.filter((x) => x.rojo || contraste(x.texto, x.fondo) < 4.5);
  if (!t.length) falla(`${que}: no text found for ${selector}`);
  else if (malas.length) falla(`${que}: contrast < 4.5 or red text → ${malas.map((x) => `"${x.muestra}" ${contraste(x.texto, x.fondo).toFixed(2)}`).join('; ')}`);
  else ok(`${que}: ${t.length} text/background pairs, all ≥ 4.5:1 (worst case: panel over white)`);
}

try {
  // ---------- 0. Sin misión: lo de siempre ----------
  const pag = await pagina(1440, 900, 'Mars desktop');
  await abrir(pag, URL_J);
  await quieta(pag);
  const r0 = M.buscar(oJ);
  const lista0 = await leerLugares(pag);
  compararLugares('no mission (Jezero 18.38 N 77.58 E)', lista0, r0.resultados, false);
  const sel0 = await pag.evaluate(() => ({ valor: document.getElementById('mision').value, opciones: [...document.getElementById('mision').options].map((o) => ({ v: o.value, t: o.textContent, d: o.disabled })), ficha: document.getElementById('mision-ficha').hidden, url: location.search, avanzado: document.getElementById('avanzado').hidden }));
  const quieroOpc = [{ v: '', t: 'All parameters (no mission)', d: false }, ...CATALOGO.map((m) => ({ v: m.id, t: textoOpcion(m, 'mars', M.indice), d: m.respaldo === 'no_encontrado' || !parametrosDe(m, M.indice).length })), { v: 'nueva', t: 'New mission…', d: false }];
  if (sel0.valor !== '' || !sel0.ficha || JSON.stringify(sel0.opciones) !== JSON.stringify(quieroOpc)) falla(`selector at start: ${JSON.stringify(sel0)}`);
  else ok(`selector: ${sel0.opciones.map((o) => `${o.t}${o.d ? ' [disabled]' : ''}`).join(' | ')}`);
  await pag.screenshot({ path: join(SALIDA, '00-sin-mision.png') });

  // ---------- a. Biomarcadores en Jezero ----------
  const aB = activaDeCatalogo(mision('biomarcadores'), M.indice, SITIOS);
  const { r: rB, c: cB } = nodo(aB);
  await pag.click('label.interruptor:has(#capa)');
  await pag.waitForTimeout(300);
  await elegirMision(pag, 'biomarcadores');
  await quieta(pag);
  const estB = await pag.evaluate(() => ({ url: location.search, mision: window.__az.analogos.mision?.id, usados: window.__az.analogos.r.usados, sinRef: window.__az.analogos.r.sin_referencia, avanzado: document.getElementById('avanzado').hidden, terreno: window.__az.analogos.terrenoAuto }));
  if (!estB.url.endsWith('&mision=biomarcadores') || estB.mision !== 'biomarcadores' || JSON.stringify(estB.usados) !== JSON.stringify(rB.usados) || !estB.avanzado) falla(`biomarcadores state: ${JSON.stringify(estB)}`);
  else ok(`biomarcadores: URL ${estB.url}; parameters used ${estB.usados.join(', ')} = node; "Advanced" hidden`);
  compararLugares('biomarcadores places', await leerLugares(pag), rB.resultados, true);
  compararLugares('biomarcadores partly compared', await leerLugares(pag, '#lista-parciales'), rB.parciales, true);
  const fB = await leerFicha(pag);
  const refB = referenciaDe(mision('biomarcadores'), SITIOS);
  const mB = mision('biomarcadores');
  const quieroRef = `Earth-only parameters are compared with NASA's test site: ${refB.nombre} (${formatoLatLon(refB.lat, refB.lon).texto})`;
  const errFicha = [];
  if (fB.oculta) errFicha.push('hidden');
  if (fB.que !== mB.que_se_prueba) errFicha.push(`que ${fB.que}`);
  if (fB.campanas.length !== mB.campanas.length || fB.campanas.some((c, k) => !c.t.startsWith(mB.campanas[k].nombre) || c.fuente !== mB.campanas[k].fuente || c.cita !== mB.campanas[k].cita)) errFicha.push(`campaigns ${JSON.stringify(fB.campanas)}`);
  if (fB.resumenCampanas !== `NASA ran this at (${mB.campanas.length} campaigns)`) errFicha.push(`campaigns summary ${fB.resumenCampanas}`);
  if (JSON.stringify(fB.chips) !== JSON.stringify(parametrosDe(mB, M.indice)) || fB.propio.join() !== 'own mapping') errFicha.push(`chips ${fB.chips} ${fB.propio}`);
  if (fB.ref !== quieroRef || !/Yungay/.test(fB.ref ?? '')) errFicha.push(`reference "${fB.ref}"`);
  const nmB = noMedidas(mB);
  if (fB.noMedido !== `Named by NASA, NOT MEASURED here (${nmB.length})` || JSON.stringify(fB.noMedidoItems) !== JSON.stringify(nmB.map((n) => `${n.nombre}: ${n.motivo}`))) errFicha.push(`not measured ${fB.noMedido} ${JSON.stringify(fB.noMedidoItems)}`);
  if (JSON.stringify(fB.avisos) !== JSON.stringify(frasesNoUsados(rB, aB, corto))) errFicha.push(`not used ${JSON.stringify(fB.avisos)} ≠ ${JSON.stringify(frasesNoUsados(rB, aB, corto))}`);
  if (errFicha.length) falla(`biomarcadores card: ${errFicha.join('; ')}`);
  else ok(`biomarcadores card: ${fB.campanas.length} campaigns with source and quote, chips ${fB.chips.join(', ')} (own mapping), "${fB.ref}", ${fB.noMedido}, not-used lines: ${fB.avisos.join(' ') || 'none'}`);
  await pag.screenshot({ path: join(SALIDA, '01-biomarcadores-lugares.png') });
  await pag.click('#mision-ficha .campanas-caja summary');
  await pag.click('#mision-ficha ul.campanas > li details summary');
  await pag.click('#mision-ficha .no-medido-caja summary');
  await pag.waitForTimeout(150);
  await pag.screenshot({ path: join(SALIDA, '02-biomarcadores-ficha-abierta.png') });
  await revisarContraste(pag, 'mission box (open)', '#mision-caja');
  await revisarContraste(pag, 'per-place summary lines', '#lista .resumen');

  // Capa de similitud encendida antes de cambiar: leyenda y textura con el mapa de esta búsqueda.
  const capaB = await pag.evaluate(() => {
    const a = window.__az.analogos, cv = a.capaLienzo;
    const d = cv ? cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data : null;
    return { on: a.capa, min: document.getElementById('ley-min').textContent, max: document.getElementById('ley-max').textContent, oculta: document.getElementById('leyenda').hidden, px: d ? Array.from(d) : null };
  });
  const mmB = minMax(rB.mapa), mm0 = minMax(r0.mapa);
  const quieroPx = pintarMapa(rB.mapa, mmB.min, mmB.max, 205, M.tierra);
  let difMax = 0, alfaDistinto = 0;
  if (capaB.px) for (let i = 0; i < quieroPx.length; i += 4) {
    if ((capaB.px[i + 3] > 0) !== (quieroPx[i + 3] > 0)) alfaDistinto++;
    else if (quieroPx[i + 3] > 0) for (let c = 0; c < 3; c++) difMax = Math.max(difMax, Math.abs(capaB.px[i + c] - quieroPx[i + c]));
  }
  if (!capaB.on || capaB.oculta || capaB.min !== fmtPct(mmB.min) || capaB.max !== fmtPct(mmB.max) || !capaB.px || alfaDistinto || difMax > 3) falla(`similarity layer after the switch: ${JSON.stringify({ ...capaB, px: !!capaB.px })} alpha mismatches ${alfaDistinto}, max colour diff ${difMax}`);
  else ok(`similarity layer repainted: legend ${capaB.min} – ${capaB.max} (no mission: ${fmtPct(mm0.min)} – ${fmtPct(mm0.max)}), texture = pintarMapa of the node map (max colour diff ${difMax})`);
  await pag.screenshot({ path: join(SALIDA, '03-biomarcadores-capa.png') });
  await pag.click('label.interruptor:has(#capa)');
  await pag.waitForTimeout(200);

  await ver(pag, 'metricas');
  compararMetricas('biomarcadores Metrics place 1', await leerMetricas(pag), rB.resultados[0], 'NASA test site');
  const comoB = await pag.evaluate(() => [...document.querySelectorAll('#metricas .como p')].map((p) => p.textContent).at(-1));
  if (!/^Earth-only parameters \(.*\): the target is the Earth value at the test site/.test(comoB) || !/rock type: 0 % if the class is the same, 100 % if not \(own criterion\)/.test(comoB)) falla(`"How we measure" Earth-only line: ${comoB}`);
  else ok(`"How we measure": ${comoB}`);
  await pag.click('#metricas .comparar summary');
  await pag.waitForTimeout(150);
  const tabla = await pag.evaluate(() => [...document.querySelectorAll('#metricas .tabla-comparar tbody tr')].map((tr) => ({ id: tr.dataset.id, obj: tr.querySelector('td.objetivo').textContent })));
  const quieroTabla = rB.usados.map((id) => ({ id, obj: formatoValor(rB.resultados[0].parametros.find((p) => p.id === id).valor_objetivo, P[id].unidad, P[id]) + (P[id].solo_tierra ? 'NASA test site' : '') }));
  if (JSON.stringify(tabla) !== JSON.stringify(quieroTabla)) falla(`Compare rows: ${JSON.stringify(tabla)} ≠ ${JSON.stringify(quieroTabla)}`);
  else ok(`Compare: rows = parameters used (${tabla.map((t) => `${t.id} ${t.obj}`).join(' | ')})`);
  await pag.screenshot({ path: join(SALIDA, '04-biomarcadores-metrics.png') });
  await pag.$eval('#metricas .tabla-comparar', (e) => e.scrollIntoView({ block: 'center' }));
  await revisarContraste(pag, 'Metrics and Compare with a mission', '#metricas');

  await ver(pag, 'cartera');
  await quieta(pag);
  const cartB = await pag.evaluate(() => ({
    titular: document.getElementById('cartera-titular').textContent, lugares: [...document.querySelectorAll('#lista-cartera > .tarjeta')].map((t) => ({ letra: t.querySelector('.num').textContent, pct: t.querySelector('.pct span').textContent, chips: [...t.querySelectorAll('.chips li')].map((c) => c.dataset.id), resumen: t.querySelector('.resumen')?.textContent })),
    sinCubrir: [...document.querySelectorAll('#sin-cubrir li')].map((li) => li.dataset.id), letras: [...document.querySelectorAll('#numeros button.letra')].map((b) => b.textContent), como: document.querySelectorAll('#cartera-como p').length, h3: document.querySelectorAll('#sin-cubrir h3').length,
  }));
  const quieroCart = { titular: titularCartera(cB), lugares: cB.lugares.map((x, k) => ({ letra: letra(k), pct: fmtPct(x.similitud_pct), chips: x.cubre, resumen: lineaResumen(resumenLugar(x), corto) })), sinCubrir: cB.sin_cubrir.map((s) => s.id), letras: cB.lugares.map((_, k) => letra(k)), como: 4, h3: 1 };
  if (JSON.stringify(cartB) !== JSON.stringify(quieroCart)) falla(`Portfolio: ${JSON.stringify(cartB)} ≠ node ${JSON.stringify(quieroCart)}`);
  else ok(`Portfolio repainted: "${cartB.titular}" ${cartB.lugares.map((l) => `${l.letra} ${l.pct} [${l.chips.join(', ')}]`).join(' | ')}; uncovered: ${cartB.sinCubrir.join(', ') || 'none'}; globe letters ${cartB.letras.join('')}`);
  await pag.screenshot({ path: join(SALIDA, '05-biomarcadores-portfolio.png') });

  // ---------- b. Misión sin sitio de referencia ----------
  await elegirMision(pag, 'habitats_inflables');
  await quieta(pag);
  const aH = activaDeCatalogo(mision('habitats_inflables'), M.indice, SITIOS);
  const { r: rH } = nodo(aH);
  const fH = await leerFicha(pag);
  const estH = await pag.evaluate(() => ({ sinRef: window.__az.analogos.r.sin_referencia, pestana: document.getElementById('panel').dataset.pestana, sel: window.__az.analogos.sel, opcion: document.getElementById('mision').selectedOptions[0].textContent }));
  if (fH.ref !== 'No test site with coordinates: Earth-only parameters are not used.' || JSON.stringify(fH.avisos) !== JSON.stringify(frasesNoUsados(rH, aH, corto)) || !fH.avisos.length || JSON.stringify(estH.sinRef) !== JSON.stringify(rH.sin_referencia) || estH.opcion !== 'Inflatable habitat testing — Moon only') falla(`habitats_inflables: ${JSON.stringify({ ref: fH.ref, avisos: fH.avisos, estH })}`);
  else ok(`habitats_inflables (no coordinates): "${fH.ref}" · "${fH.avisos.join(' ')}" · option "${estH.opcion}"`);
  if (estH.pestana !== 'cartera' || estH.sel?.lista !== 'cartera') falla(`after switching on Portfolio the globe should show place A: ${JSON.stringify(estH)}`);
  await ver(pag, 'lugares');
  compararLugares('habitats_inflables places', await leerLugares(pag), rH.resultados, true);
  await ver(pag, 'metricas');
  const metH = await leerMetricas(pag);
  compararMetricas('habitats_inflables Metrics place 1', metH, rH.resultados[0], 'NASA test site');
  if (metH.some((f) => P[f.id].solo_tierra)) falla(`habitats_inflables: Earth-only row in Metrics ${metH.map((f) => f.id)}`);
  await ver(pag, 'lugares');
  await pag.screenshot({ path: join(SALIDA, '06-habitats-sin-referencia.png') });

  // ---------- c. Misión nueva ----------
  await elegirMision(pag, 'nueva');
  const f0 = await pag.evaluate(() => ({ form: !document.getElementById('mision-nueva').hidden, boton: document.getElementById('mision-buscar').disabled, mision: window.__az.analogos.mision, casillas: [...document.querySelectorAll('#mision-nueva input[type=checkbox]')].map((i) => i.value), punto: [...document.querySelectorAll('#nueva-punto input')].map((i) => i.value), tierra: [...document.querySelectorAll('#nueva-tierra input')].map((i) => i.value), sitios: [...document.querySelectorAll('#mision-ref option')].map((o) => o.value).filter(Boolean), leyenda: document.getElementById('nueva-punto-titulo').textContent }));
  const quieroPunto = M.indice.parametros.filter((p) => p.reproducible_en_tierra).map((p) => p.id), quieroTierra = M.indice.parametros_tierra.map((p) => p.id);
  const sitiosCon = SITIOS.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon)).map((s) => s.id);
  if (!f0.form || !f0.boton || f0.mision !== null || JSON.stringify(f0.punto) !== JSON.stringify(quieroPunto) || JSON.stringify(f0.tierra) !== JSON.stringify(quieroTierra) || JSON.stringify(f0.sitios) !== JSON.stringify(sitiosCon) || f0.leyenda !== 'Compared with your point on Mars') falla(`new mission form: ${JSON.stringify(f0)}`);
  else ok(`"New mission…": form open, search reset to all parameters, ${f0.punto.length} + ${f0.tierra.length} boxes, ${f0.sitios.length} test sites with coordinates, button disabled`);
  compararLugares('"New mission…" picked, before searching = no mission', await leerLugares(pag), r0.resultados, false);
  const elegidos = ['t_min_k', 'aridez_ai', 'elev_m'];
  for (const id of elegidos) await pag.check(`#mision-nueva input[value="${id}"]`);
  const sinTitulo = await pag.evaluate(() => ({ b: document.getElementById('mision-buscar').disabled, nota: !document.getElementById('nueva-ref-nota').hidden }));
  const TITULO = 'Dust <b>test</b> & rover';
  await pag.fill('#mision-titulo', TITULO);
  const conTitulo = await pag.evaluate(() => document.getElementById('mision-buscar').disabled);
  await pag.fill('#mision-titulo', '   ');
  const soloEspacios = await pag.evaluate(() => document.getElementById('mision-buscar').disabled);
  await pag.fill('#mision-titulo', TITULO);
  await pag.selectOption('#mision-ref', 'mdrs_utah');
  const notaFuera = await pag.evaluate(() => document.getElementById('nueva-ref-nota').hidden);
  if (!sinTitulo.b || !sinTitulo.nota || conTitulo || !soloEspacios || !notaFuera) falla(`new mission button/note: ${JSON.stringify({ sinTitulo, conTitulo, soloEspacios, notaFuera })}`);
  else ok('new mission: button off without a title (and with only spaces), on with title + 3 parameters; "Pick a test site" note until a site is picked');
  await pag.screenshot({ path: join(SALIDA, '07-nueva-formulario.png') });
  await revisarContraste(pag, 'new mission form', '#mision-nueva');
  await pag.click('#mision-buscar');
  await pag.waitForTimeout(150);
  await quieta(pag);
  const aN = activaNueva({ titulo: TITULO, parametros: elegidos, ref: 'mdrs_utah' }, M.indice, SITIOS);
  const { r: rN } = nodo(aN);
  compararLugares('new mission places', await leerLugares(pag), rN.resultados, true);
  const fN = await leerFicha(pag);
  const urlN = await pag.evaluate(() => location.href);
  const qN = new URL(urlN).searchParams;
  const sitioN = SITIOS.find((s) => s.id === 'mdrs_utah');
  if (fN.titulo !== TITULO || fN.tituloHtml !== 'Dust &lt;b&gt;test&lt;/b&gt; &amp; rover' || JSON.stringify(fN.chips) !== JSON.stringify(aN.parametros) || fN.propio.length || fN.ref !== `Earth-only parameters are compared with the test site you picked: ${sitioN.nombre} (${formatoLatLon(sitioN.lat, sitioN.lon).texto})`) falla(`new mission card: ${JSON.stringify(fN)}`);
  else ok(`new mission card: title as text "${fN.titulo}", chips ${fN.chips.join(', ')}, "${fN.ref}"`);
  if (qN.get('mision') !== 'nueva' || qN.get('titulo') !== TITULO || qN.get('p') !== aN.parametros.join(',') || qN.get('ref') !== 'mdrs_utah' || qN.get('mundo') !== 'mars') falla(`new mission URL ${urlN}`);
  else ok(`new mission URL: ${new URL(urlN).search}`);
  await ver(pag, 'metricas');
  compararMetricas('new mission Metrics place 1', await leerMetricas(pag), rN.resultados[0], 'Test site');
  await ver(pag, 'lugares');
  await pag.screenshot({ path: join(SALIDA, '08-nueva-resultado.png') });
  await pag.context().close();

  // ---------- d. Recargar la URL reproduce el estado ----------
  const pr = await pagina(1440, 900, 'reload');
  await abrir(pr, new URL(urlN).pathname + new URL(urlN).search);
  await quieta(pr);
  const est = await pr.evaluate(() => ({ valor: document.getElementById('mision').value, form: document.getElementById('mision-nueva').hidden, titulo: document.getElementById('mision-titulo').value, ref: document.getElementById('mision-ref').value, marcadas: [...document.querySelectorAll('#mision-nueva input:checked')].map((i) => i.value) }));
  if (est.valor !== 'nueva' || !est.form || est.titulo !== TITULO || est.ref !== 'mdrs_utah' || JSON.stringify(est.marcadas) !== JSON.stringify(aN.parametros)) falla(`reload new mission: ${JSON.stringify(est)}`);
  else ok('reload of the new-mission URL: selector on "New mission…", form folded and filled in, same title, boxes and site');
  compararLugares('reload new mission places', await leerLugares(pr), rN.resultados, true);
  const fR = await leerFicha(pr);
  if (fR.titulo !== TITULO || fR.ref !== fN.ref) falla(`reload new mission card: ${JSON.stringify(fR)}`);
  await pr.screenshot({ path: join(SALIDA, '09-recarga-nueva.png') });
  await pr.click('#mision-cambiar');
  if (await pr.evaluate(() => document.getElementById('mision-nueva').hidden)) falla('"Change this mission" should open the form'); else ok('"Change this mission" opens the filled-in form');
  await abrir(pr, `${URL_J}&mision=biomarcadores`);
  await quieta(pr);
  compararLugares('reload ?mision=biomarcadores places', await leerLugares(pr), rB.resultados, true);
  await abrir(pr, `${URL_J}&mision=no_existe`);
  const desc = await pr.evaluate(() => ({ valor: document.getElementById('mision').value, mision: window.__az.analogos.mision, ficha: document.getElementById('mision-ficha').hidden }));
  if (desc.valor !== '' || desc.mision !== null || !desc.ficha) falla(`unknown mission id: ${JSON.stringify(desc)}`); else ok('?mision=no_existe → no mission, no error');
  compararLugares('unknown mission id places', await leerLugares(pr), r0.resultados, false);

  // ---------- e. Volver a «All parameters» ----------
  await abrir(pr, `${URL_J}&mision=biomarcadores`);
  await quieta(pr);
  await elegirMision(pr, '');
  await quieta(pr);
  const vuelta = await leerLugares(pr);
  const estE = await pr.evaluate(() => ({ url: location.search, avanzado: document.getElementById('avanzado').hidden, ficha: document.getElementById('mision-ficha').hidden, resumenes: document.querySelectorAll('.tarjeta .resumen').length }));
  if (JSON.stringify(vuelta) !== JSON.stringify(lista0) || estE.url !== `?mundo=mars&lat=${J.lat}&lon=${J.lon}&nombre=Jezero` || estE.avanzado || !estE.ficha || estE.resumenes) falla(`back to all parameters: ${JSON.stringify({ vuelta, estE })}`);
  else ok(`back to "All parameters": same ${vuelta.length} cards as at the start, no summary lines, "Advanced" back, URL ${estE.url}`);
  await pr.screenshot({ path: join(SALIDA, '10-vuelta-todos.png') });
  await pr.context().close();

  // ---------- Terreno abierto: cambiar de misión lo cierra ----------
  const pt = await pagina(1440, 900, 'terrain open');
  await redSintetica(pt);
  await abrir(pt, URL_J);
  await quieta(pt);
  await pt.click('#ver-relieve');
  await esperarQue(pt, () => ['abierto', 'error'].includes(window.__az?.relieve?.estado), 'the terrain view to open or fail', 60000);
  const antesT = await pt.evaluate(() => ({ estado: window.__az.relieve.estado, mensaje: window.__az.relieve.mensaje, capa: !!document.querySelector('.relieve-capa') }));
  await pt.screenshot({ path: join(SALIDA, '14-terreno-abierto.png') });
  await elegirMision(pt, 'biomarcadores');
  await pt.waitForTimeout(400);
  const trasT = await pt.evaluate(() => ({ estado: window.__az.relieve.estado, capa: !!document.querySelector('.relieve-capa.visible'), mision: window.__az.analogos.mision?.id }));
  if (antesT.estado !== 'abierto' || !antesT.capa || trasT.estado !== 'cerrado' || trasT.capa || trasT.mision !== 'biomarcadores') falla(`terrain view and mission switch: before ${JSON.stringify(antesT)} after ${JSON.stringify(trasT)}`);
  else ok('terrain view open (synthetic tiles) → picking a mission closes it and repaints');
  await pt.screenshot({ path: join(SALIDA, '15-terreno-cerrado-tras-mision.png') });
  await pt.context().close();

  // ---------- f. Móvil ----------
  const mv = await pagina(390, 844, 'mobile', { isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const fuera = () => mv.evaluate(() => {
    const malos = [];
    for (const e of document.querySelectorAll('#panel, #mision-caja, #mision-caja *, #lista .tarjeta, #lista .tarjeta *')) {
      if (e.closest('[hidden]') || !e.getClientRects().length) continue;
      const r = e.getBoundingClientRect();
      if (r.left < -0.5 || r.right > innerWidth + 0.5) malos.push(`${e.id || e.className || e.tagName} x ${r.left.toFixed(0)}–${r.right.toFixed(0)}`);
    }
    if (document.documentElement.scrollWidth > innerWidth) malos.push(`page ${document.documentElement.scrollWidth} px wide`);
    return malos;
  });
  await abrir(mv, `${URL_J}&mision=biomarcadores`);
  await quieta(mv);
  await mv.tap('#mision-ficha .campanas-caja summary');
  await mv.waitForTimeout(150);
  let malos = await fuera();
  if (malos.length) falla(`mobile mission card: ${malos.join('; ')}`); else ok('mobile 390×844, biomarcadores: selector, card and cards inside the screen');
  await mv.screenshot({ path: join(SALIDA, '11-movil-ficha.png') });
  await mv.$eval('#lista', (e) => e.scrollIntoView({ block: 'start' }));
  await mv.screenshot({ path: join(SALIDA, '12-movil-lugares.png') });
  await elegirMision(mv, 'nueva');
  await mv.$eval('#mision-nueva', (e) => e.scrollIntoView({ block: 'start' }));
  malos = await fuera();
  if (malos.length) falla(`mobile new mission form: ${malos.join('; ')}`); else ok('mobile "New mission…" form inside the screen');
  await mv.screenshot({ path: join(SALIDA, '13-movil-nueva.png') });
  await mv.context().close();
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA_MISIONES: ${fallos.length} failure(s)` : 'CAPTURA_MISIONES: ok');
process.exit(fallos.length ? 1 : 0);

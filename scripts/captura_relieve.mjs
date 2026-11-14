// Vista de terreno local (web/relieve/) en Chromium: (a) Tierra con teselas sintéticas interceptadas → altitud = node;
// (b) sin red → aviso y el globo sigue; (c) humo en vivo (SKIPPED si no hay red); (d) Marte y Luna desde los ficheros
// propios → altitud = node; (e) móvil; (f) consola limpia. Uso: node scripts/captura_relieve.mjs [--sin-vivo]
import { createServer } from 'node:http';
import { readFile, mkdir, stat, open } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import {
  ORIGENES_EXTERNOS, MENSAJES, N_REJILLA, LADO_KM, R_TIERRA_M, zoomPara, rejillaLocal, teselasVentana, muestraMercator,
  muestraEquirect, filasEquirect, muestraPolo, filasPolo, leerI16, remuestrear, estadisticas, formatoMetros, fuenteRelieve,
} from '../web/relieve/calculo.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'relieve');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const SIN_VIVO = process.argv.includes('--sin-vivo');

const fallos = [];
const falla = (m) => { fallos.push(m); console.error(`FAIL ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);

// ---------- Teselas sintéticas ----------
function png(ancho, alto, rgb) {
  const crudo = Buffer.alloc((ancho * 3 + 1) * alto);
  for (let j = 0; j < alto; j++) { crudo[j * (ancho * 3 + 1)] = 0; rgb.copy(crudo, j * (ancho * 3 + 1) + 1, j * ancho * 3, (j + 1) * ancho * 3); }
  const trozo = (tipo, datos) => {
    const t = Buffer.from(tipo, 'latin1'), l = Buffer.alloc(4), c = Buffer.alloc(4);
    l.writeUInt32BE(datos.length); c.writeUInt32BE(crc32(Buffer.concat([t, datos])) >>> 0);
    return Buffer.concat([l, t, datos, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))]);
}
const latLonDePixel = (z, px, py) => {
  const X = px / (256 * 2 ** z), Y = py / (256 * 2 ** z);
  return { lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))) * 180) / Math.PI, lon: X * 360 - 180 };
};
// Relieve sintético global (ondas de ~100 km y una pendiente norte-sur), en metros.
const alturaSintetica = (lat, lon) => 1500 + 1200 * Math.sin((lat * 2 * Math.PI) / 0.9) * Math.cos((lon * 2 * Math.PI) / 1.1) + 20 * lat;
function teselaTerrarium(z, x, y) {
  const rgb = Buffer.alloc(256 * 256 * 3), dec = new Float32Array(256 * 256);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const p = latLonDePixel(z, x * 256 + i + 0.5, y * 256 + j + 0.5);
    const h = alturaSintetica(p.lat, p.lon) + 32768, k = j * 256 + i;
    const r = Math.floor(h / 256), g = Math.floor(h - r * 256), b = Math.floor((h - Math.floor(h)) * 256);
    rgb[3 * k] = r; rgb[3 * k + 1] = g; rgb[3 * k + 2] = b;
    dec[k] = r * 256 + g + b / 256 - 32768;
  }
  return { png: png(256, 256, rgb), dec };
}
function teselaImagen(z, x, y) {
  const rgb = Buffer.alloc(256 * 256 * 3);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const k = j * 256 + i, p = latLonDePixel(z, x * 256 + i + 0.5, y * 256 + j + 0.5);
    rgb[3 * k] = 150 + 60 * Math.sin(p.lat * 7); rgb[3 * k + 1] = 120 + 40 * Math.cos(p.lon * 5); rgb[3 * k + 2] = 90;
  }
  return png(256, 256, rgb);
}
const cacheT = new Map();
const terrarium = (z, x, y) => { const k = `${z}/${x}/${y}`; if (!cacheT.has(k)) cacheT.set(k, teselaTerrarium(z, x, y)); return cacheT.get(k); };

function esperadoTierra(lat, lon) {
  const g = rejillaLocal(lat, lon, LADO_KM * 1000, N_REJILLA, R_TIERRA_M);
  const z = zoomPara(lat, g.paso, 15), v = teselasVentana(g, z);
  const m = new Map(v.lista.map((t) => [`${t.x}/${t.y}`, terrarium(z, t.x, t.y).dec]));
  const zz = remuestrear((la, lo) => muestraMercator(v, m, z, la, lo), g);
  return { ...estadisticas(zz, N_REJILLA), z, teselas: v.lista.length };
}

// ---------- Referencia en node desde los ficheros de web/data ----------
const IDX = JSON.parse(readFileSync(join(WEB, 'data/relieve/indice.json'), 'utf8'));
const POLO = JSON.parse(readFileSync(join(WEB, 'data/terreno/polo_sur/meta.json'), 'utf8'));
async function leerFilas(ruta, bytesFila, f0, f1) {
  const fh = await open(ruta, 'r');
  const b = Buffer.alloc((f1 - f0) * bytesFila);
  await fh.read(b, 0, b.length, f0 * bytesFila);
  await fh.close();
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
async function esperadoPropio(mundo, lat, lon) {
  const f = fuenteRelieve(mundo, lat, lon, LADO_KM * 1000, mundo === 'moon' ? POLO : null);
  if (f.tipo === 'polo_sur') {
    const g = rejillaLocal(lat, lon, f.lado_m, N_REJILLA, POLO.georef.radio_m);
    const { f0, f1 } = filasPolo(g, POLO);
    const buf = await leerFilas(join(WEB, 'data/terreno/polo_sur', POLO.capas.altura.fichero), POLO.n * 4, f0, f1);
    const datos = new Float32Array(buf);
    return { fuente: f.tipo, ...estadisticas(remuestrear((la, lo) => muestraPolo({ n: POLO.n, fila0: f0, filas: f1 - f0, datos }, POLO, la, lo), g), N_REJILLA), punto: muestraPolo({ n: POLO.n, fila0: f0, filas: f1 - f0, datos }, POLO, lat, lon) };
  }
  const m = IDX.mundos[mundo];
  const g = rejillaLocal(lat, lon, LADO_KM * 1000, N_REJILLA, m.radio_m);
  const { f0, f1 } = filasEquirect(g, m.ppd, m.alto);
  const datos = leerI16(await leerFilas(join(WEB, 'data/relieve', m.fichero), m.ancho * 2, f0, f1), m.factor_m);
  const mm = { ancho: m.ancho, alto: m.alto, ppd: m.ppd, fila0: f0, filas: f1 - f0, datos };
  return { fuente: f.tipo, ...estadisticas(remuestrear((la, lo) => muestraEquirect(mm, la, lo), g), N_REJILLA), punto: muestraEquirect(mm, lat, lon) };
}

// ---------- Servidor (con Range, que se puede apagar para imitar python -m http.server) ----------
let conRange = true;
const pedidosRange = { con: 0, sin: 0 };
const servidor = createServer(async (req, res) => {
  const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (ruta === '/relieve/_prueba.html') { res.writeHead(200, { 'content-type': 'text/html' }).end(PRUEBA); return; }
  const f = join(WEB, ruta.endsWith('/') ? `${ruta}index.html` : ruta);
  if (!f.startsWith(WEB)) { res.writeHead(403).end(); return; }
  try {
    const rg = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    if (rg && conRange) {
      const total = (await stat(f)).size, a = Number(rg[1]), b = Math.min(total - 1, Number(rg[2]));
      const buf = Buffer.from(await leerFilas(f, 1, a, b + 1));
      pedidosRange.con++;
      res.writeHead(206, { 'content-type': 'application/octet-stream', 'content-range': `bytes ${a}-${b}/${total}`, 'content-length': buf.length }).end(buf);
      return;
    }
    if (req.headers.range) pedidosRange.sin++;
    const b = await readFile(f);
    res.writeHead(200, { 'content-type': TIPOS[extname(f)] ?? 'application/octet-stream' }).end(b);
  } catch { res.writeHead(404).end(); }
});
// Página mínima de prueba (solo existe en este servidor): botón + módulo, sin el resto de la web.
const PRUEBA = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="../marca/marca.css"><script type="importmap">{ "imports": { "three": "../lib/three/three.module.js", "three/addons/": "../lib/three/addons/" } }</script></head>
<body class="marca-fondo marca-cuerpo"><button type="button" class="marca-boton" id="ver-relieve">See the terrain</button><p id="relieve-aviso" role="status" hidden></p>
<script type="module">import { engancharRelieve } from './enganche.js';
const q = new URLSearchParams(location.search);
engancharRelieve({ boton: document.getElementById('ver-relieve'), aviso: document.getElementById('relieve-aviso'), mundo: q.get('mundo'),
  punto: () => ({ lat: Number(q.get('lat')), lon: Number(q.get('lon')), titulo: q.get('titulo') ?? 'Test point' }) });
window.__az.prueba = true;</script></body></html>`;
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${servidor.address().port}`;
await mkdir(SALIDA, { recursive: true });
const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });

const externos = [];
async function pagina(ancho, alto, etiqueta, { red = 'sintetica', movil = false, tolerarRed = false } = {}) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: alto }, ...(movil ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const pag = await ctx.newPage();
  const cuenta = { teselas: 0, bytes: 0, otros: [] };
  pag.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (tolerarRed && /Failed to load resource|net::ERR_/.test(m.text())) return;
    falla(`console ${m.type()} (${etiqueta}): ${m.text()}`);
  });
  pag.on('pageerror', (e) => falla(`page error (${etiqueta}): ${e.message}`));
  pag.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(baseUrl) || u.startsWith('data:') || u.startsWith('blob:')) return;
    if (!ORIGENES_EXTERNOS.some((o) => u.startsWith(`${o}/`))) cuenta.otros.push(u);
    const h = r.headers();
    if (h.cookie || h.referer) falla(`${etiqueta}: outside request carries cookie/referer: ${u}`);
    externos.push(u);
  });
  if (red === 'sintetica') {
    await pag.route(`${ORIGENES_EXTERNOS[0]}/**`, (route) => {
      const m = /\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(route.request().url());
      if (!m) return route.abort();
      const b = terrarium(+m[1], +m[2], +m[3]).png;
      cuenta.teselas++; cuenta.bytes += b.length;
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: b });
    });
    await pag.route(`${ORIGENES_EXTERNOS[1]}/**`, (route) => {
      const m = /\/(\d+)\/(\d+)\/(\d+)\.jpeg$/.exec(route.request().url());
      if (!m) return route.abort();
      const b = teselaImagen(+m[1], +m[3], +m[2]);
      cuenta.teselas++; cuenta.bytes += b.length;
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: b });
    });
  } else if (red === 'cortada') {
    for (const o of ORIGENES_EXTERNOS) await pag.route(`${o}/**`, (route) => route.abort('internetdisconnected'));
  } else {
    pag.on('response', async (r) => { if (ORIGENES_EXTERNOS.some((o) => r.url().startsWith(o))) { cuenta.teselas++; cuenta.bytes += Number(r.headers()['content-length'] ?? 0); } });
  }
  return { pag, ctx, cuenta };
}
async function esperarQue(pag, f, que, ms = 30000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await pag.evaluate(f, arg)) return; await pag.waitForTimeout(100); }
  throw new Error(`timeout waiting for ${que}`);
}
const estadoRelieve = (pag) => pag.evaluate(() => window.__az?.relieve?.estado ?? null);
// boton = null: la vista se abre sola (resultados, tras pulsar un lugar).
async function abrirVista(pag, boton, ms = 60000) {
  if (boton) await pag.click(boton);
  await esperarQue(pag, () => ['abierto', 'error'].includes(window.__az?.relieve?.estado), 'the terrain view to open or fail', ms);
  if ((await estadoRelieve(pag)) === 'abierto') await esperarQue(pag, () => window.__az.relieve.dibujos > 0 && document.querySelector('.relieve-capa.visible'), 'the first frame', 20000);
  await pag.waitForTimeout(400);
  return pag.evaluate(() => ({
    estado: window.__az.relieve.estado, mensaje: window.__az.relieve.mensaje, causa: window.__az.relieve.causa,
    fuente: window.__az.relieve.fuente, exag: window.__az.relieve.exag, bytes: window.__az.relieve.descarga_bytes, teselas: window.__az.relieve.teselas, lado_m: window.__az.relieve.lado_m,
    titulo: document.querySelector('.relieve-titulo')?.textContent ?? null,
    altitud: document.querySelector('.relieve [data-v=altitud]')?.textContent ?? null,
    desnivel: document.querySelector('.relieve [data-v=desnivel]')?.textContent ?? null,
    fuenteTexto: document.querySelector('.relieve-fuente')?.textContent ?? null,
    exagTexto: document.querySelector('.relieve-exag output')?.textContent ?? null,
    imagen: document.querySelector('.relieve-imagen')?.textContent ?? null,
    creditos: [...document.querySelectorAll('.relieve-creditos p')].map((p) => p.textContent),
    escala: document.querySelector('.relieve-escala .marca-num')?.textContent ?? null,
    aviso: document.getElementById('relieve-aviso')?.hidden === false ? document.getElementById('relieve-aviso').textContent : null,
  }));
}
async function cerrarVista(pag, que) {
  await pag.click('.relieve-volver');
  await pag.waitForTimeout(200);
  const r = await pag.evaluate(() => ({ estado: window.__az.relieve.estado, capa: !!document.querySelector('.relieve-capa'), canvas: document.querySelectorAll('canvas').length }));
  if (r.estado !== 'cerrado' || r.capa) falla(`${que}: Back to globe should remove the view (${JSON.stringify(r)})`);
  else ok(`${que}: "Back to globe" closes the view`);
}

// Dibujo bajo demanda: quieto no dibuja; al arrastrar, sí.
async function soloAlCambiar(pag, que) {
  const a = await pag.evaluate(() => window.__az.relieve.dibujos);
  await pag.waitForTimeout(1200);
  const b = await pag.evaluate(() => window.__az.relieve.dibujos);
  const c = await pag.evaluate(() => { const r = document.querySelector('.relieve-lienzo').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.6 }; });
  await pag.mouse.move(c.x, c.y); await pag.mouse.down(); await pag.mouse.move(c.x + 120, c.y - 30, { steps: 6 }); await pag.mouse.up();
  await pag.waitForTimeout(300);
  const d = await pag.evaluate(() => window.__az.relieve.dibujos);
  if (b !== a || d <= b) falla(`${que}: draws should happen only on change (idle ${a}→${b}, after drag ${d})`);
  else ok(`${que}: idle 1.2 s = 0 new frames; a drag drew ${d - b}`);
}

function comprobarEsperado(que, v, esp) {
  if (v.estado !== 'abierto') { falla(`${que}: view did not open (${v.mensaje}; ${v.causa})`); return false; }
  const q = { altitud: formatoMetros(esp.centro), desnivel: formatoMetros(esp.desnivel) };
  if (v.altitud !== q.altitud || v.desnivel !== q.desnivel) { falla(`${que}: screen ${v.altitud} / ${v.desnivel} ≠ node ${q.altitud} / ${q.desnivel}`); return false; }
  ok(`${que}: elevation at the pin ${v.altitud}, relief ${v.desnivel} = node; ${v.exagTexto}; scale ${v.escala}; "${v.fuenteTexto}"`);
  return true;
}

try {
  // ---------- (d) Marte y Luna desde los ficheros propios ----------
  const casos = [
    ['mars', 18.38, 77.58, 'Jezero', 'd-marte-jezero'],
    ['moon', -89.68643, -162.9371, 'Shackleton rim', 'd-luna-shackleton'],
    ['moon', 8.3355, 33.222, 'Mare Tranquillitatis', 'd-luna-tranquillitatis'],
  ];
  for (const [mundo, lat, lon, nombre, fichero] of casos) {
    const { pag, ctx, cuenta } = await pagina(1280, 800, nombre);
    await pag.goto(`${baseUrl}/relieve/_prueba.html?mundo=${mundo}&lat=${lat}&lon=${lon}&titulo=${encodeURIComponent(nombre)}`);
    await pag.waitForFunction(() => window.__az?.prueba === true);
    const v = await abrirVista(pag, '#ver-relieve');
    const esp = await esperadoPropio(mundo, lat, lon);
    if (Math.abs(esp.centro - esp.punto) > 1e-3) falla(`${nombre}: centre node ${esp.centro} ≠ direct sample ${esp.punto}`);
    if (v.fuente !== esp.fuente) falla(`${nombre}: source ${v.fuente} ≠ ${esp.fuente}`);
    if (comprobarEsperado(`${nombre} (${v.fuente}, ${(v.bytes / 1e6).toFixed(2)} MB read)`, v, esp) && cuenta.otros.length + cuenta.teselas) falla(`${nombre}: outside requests ${cuenta.otros.join(' ')}`);
    await pag.screenshot({ path: join(SALIDA, `${fichero}.png`) });
    if (fichero === 'd-marte-jezero') {
      await soloAlCambiar(pag, nombre);
      await pag.locator('.relieve-exag input').fill('5');
      await pag.waitForTimeout(300);
      const e = await pag.evaluate(() => ({ exag: window.__az.relieve.exag, txt: document.querySelector('.relieve-exag output').textContent }));
      if (e.exag !== 5 || e.txt !== 'vertical ×5') falla(`exaggeration slider: ${JSON.stringify(e)}`); else ok('slider to ×5 → "vertical ×5"');
      await pag.screenshot({ path: join(SALIDA, 'd-marte-jezero-x5.png') });
    }
    await cerrarVista(pag, nombre);
    await ctx.close();
  }
  // Sin Range (como python -m http.server): mismo resultado leyendo el fichero entero.
  {
    conRange = false;
    const { pag, ctx } = await pagina(1280, 800, 'no Range');
    await pag.goto(`${baseUrl}/relieve/_prueba.html?mundo=moon&lat=8.3355&lon=33.222`);
    await pag.waitForFunction(() => window.__az?.prueba === true);
    const v = await abrirVista(pag, '#ver-relieve');
    comprobarEsperado('Tranquillitatis with a server without Range', v, await esperadoPropio('moon', 8.3355, 33.222));
    await ctx.close();
    conRange = true;
  }
  // Sin terreno cerca de los polos
  for (const [mundo, lat, lon, msg] of [['mars', 87, 0, MENSAJES.sinRelievePolo], ['moon', 88, 10, MENSAJES.sinRelievePolo], ['earth', 85, 10, MENSAJES.sinTeselasPolo]]) {
    const { pag, ctx } = await pagina(1280, 800, `pole ${mundo}`);
    await pag.goto(`${baseUrl}/relieve/_prueba.html?mundo=${mundo}&lat=${lat}&lon=${lon}`);
    await pag.waitForFunction(() => window.__az?.prueba === true);
    const v = await abrirVista(pag, '#ver-relieve');
    if (v.estado !== 'error' || v.aviso !== msg) falla(`${mundo} ${lat}: expected "${msg}", got ${JSON.stringify(v)}`); else ok(`${mundo} at ${lat}°: "${v.aviso}"`);
    await ctx.close();
  }

  // ---------- (c) humo en vivo ----------
  if (SIN_VIVO) console.log('SKIPPED live smoke test (--sin-vivo)');
  else {
    const { pag, ctx, cuenta } = await pagina(1280, 800, 'live', { red: 'real', tolerarRed: true });
    await pag.goto(`${baseUrl}/relieve/_prueba.html?mundo=earth&lat=38.25&lon=90.25&titulo=${encodeURIComponent('38.25° N, 90.25° E (live)')}`);
    await pag.waitForFunction(() => window.__az?.prueba === true);
    const v = await abrirVista(pag, '#ver-relieve', 90000);
    if (v.estado === 'error' && v.mensaje === MENSAJES.sinRed) console.log(`SKIPPED (no network): ${v.causa}`);
    else if (v.estado !== 'abierto') falla(`live: ${JSON.stringify(v)}`);
    else {
      ok(`live 38.25 N 90.25 E: elevation ${v.altitud}, relief ${v.desnivel}; ${v.exagTexto}; tiles ${JSON.stringify(v.teselas)}, ${(v.bytes / 1024).toFixed(0)} KiB downloaded`);
      if (cuenta.otros.length) falla(`live: requests outside the two origins: ${cuenta.otros.join(' ')}`);
      await pag.screenshot({ path: join(SALIDA, 'c-vivo-38N-90E.png') });
    }
    await ctx.close();
  }

  // ---------- (a) resultados en la Tierra con teselas sintéticas ----------
  const URL_JEZERO = `${baseUrl}/analogos/index.html?mundo=mars&lat=18.38&lon=77.58&nombre=Jezero`;
  const listoAnalogos = (pag) => pag.waitForFunction(() => window.__az?.analogos?.listo === true, null, { timeout: 120000 });
  const quietoGlobo = (pag) => esperarQue(pag, () => !window.__az.analogos.vista.animando(), 'the globe to stop', 20000);
  {
    const { pag, ctx, cuenta } = await pagina(1440, 900, 'results desktop');
    await pag.goto(URL_JEZERO);
    await listoAnalogos(pag);
    await quietoGlobo(pag);
    const d0 = await pag.evaluate(() => window.__az.analogos.vista.camara.position.length());
    await pag.click('#lista > .tarjeta[data-k="1"]');
    await pag.waitForTimeout(100);
    await quietoGlobo(pag);
    const sel = await pag.evaluate(() => ({ x: window.__az.analogos.r.resultados[1], d: window.__az.analogos.vista.camara.position.length(), boton: !document.getElementById('ver-relieve').hidden }));
    if (!(sel.d < d0 - 0.05) || !sel.boton) falla(`clicking place 2 should bring the globe closer and show "See the terrain" (distance ${d0.toFixed(2)} → ${sel.d.toFixed(2)}, button ${sel.boton})`);
    else ok(`click on place 2: globe closer (${d0.toFixed(2)} → ${sel.d.toFixed(2)} radii), "See the terrain" shown`);
    const x = sel.x, f = fuenteRelieve('earth', x.lat, x.lon, LADO_KM * 1000);
    const v = await abrirVista(pag, null);
    const auto = await pag.evaluate(() => { const c = document.querySelector('.relieve-capa')?.getBoundingClientRect(), p = document.getElementById('panel').getBoundingClientRect(); return { auto: window.__az.analogos.terrenoAuto, capa: c ? Math.round(c.right) : null, panel: Math.round(p.left), tarjeta: !!document.elementFromPoint(p.left + p.width / 2, p.top + p.height / 2)?.closest('#panel') }; });
    if (f.tipo && (auto.auto !== 'abierto' || auto.capa !== auto.panel || !auto.tarjeta)) falla(`clicking place 2 should open its terrain by itself beside the panel: ${JSON.stringify(auto)}`);
    else if (f.tipo) ok(`the terrain of place 2 opens by itself after the globe stops, beside the panel (view ends at ${auto.capa} px = panel left)`);
    const sim = await pag.evaluate(() => { const b = document.querySelector('.relieve-accion'); return b ? { texto: b.textContent, href: b.getAttribute('href') } : null; });
    const qSim = new URLSearchParams((sim?.href ?? '').split('?')[1] ?? '');
    if (f.tipo && (sim?.texto !== 'Generate simulation' || !sim.href.startsWith('../terreno/index.html?') || qSim.get('lugar') !== `${x.lat.toFixed(4)},${x.lon.toFixed(4)}` || qSim.get('solo') !== 'lugar')) falla(`"Generate simulation" in the terrain view: ${JSON.stringify(sim)}`);
    else if (f.tipo) ok(`"Generate simulation" in the terrain view → ${sim.href}`);
    if (!f.tipo) {
      if (v.aviso !== f.mensaje) falla(`place 2 at ${x.lat}: expected "${f.mensaje}", got ${JSON.stringify(v)}`); else ok(`place 2 at ${x.lat}°: "${v.aviso}"`);
    } else {
      const esp = esperadoTierra(x.lat, x.lon);
      const titulo = `Place 2 · ${(await import('../web/explorar/geo.js')).formatoLatLon(x.lat, x.lon).texto}`;
      if (v.titulo !== titulo) falla(`title "${v.titulo}" ≠ "${titulo}"`);
      comprobarEsperado(`results place 2 (${x.lat}, ${x.lon}), synthetic tiles z${esp.z} ×${esp.teselas}`, v, esp);
      const celda = await pag.evaluate(() => document.querySelector('.relieve-celda')?.textContent ?? null);
      if (celda !== 'Outline: the 0.5° cell we compared') falla(`cell legend: ${celda}`);
      if (!v.creditos.some((c) => c.startsWith('Imagery: NASA GIBS') && c.includes("We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS)")) || !v.creditos.some((c) => c.startsWith('Elevation: Terrain Tiles (Mapzen'))) falla(`credits: ${JSON.stringify(v.creditos)}`);
      else ok('credits on screen: NASA GIBS acknowledgement + Terrain Tiles attribution');
      if (cuenta.otros.length) falla(`requests outside the two origins: ${cuenta.otros.join(' ')}`);
      ok(`synthetic tiles served: ${cuenta.teselas} (${(cuenta.bytes / 1024).toFixed(0)} KiB)`);
      await pag.screenshot({ path: join(SALIDA, 'a-resultados-terreno.png') });
      await soloAlCambiar(pag, 'results view');
      await cerrarVista(pag, 'results');
      const g = await pag.evaluate(() => ({ visible: getComputedStyle(document.getElementById('globo')).display !== 'none', foco: document.activeElement?.id }));
      if (!g.visible || g.foco !== 'ver-relieve') falla(`after closing: ${JSON.stringify(g)}`); else ok('back on the globe, focus on "See the terrain"');
      await pag.screenshot({ path: join(SALIDA, 'a-resultados-vuelta.png') });
    }
    await ctx.close();
  }

  // ---------- (b) sin red: aviso y el globo sigue ----------
  {
    const { pag, ctx } = await pagina(1440, 900, 'results offline', { red: 'cortada', tolerarRed: true });
    await pag.goto(URL_JEZERO);
    await listoAnalogos(pag);
    const v = await abrirVista(pag, '#ver-relieve');
    const r = await pag.evaluate(() => ({ capa: !!document.querySelector('.relieve-capa'), globo: getComputedStyle(document.getElementById('globo')).display !== 'none', listo: window.__az.analogos.listo }));
    if (v.estado !== 'error' || v.aviso !== MENSAJES.sinRed || r.capa || !r.globo) falla(`offline: ${JSON.stringify({ v, r })}`);
    else ok(`offline: "${v.aviso}", no view, globe still there`);
    await pag.screenshot({ path: join(SALIDA, 'b-sin-red.png') });
    await ctx.close();
  }

  // ---------- (e) móvil ----------
  {
    const { pag, ctx } = await pagina(390, 844, 'results mobile', { movil: true });
    await pag.goto(URL_JEZERO);
    await listoAnalogos(pag);
    await pag.screenshot({ path: join(SALIDA, 'e-movil-globo.png') });
    const v = await abrirVista(pag, '#ver-relieve');
    if (v.estado !== 'abierto') falla(`mobile: ${JSON.stringify(v)}`);
    const caja = await pag.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
      return { ancho: document.documentElement.scrollWidth, cab: r('.relieve-cabecera'), pie: r('.relieve-pie'), volver: r('.relieve-volver'), barra: r('.marca-barra') };
    });
    const dentro = (b) => b.l >= 0 && b.r <= 390 && b.t >= 0 && b.b <= 844;
    if (caja.ancho > 390 || !dentro(caja.cab) || !dentro(caja.pie) || caja.cab.b > caja.pie.t || caja.volver.t < caja.barra.b) falla(`mobile layout: ${JSON.stringify(caja)}`);
    else ok(`mobile 390 px: header ${Math.round(caja.cab.b - caja.cab.t)} px, controls+credits ${Math.round(caja.pie.b - caja.pie.t)} px, ${Math.round(caja.pie.t - caja.cab.b)} px of terrain between them`);
    await pag.screenshot({ path: join(SALIDA, 'e-movil-terreno.png') });
    await ctx.close();
  }

  // ---------- explorar: chincheta en la Luna → «See the terrain here» ----------
  {
    const { pag, ctx } = await pagina(1440, 900, 'explore Moon');
    await pag.goto(`${baseUrl}/explorar/index.html?mundo=moon&lat=-89.68643&lon=-162.9371`);
    await pag.waitForFunction(() => window.__az?.vista?.listo === true, null, { timeout: 120000 });
    const vis = await pag.evaluate(() => { const b = document.getElementById('ver-relieve'); return !!b && b.offsetParent !== null; });
    if (!vis) falla('explore: "See the terrain here" not visible with the pin set');
    await pag.screenshot({ path: join(SALIDA, 'explorar-luna-boton.png') });
    const v = await abrirVista(pag, '#ver-relieve');
    comprobarEsperado(`explore Moon pin at Shackleton rim (${v.fuente})`, v, await esperadoPropio('moon', -89.68643, -162.9371));
    await pag.screenshot({ path: join(SALIDA, 'explorar-luna-terreno.png') });
    await cerrarVista(pag, 'explore');
    await ctx.close();
  }
  console.log(`requests to outside origins: ${externos.length}`);
} catch (e) {
  falla(`exception: ${e.stack ?? e}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA_RELIEVE ${fallos.length} FAIL` : 'CAPTURA_RELIEVE ok');
process.exit(fallos.length ? 1 : 0);

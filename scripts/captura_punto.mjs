// Simulación con el punto elegido en Marte o en la Luna fuera del catálogo (?punto=lat,lon&mundo=), en Chromium, con
// teselas de la Tierra sintéticas servidas aquí: (a) panel de Marte hecho del mapa global = node, rotulado; (b) los dos a
// ras de suelo, suelo teñido y sin herramientas lunares; (c) equipo espejo Tierra → Marte con la gravedad de Marte;
// (d) día: sol de Marte = sol.js, estación; (e) taladro en Marte sin rótulos de la Tierra; (f) punto lunar ecuatorial;
// (g) punto lunar junto al polo sin relieve: la Tierra sola y un aviso llano.
// Uso: node scripts/captura_punto.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { ORIGENES_EXTERNOS, rejillaLocal, remuestrear, muestraEquirect, filasEquirect, leerI16 } from '../web/relieve/calculo.js';
import { N_PUNTO, idPunto, TEXTO_TONO } from '../web/terreno/lugar.js';
import { solMundo, solTierra, OBLICUIDAD_MARTE } from '../web/terreno/sol.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'punto');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const LUGAR = { lat: -23.5, lon: -68.2 }, MARTE = { lat: 18.44, lon: 77.45 };
const fallos = [];
const comprobar = (cond, bien, mal) => { if (cond) console.log(`ok   ${bien}`); else { fallos.push(mal); console.error(`FAIL ${mal}`); } };
const cerca = (a, b, tol) => Math.abs(a - b) <= tol;

// Tesela de altura: una rampa suave (2 300 m + unos metros); imagen: un ocre liso.
function png(ancho, alto, rgbDe) {
  const crudo = Buffer.alloc((ancho * 3 + 1) * alto);
  for (let j = 0; j < alto; j++) for (let i = 0; i < ancho; i++) crudo.set(rgbDe(i, j), j * (ancho * 3 + 1) + 1 + 3 * i);
  const trozo = (tipo, datos) => { const t = Buffer.from(tipo, 'latin1'), l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(datos.length); c.writeUInt32BE(crc32(Buffer.concat([t, datos])) >>> 0); return Buffer.concat([l, t, datos, c]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))]);
}
const ALTURA = png(256, 256, (i, j) => { const h = 2300 + (i + j) / 64 + 32768, r = Math.floor(h / 256), g = Math.floor(h - r * 256); return [r, g, Math.floor((h - Math.floor(h)) * 256)]; });
const OCRE = png(256, 256, () => [190, 130, 70]);

const servidor = createServer(async (req, res) => {
  const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = join(WEB, ruta.endsWith('/') ? `${ruta}index.html` : ruta);
  if (!f.startsWith(WEB)) { res.writeHead(403).end(); return; }
  try {
    const b = await readFile(f), rango = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    if (rango) { const a = +rango[1], z = Math.min(+rango[2], b.length - 1); res.writeHead(206, { 'content-type': 'application/octet-stream', 'content-range': `bytes ${a}-${z}/${b.length}` }).end(b.subarray(a, z + 1)); return; }
    res.writeHead(200, { 'content-type': TIPOS[extname(f)] ?? 'application/octet-stream' }).end(b);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}`;
await mkdir(SALIDA, { recursive: true });
const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pag = await nav.newPage({ viewport: { width: 1600, height: 900 } });
pag.on('console', (m) => { if (m.type() === 'error') { fallos.push(`console: ${m.text()}`); console.error(`FAIL console: ${m.text()}`); } });
pag.on('pageerror', (e) => { fallos.push(`page error: ${e.message}`); console.error(`FAIL page error: ${e.message}`); });
const otros = [];
pag.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:') && !ORIGENES_EXTERNOS.some((o) => u.startsWith(`${o}/`))) otros.push(u); });
await pag.route(`${ORIGENES_EXTERNOS[0]}/**`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: ALTURA, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-amz-meta-x-imagery-sources', 'x-amz-meta-x-imagery-sources': 'srtm/S24W069.hgt.gz' } }));
await pag.route(`${ORIGENES_EXTERNOS[1]}/**`, (route) => route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: OCRE }));
const abrir = async (punto, mundo) => {
  await pag.goto(`${base}/terreno/index.html?lugar=${LUGAR.lat},${LUGAR.lon}&nombre=Atacama+test&punto=${punto.lat},${punto.lon}&mundo=${mundo}&vista=suelo&mes=7`);
  await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: 180000 });
  await pag.waitForTimeout(900);
};
const limpiar = () => pag.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('analog-zero.planted.')) localStorage.removeItem(k); });
const panel = (i) => pag.evaluate((i) => {
  const p = window.__az.paneles[i], e = p.escena;
  if (!e) return null;
  const k = (e.n - 1) / 2, t = (s) => p.el.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() ?? null;
  return { id: p.id, cuerpo: e.meta.cuerpo, n: e.n, m: e.m, lado: e.meta.lado_km, centro: e.base[k * e.n + k], zmin: e.zmin, zmax: e.zmax, suelo: !!e.suelo, bruma: e.conBruma, rutas: !!p.rutas, obra: !!p.obra, base: !!p.base,
    chips: [...p.el.querySelectorAll('.tarjeta .marca-chip')].map((c) => c.textContent), titulo: t('.tarjeta h2'), muestreo: t('[data-muestreo-punto]'), imagen: t('[data-imagen]'), fuente: t('.tarjeta .fuente.recorte'),
    modo: p.el.querySelector('.mandos [data-modo][aria-pressed=true]')?.textContent, leyenda: t('.leyenda'), colores: e.muestraLienzo().colores };
}, i);

try {
  // ---------- (a) + (b) Marte ----------
  await abrir(MARTE, 'mars');
  await limpiar();
  await abrir(MARTE, 'mars');
  const idx = JSON.parse(readFileSync(join(WEB, 'data/relieve/indice.json'), 'utf8')).mundos.mars;
  const g = rejillaLocal(MARTE.lat, MARTE.lon, (10000 * (N_PUNTO - 1)) / N_PUNTO, N_PUNTO, idx.radio_m);
  const { f0, f1 } = filasEquirect(g, idx.ppd, idx.alto), crudo = readFileSync(join(WEB, 'data/relieve', idx.fichero));
  const datos = leerI16(crudo.buffer.slice(crudo.byteOffset + f0 * idx.ancho * 2, crudo.byteOffset + f1 * idx.ancho * 2), idx.factor_m);
  const z = remuestrear((la, lo) => muestraEquirect({ ancho: idx.ancho, alto: idx.alto, ppd: idx.ppd, fila0: f0, filas: f1 - f0, datos }, la, lo), g);
  const kc = ((N_PUNTO - 1) / 2) * (N_PUNTO + 1);
  const [a, b] = [await panel(0), await panel(1)];
  comprobar(b && b.cuerpo === 'marte' && b.id === idPunto({ mundo: 'mars', ...MARTE, lado_km: 10 }) && b.n === N_PUNTO && cerca(b.lado, 10, 1e-9), `(a) Mars panel built for the point: ${b?.id}, n=${b?.n}, ${b?.m.toFixed(1)} m per cell, ${b?.colores} colours`, `(a) Mars panel: ${JSON.stringify(b)}`);
  comprobar(b && cerca(b.centro, z[kc], 0.01) && cerca(b.zmin, Math.min(...z), 0.01) && cerca(b.zmax, Math.max(...z), 0.01), `(a) elevation = MOLA read in node: centre ${z[kc].toFixed(1)} m, ${Math.min(...z).toFixed(0)} to ${Math.max(...z).toFixed(0)} m`, `(a) elevation: page ${b?.centro} ${b?.zmin} ${b?.zmax} vs node ${z[kc]} ${Math.min(...z)} ${Math.max(...z)}`);
  comprobar(b.chips.join() === 'Mars,Your point' && /Your point on Mars · 18\.44° N, 77\.45° E/.test(b.titulo), `(a) card: ${b.chips.join(' · ')} — "${b.titulo}"`, `(a) card: ${b.chips} ${b.titulo}`);
  comprobar(/one value every 3\.7 km, smoothed onto a 39 m grid\. Anything smaller than 3\.7 km is not in the data/.test(b.muestreo ?? '') && b.imagen === TEXTO_TONO && /MOLA/.test(b.fuente) && /built live in your browser/.test(b.fuente), `(a) says what it is: "${b.muestreo}"`, `(a) labels: ${b.muestreo} | ${b.imagen} | ${b.fuente}`);
  comprobar(a.suelo && b.suelo && a.bruma && !b.bruma, '(b) both panels start standing on the ground; no haze on Mars', `(b) ground view: earth ${a.suelo}, mars ${b?.suelo}`);
  comprobar(b.modo === 'Tinted' && /Tinted · one average colour of this world/.test(b.leyenda) && /not an image of this place/.test(b.leyenda), `(b) Mars ground: "${b.leyenda.slice(0, 110)}…"`, `(b) Mars colour mode: ${b.modo} "${b.leyenda}"`);
  comprobar(!b.rutas && !b.obra && !b.base && a.rutas, '(b) the Moon-only tools (routes, works, base) are not offered on Mars', `(b) tools on Mars: ${b.rutas} ${b.obra} ${b.base}`);
  comprobar(/same horizontal scale · 10 km each/.test(await pag.textContent('#nota-escala')) && otros.length === 0, '(b) same scale in both panels; no request to other servers', `(b) scale note "${await pag.textContent('#nota-escala')}", other servers ${otros.join(' ')}`);
  await pag.screenshot({ path: join(SALIDA, 'a-marte.png') });

  // ---------- (c) espejo ----------
  await pag.click('.panel[data-lado=a] .ver-paleta');
  await pag.click('.panel[data-lado=a] .paleta [data-eq=habitat_superficie]');
  const c = await pag.locator('.panel[data-lado=a] .lienzo canvas').first().boundingBox();
  await pag.mouse.click(c.x + c.width / 2, c.y + c.height * 0.6);
  await pag.waitForTimeout(900);
  const pl = await pag.evaluate(() => window.__az.paneles.map((p) => p.plantados.lista.map((x) => ({ equipo: x.equipo, par: x.par }))));
  comprobar(pl[0].length === 1 && pl[1].length === 1 && pl[0][0].par && pl[0][0].par === pl[1][0].par, '(c) planting on Earth planted the twin on Mars', `(c) twins: ${JSON.stringify(pl)}`);
  const hoja = await pag.evaluate(() => { const h = document.querySelector('.panel[data-lado=b] .hoja [data-espejo]'); return h && { cab: h.querySelector('.et').textContent, cols: [...h.querySelectorAll('thead th')].map((x) => x.textContent), g: h.querySelector('[data-no-repro=gravedad_m_s2]')?.textContent.replace(/\s+/g, ' ').trim(), enlaces: [...h.querySelectorAll('[data-no-repro=gravedad_m_s2] a')].map((x) => x.href) }; });
  comprobar(hoja && /Same equipment on Earth/.test(hoja.cab) && hoja.cols.join() === ',Mars,Earth,Reading' && /3\.73 m\/s2 on Mars, 9\.82 m\/s2 on Earth/.test(hoja.g) && hoja.enlaces.some((u) => /marsfact/.test(u)), `(c) Mars sheet compares with Earth: ${hoja?.g}`, `(c) Mars sheet: ${JSON.stringify(hoja)}`);

  // ---------- (d) día ----------
  const ir = async (h) => { await pag.evaluate((h) => window.__az.dia.ir(h), h); await pag.waitForFunction(() => window.__az.dia.listo(), null, { timeout: 180000 }); await pag.waitForTimeout(500); };
  await ir(9);
  let sol = await pag.evaluate(() => window.__az.paneles.map((p) => p.escena.sol));
  const m9 = solMundo({ lat: MARTE.lat, decl: 0, hora: 9 }), t9 = solTierra({ lat: LUGAR.lat, mes: 7, hora: 9 });
  comprobar(cerca(sol[1].el, m9.el, 1e-6) && cerca(sol[1].az, m9.az, 1e-6) && cerca(sol[0].el, t9.el, 1e-6), `(d) 09:00 in each world = node: Mars Sun ${m9.el.toFixed(1)}° (equinox), Earth Sun ${t9.el.toFixed(1)}° (July)`, `(d) Sun ${JSON.stringify(sol)} vs ${JSON.stringify([t9, m9])}`);
  const txt = await pag.evaluate(() => [...document.querySelectorAll('.dia-lectura .dia-texto')].map((d) => d.textContent.replace(/\s+/g, ' ').trim()));
  comprobar(/Mars · 09:00 local solar time of its own day, which lasts 24\.66 h/.test(txt[1]) && await pag.isVisible('#dia [data-a=decl]') && await pag.isVisible('#dia [data-g=fuente-marte]'), `(d) readout: "${txt[1].slice(0, 120)}…"; season control and Mars sources shown`, `(d) readout "${txt[1]}"`);
  await pag.selectOption('#dia [data-a=decl]', String(-OBLICUIDAD_MARTE));
  await ir(12);
  sol = await pag.evaluate(() => window.__az.paneles.map((p) => p.escena.sol));
  const mv = solMundo({ lat: MARTE.lat, decl: -OBLICUIDAD_MARTE, hora: 12 });
  comprobar(cerca(sol[1].el, mv.el, 1e-6) && cerca(mv.el, 90 - (MARTE.lat + OBLICUIDAD_MARTE), 1e-9), `(d) southern summer: Mars noon Sun drops to ${mv.el.toFixed(1)}°`, `(d) season: ${JSON.stringify(sol[1])} vs ${JSON.stringify(mv)}`);
  const tira = await pag.evaluate(() => [...document.querySelectorAll('.dia-tira')].map((t) => (t.hidden ? null : t.textContent.replace(/\s+/g, ' ').trim())));
  comprobar(/of 24 hours sunlit/.test(tira[0] ?? '') && /of 24 steps of 1\.03 h sunlit/.test(tira[1] ?? ''), `(d) strips: "${tira[0]}" | "${tira[1]}"`, `(d) strips: ${JSON.stringify(tira)}`);
  await pag.screenshot({ path: join(SALIDA, 'd-dia-marte.png') });

  // ---------- (e) taladro en Marte ----------
  await pag.waitForFunction(() => window.__az.paneles.every((p) => !p.escena || p.volatiles?.V.D), null, { timeout: 30000 });
  await pag.click('.panel[data-lado=b] .perforar');
  const cb = await pag.locator('.panel[data-lado=b] .lienzo canvas').first().boundingBox();
  await pag.mouse.click(cb.x + cb.width / 2 + 30, cb.y + cb.height * 0.7);
  await pag.waitForTimeout(600);
  const perf = await pag.evaluate(() => window.__az.paneles.map((p) => ({ perf: !!p.volatiles.V.perf, t: p.el.querySelector('.perforacion').textContent.replace(/\s+/g, ' ').trim(), bocados: p.el.querySelector('.perforacion [data-v=secuencia]')?.dataset.bocados })));
  comprobar(perf[1].perf && perf[0].perf && /^Mars · /.test(perf[1].t) && /Reading at this point/.test(perf[1].t) && !/Earth · here|Not testable on Earth|Ice expected/.test(perf[1].t) && perf[1].bocados === '10', '(e) drill card on Mars: its reading and the TRIDENT sequence, no Earth or lunar-ice wording; Earth got its twin point', `(e) drill on Mars: ${JSON.stringify(perf).slice(0, 500)}`);
  await limpiar();

  // ---------- (f) Luna ecuatorial ----------
  await abrir({ lat: 0.67, lon: 23.47 }, 'moon');
  const lq = await panel(1);
  comprobar(lq && lq.cuerpo === 'luna' && /Your point on the Moon · 0\.67° N, 23\.47° E/.test(lq.titulo) && /one value every 1\.9 km/.test(lq.muestreo) && lq.rutas, `(f) Moon point away from the catalogue terrains: "${lq?.titulo}" — ${lq?.muestreo.slice(0, 70)}…`, `(f) Moon point: ${JSON.stringify(lq)}`);
  await ir(15);
  const tl = await pag.evaluate(() => document.querySelector('.dia-lectura[data-lado=b] .dia-texto').textContent.replace(/\s+/g, ' ').trim());
  const sl = await pag.evaluate(() => window.__az.paneles[1].escena.sol), l15 = solMundo({ lat: 0.67, decl: 0, hora: 15 });
  comprobar(cerca(sl.el, l15.el, 1e-6) && /which lasts 29\.53 Earth days · Sun taken over the equator \(own simplification\)/.test(tl), `(f) Moon day: Sun ${l15.el.toFixed(1)}° at 15:00 of its day — "${tl.slice(0, 110)}…"`, `(f) Moon day: ${JSON.stringify(sl)} "${tl}"`);
  await pag.screenshot({ path: join(SALIDA, 'f-luna-ecuatorial.png') });

  // ---------- (g) junto al polo ----------
  await abrir({ lat: -88, lon: 30 }, 'moon');
  const g2 = await pag.evaluate(() => ({ unico: document.body.dataset.unico ?? null, aviso: document.querySelector('.panel[data-lado=a] .aviso-lugar').textContent, visible: !document.querySelector('.panel[data-lado=a] .aviso-lugar').hidden, errores: window.__az.errores, tierra: !!window.__az.paneles[0].escena, b: !!window.__az.paneles[1].escena, espejo: document.getElementById('espejo').hidden }));
  comprobar(g2.unico === 'a' && g2.visible && /The terrain of your point on the Moon could not be built \(No local terrain this close to the pole\), so your place on Earth is shown alone\./.test(g2.aviso) && g2.tierra && !g2.b && g2.espejo && !g2.errores.length, `(g) no terrain for that point: "${g2.aviso}"`, `(g) fallback: ${JSON.stringify(g2)}`);
  await pag.screenshot({ path: join(SALIDA, 'g-sin-relieve.png') });
} catch (e) {
  fallos.push(`script: ${e.message}`); console.error(e);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `\n${fallos.length} FAILED` : '\nall ok');
process.exit(fallos.length ? 1 : 0);

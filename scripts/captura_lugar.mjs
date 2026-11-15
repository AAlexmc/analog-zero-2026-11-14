// Visor de terreno con el lugar en la URL (?lugar=lat,lon) en Chromium, con teselas sintéticas servidas aquí:
// (a) panel de la Tierra con ese lugar, 10 km y la tarjeta de muestreo = node; (b) altura central y desnivel = adaptador en node;
// (c) Ground view: ojo entre 1,5 y 3 m, 1×, no atraviesa el suelo, Overview restaura; (d) equipo a escala en Ground view;
// (e) teselas cortadas → aviso y catálogo; (f) sin lugar → como siempre; (g) 390×844; (h) contraste; (i) humo con red.
// Suelo y equipo de la misión: (sat) imagen de dos colores en Satellite, por defecto con &vista=suelo; (rumbo) = node;
// (zoe) caja 2,9 × 1,9 × 2,0 m; (domo) HI-SEAS; (sev) Lunar Electric Rover; (scarecrow) pendiente; (sin equipo) / 404; (móvil); (contraste).
// Uso: node scripts/captura_lugar.mjs [--sin-vivo]
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { ORIGENES_EXTERNOS, R_TIERRA_M, ZOOM_MAX_TERRARIUM, zoomPara, rejillaLocal, teselasVentana, muestraMercator, remuestrear, CREDITOS_TIERRA } from '../web/relieve/calculo.js';
import { ventanaLugar, terrenoDeRelieve, textoMuestreo, idLugar, TEXTO_IMAGEN } from '../web/terreno/lugar.js';
import { rumboHorizonte, pendienteGrados } from '../web/terreno/calculo.js';
import { equiposDeMision, formaPublicada, limitesDe, textoPendiente, ROTULO } from '../web/terreno/equipo_mision.js';
import { PAREJAS, contraste, mezclar } from '../web/marca/contraste.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'lugar');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const SIN_VIVO = process.argv.includes('--sin-vivo');
const LAT = 75.25, LON = -84.25, NOMBRE = 'Devon Island test place';
const FUENTE_CAB = 'pgdc_5m/29_29_2_2_5m_v2.0.tif';

const fallos = [];
const falla = (m) => { fallos.push(m); console.error(`FAIL ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);
const comprobar = (cond, bien, mal) => (cond ? ok(bien) : falla(mal));

// ---------- Teselas sintéticas (relieve con detalle de cientos de metros) ----------
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
const alturaSintetica = (lat, lon) => 300 + 40 * Math.sin((lat * 2 * Math.PI) / 0.021) * Math.cos((lon * 2 * Math.PI) / 0.07) + 600 * (lat - LAT) + 8 * Math.sin((lon * 2 * Math.PI) / 0.011);
const cacheT = new Map();
function terrarium(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (cacheT.has(k)) return cacheT.get(k);
  const rgb = Buffer.alloc(256 * 256 * 3), dec = new Float32Array(256 * 256);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const p = latLonDePixel(z, x * 256 + i + 0.5, y * 256 + j + 0.5);
    const h = alturaSintetica(p.lat, p.lon) + 32768, q = j * 256 + i;
    const r = Math.floor(h / 256), g = Math.floor(h - r * 256), b = Math.floor((h - Math.floor(h)) * 256);
    rgb[3 * q] = r; rgb[3 * q + 1] = g; rgb[3 * q + 2] = b;
    dec[q] = r * 256 + g + b / 256 - 32768;
  }
  const t = { png: png(256, 256, rgb), dec };
  cacheT.set(k, t);
  return t;
}
// Imagen de GIBS sintética: ocre al oeste del lugar, azul al este (para leer el color del terreno en el lienzo).
const OCRE = [200, 120, 40], AZUL = [40, 120, 200];
const cacheI = new Map();
function imagenDosColores(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (cacheI.has(k)) return cacheI.get(k);
  const rgb = Buffer.alloc(256 * 256 * 3);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const c = latLonDePixel(z, x * 256 + i + 0.5, y * 256 + j + 0.5).lon < LON ? OCRE : AZUL;
    rgb.set(c, 3 * (j * 256 + i));
  }
  const b = png(256, 256, rgb);
  cacheI.set(k, b);
  return b;
}

// Lo mismo que hace cargarRelieve con estas teselas, en node, y el adaptador encima.
function esperadoLugar(lat, lon, lado_km) {
  const v = ventanaLugar(lat, lado_km);
  const g = rejillaLocal(lat, lon, v.lado_pedido_km * 1000, v.n, R_TIERRA_M);
  const z = zoomPara(lat, g.paso, ZOOM_MAX_TERRARIUM), tv = teselasVentana(g, z);
  const mapa = new Map(tv.lista.map((t) => [`${t.x}/${t.y}`, terrarium(z, t.x, t.y).dec]));
  const zz = remuestrear((la, lo) => muestraMercator(tv, mapa, z, la, lo), g);
  const relieve = { n: v.n, paso: g.paso, R: R_TIERRA_M, z: zz, lado_m: g.lado, descarga_bytes: 0, creditos: CREDITOS_TIERRA,
    teselas: { elevacion: { z, n: tv.lista.length, origenes: tv.lista.map(() => FUENTE_CAB) } } };
  return { v, t: terrenoDeRelieve(relieve, { lat, lon, nombre: NOMBRE }) };
}

// ---------- Servidor ----------
const servidor = createServer(async (req, res) => {
  const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = join(WEB, ruta.endsWith('/') ? `${ruta}index.html` : ruta);
  if (!f.startsWith(WEB)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': TIPOS[extname(f)] ?? 'application/octet-stream' }).end(await readFile(f)); } catch { res.writeHead(404).end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${servidor.address().port}`;
await mkdir(SALIDA, { recursive: true });
const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const INDICE = JSON.parse(readFileSync(join(WEB, 'data/terreno/index.json'), 'utf8'));
const MODELOS = JSON.parse(readFileSync(join(WEB, 'data/modelos.json'), 'utf8'));

async function pagina(ancho, alto, etiqueta, { red = 'sintetica', movil = false, tolerar = null } = {}) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: alto }, ...(movil ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const pag = await ctx.newPage();
  const cuenta = { teselas: 0, bytes: 0, otros: [], externos: 0 };
  pag.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (red !== 'sintetica' && /Failed to load resource|net::ERR_/.test(m.text())) return;
    if (tolerar?.test(m.text())) return;
    falla(`console error (${etiqueta}): ${m.text()}`);
  });
  pag.on('pageerror', (e) => falla(`page error (${etiqueta}): ${e.message}`));
  pag.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(baseUrl) || u.startsWith('data:') || u.startsWith('blob:')) return;
    cuenta.externos++;
    if (!ORIGENES_EXTERNOS.some((o) => u.startsWith(`${o}/`))) cuenta.otros.push(u);
  });
  if (red === 'sintetica') {
    await pag.route(`${ORIGENES_EXTERNOS[0]}/**`, (route) => {
      const m = /\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(route.request().url());
      if (!m) return route.abort();
      const b = terrarium(+m[1], +m[2], +m[3]).png;
      cuenta.teselas++; cuenta.bytes += b.length;
      return route.fulfill({ status: 200, contentType: 'image/png', body: b,
        headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-amz-meta-x-imagery-sources', 'x-amz-meta-x-imagery-sources': FUENTE_CAB } });
    });
    await pag.route(`${ORIGENES_EXTERNOS[1]}/**`, (route) => {
      const m = /\/(\d+)\/(\d+)\/(\d+)\.jpeg$/.exec(route.request().url());
      if (!m) return route.abort();
      return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: imagenDosColores(+m[1], +m[3], +m[2]) });
    });
  } else if (red === 'cortada') {
    for (const o of ORIGENES_EXTERNOS) await pag.route(`${o}/**`, (route) => route.abort('internetdisconnected'));
  } else {
    pag.on('response', (r) => { if (r.url().startsWith(ORIGENES_EXTERNOS[0])) { cuenta.teselas++; cuenta.bytes += Number(r.headers()['content-length'] ?? 0); } });
  }
  return { pag, ctx, cuenta };
}
const abrir = async (pag, q, ms = 180000) => {
  await pag.goto(`${baseUrl}/terreno/index.html${q}`);
  await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: ms });
  await pag.waitForTimeout(800);
};
const A = '.panel[data-lado=a]';
const panelA = (pag) => pag.evaluate(() => {
  const p = window.__az.paneles[0], e = p.escena;
  if (!e) return { id: p.id, escena: false };
  const k = (e.n - 1) / 2;
  return { id: p.id, escena: true, n: e.n, m: e.m, lado_km: e.meta.lado_km, dinamico: !!e.meta.dinamico, georef: e.meta.georef.tipo, centro: e.base[k * e.n + k], z_min: e.meta.z_min, z_max: e.meta.z_max,
    muestreo: document.querySelector('.panel[data-lado=a] [data-muestreo]')?.textContent ?? null, titulo: document.querySelector('.panel[data-lado=a] .tarjeta h2')?.textContent ?? null,
    aviso: (() => { const a = document.querySelector('.panel[data-lado=a] .aviso-lugar'); return a && !a.hidden ? a.textContent : null; })(),
    ventana: [...document.querySelectorAll('.panel[data-lado=a] [data-lado-km]')].map((b) => `${b.dataset.ladoKm}:${b.getAttribute('aria-pressed')}`),
    notaEscala: document.getElementById('nota-escala').textContent, colores: e.muestraLienzo().colores };
});
const suelo = (pag, i = 0) => pag.evaluate((i) => window.__az.paneles[i].escena.estadoSuelo(), i);

try {
  // ---------- (a) + (b) lugar con teselas sintéticas ----------
  const { v, t } = esperadoLugar(LAT, LON, 10);
  const { pag, ctx, cuenta } = await pagina(1600, 900, 'place');
  await abrir(pag, `?lugar=${LAT},${LON}&nombre=${encodeURIComponent(NOMBRE)}`);
  const a = await panelA(pag);
  comprobar(a.escena && a.dinamico && a.id === idLugar({ lat: LAT, lon: LON, lado_km: 10 }), `(a) Earth panel built for the place: ${a.id}, ${a.colores} colours`, `(a) Earth panel is not the place: ${JSON.stringify(a)}`);
  comprobar(a.titulo === NOMBRE && a.georef === 'local_aeqd', `(a) title "${a.titulo}", georef ${a.georef}`, `(a) title/georef: ${a.titulo} ${a.georef}`);
  comprobar(a.lado_km === 10 && a.n === v.n && Math.abs(a.m - v.m_por_px) < 1e-9, `(a) side ${a.lado_km} km, n=${a.n}, ${a.m.toFixed(3)} m/px = node`, `(a) side/n/m: ${a.lado_km} ${a.n} ${a.m} vs ${v.n} ${v.m_por_px}`);
  const txtNode = textoMuestreo(t.meta);
  comprobar(a.muestreo === txtNode, `(a) card: "${a.muestreo}"`, `(a) card text differs:\n  page ${a.muestreo}\n  node ${txtNode}`);
  comprobar(a.ventana.join() === '2:false,10:true,40:false', `(a) window selector ${a.ventana.join(' ')}`, `(a) window selector ${a.ventana.join(' ')}`);
  comprobar(/extents differ \(10 km vs 40 km\)/.test(a.notaEscala), `(a) scale note: "${a.notaEscala}"`, `(a) scale note: "${a.notaEscala}"`);
  comprobar(cuenta.otros.length === 0, `(a) outside requests only to the two allowed servers (${cuenta.teselas} elevation tiles served)`, `(a) other servers: ${cuenta.otros.join(' ')}`);
  const k = (t.meta.n - 1) / 2;
  const cN = t.altura[k * t.meta.n + k];
  comprobar(Math.abs(a.centro - cN) < 0.01, `(b) centre elevation ${a.centro.toFixed(2)} m = node ${cN.toFixed(2)} m`, `(b) centre ${a.centro} vs node ${cN}`);
  comprobar(Math.abs((a.z_max - a.z_min) - (t.meta.z_max - t.meta.z_min)) < 0.01, `(b) relief ${(a.z_max - a.z_min).toFixed(2)} m = node ${(t.meta.z_max - t.meta.z_min).toFixed(2)} m`, `(b) relief ${a.z_max - a.z_min} vs ${t.meta.z_max - t.meta.z_min}`);
  await pag.screenshot({ path: join(SALIDA, 'a-lugar-1600.png') });
  await pag.setViewportSize({ width: 1280, height: 800 });
  await pag.waitForTimeout(800);
  await pag.screenshot({ path: join(SALIDA, 'a-lugar-1280.png') });
  await pag.setViewportSize({ width: 1600, height: 900 });
  await pag.waitForTimeout(500);

  // ---------- (c) Ground view ----------
  const antes = await pag.evaluate(() => { const e = window.__az.paneles[0].escena; return { pos: e.camara.position.toArray(), target: e.controles.target.toArray(), exag: e.exag }; });
  await pag.$eval('#exag', (i) => { i.value = 3; i.dispatchEvent(new Event('input')); });
  await pag.click(`${A} .suelo`);
  await pag.waitForTimeout(600);
  let s = await suelo(pag);
  const boton = await pag.textContent(`${A} .suelo`), pild = await pag.textContent(`${A} .pildora-suelo`);
  comprobar(s && s.ojo_m >= 1.5 && s.ojo_m <= 3, `(c) ground view eye ${s?.ojo_m.toFixed(2)} m above the ground`, `(c) eye height ${JSON.stringify(s)}`);
  comprobar(s?.exag === 1 && /vertical 1× \(true scale\)/.test(pild), `(c) exaggeration forced to 1× with the slider at 3 ("${pild}")`, `(c) exag ${s?.exag} pill "${pild}"`);
  comprobar(boton === 'Overview', '(c) button now reads Overview', `(c) button reads ${boton}`);
  const cielo = await pag.evaluate(() => {
    const e = window.__az.paneles[0].escena;
    e.girarSuelo(0, 0.6); e.dibujar(true);
    const gl = e.renderer.getContext(), px = new Uint8Array(4);
    gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), gl.drawingBufferHeight - 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    e.girarSuelo(0, -0.6);
    return [...px];
  });
  comprobar(Math.abs(cielo[0] - 0x2e) < 40 && Math.abs(cielo[1] - 0x96) < 40 && cielo[2] > 200, `(c) sky at the top of the view is blue yonder-like rgb(${cielo.slice(0, 3)})`, `(c) sky colour rgb(${cielo})`);
  await pag.screenshot({ path: join(SALIDA, 'c-suelo-tierra.png') });
  // Avanzar con la tecla y a pasos largos: el ojo nunca baja de 1,5 m.
  const p0 = await suelo(pag);
  await pag.keyboard.down('ArrowUp');
  let minOjo = Infinity;
  for (let i = 0; i < 15; i++) { await pag.waitForTimeout(150); minOjo = Math.min(minOjo, (await suelo(pag)).ojo_m); }
  await pag.keyboard.up('ArrowUp');
  const p1 = await suelo(pag);
  const andado = Math.hypot(p1.x_km - p0.x_km, p1.z_km - p0.z_km) * 1000;
  comprobar(andado > 0.2 && andado < 5, `(c) ArrowUp held ~2 s walks ${andado.toFixed(2)} m`, `(c) ArrowUp walked ${andado} m`);
  const largo = await pag.evaluate(() => {
    const e = window.__az.paneles[0].escena;
    let min = Infinity, max = -Infinity;
    for (const rumbo of [0, 1.3, 2.9, 4.4]) {
      e.girarSuelo(rumbo - e.suelo.yaw, 0);
      for (let i = 0; i < 300; i++) { e.andarSuelo(7); const o = e.estadoSuelo().ojo_m; min = Math.min(min, o); max = Math.max(max, o); }
    }
    return { min, max };
  });
  minOjo = Math.min(minOjo, largo.min);
  comprobar(minOjo >= 1.5 && largo.max <= 3, `(c) eye stays ${minOjo.toFixed(3)}–${largo.max.toFixed(3)} m above the ground over 8.4 km of walking to the edges`, `(c) eye left the 1.5–3 m band: ${minOjo}–${largo.max}`);
  await pag.click(`${A} .suelo`);
  await pag.waitForTimeout(400);
  const vuelta = await pag.evaluate(() => { const e = window.__az.paneles[0].escena; return { pos: e.camara.position.toArray(), target: e.controles.target.toArray(), exag: e.exag, suelo: e.suelo, cielo: e.cielo.visible }; });
  const igual = (x, y) => x.every((q, i) => Math.abs(q - y[i]) < 1e-9);
  comprobar(igual(vuelta.pos, antes.pos) && igual(vuelta.target, antes.target) && vuelta.exag === 3 && !vuelta.suelo && !vuelta.cielo,
    '(c) Overview restores the camera and the 3× exaggeration', `(c) overview not restored: ${JSON.stringify({ antes, vuelta })}`);
  await pag.$eval('#exag', (i) => { i.value = 1; i.dispatchEvent(new Event('input')); });

  // ---------- (d) equipo plantado visto a ras de suelo ----------
  const sev = MODELOS.modelos.find((m) => m.equipo === 'ltv');
  await pag.click(`${A} .ver-paleta`);
  await pag.click(`${A} .paleta [data-eq=ltv]`);
  const punto = await pag.evaluate(() => { const e = window.__az.paneles[0].escena, k = (e.n - 1) / 2; const s = e.aPantalla(e.mundoDePixel(k - 40, k)); return [s.x, s.y]; });
  await pag.mouse.click(punto[0], punto[1]);
  await pag.waitForFunction(() => window.__az.paneles[0].modelos.instancias().some((x) => x.enEscena), null, { timeout: 60000 });
  await pag.click(`${A} .suelo`);
  await pag.waitForTimeout(800);
  const eq = await pag.evaluate(async (url) => {
    const T = await import(url);
    const p = window.__az.paneles[0], e = p.escena, it = p.plantados.lista[0];
    p.modelos.sincronizar(p.plantados.lista);
    // Un fotograma dibujado antes de medir: la proyección usa las matrices de la cámara del último dibujo.
    e.dibujar(true);
    const ins = p.modelos.instancias().find((x) => x.uid === it.uid), obj = p.modelos.grupo.children.find((o) => o.userData.uid === it.uid);
    const caja = new T.Box3().setFromObject(obj), tam = caja.getSize(new T.Vector3()).multiplyScalar(1000), c = caja.getCenter(new T.Vector3());
    const s = e.aPantalla(c), r = e.renderer.domElement.getBoundingClientRect();
    const arriba = e.aPantalla(new T.Vector3(c.x, caja.max.y, c.z)), abajo = e.aPantalla(new T.Vector3(c.x, caja.min.y, c.z));
    return { factor: ins.factor, tam: [tam.x, tam.y, tam.z], dentro: s?.dentro, altoPx: abajo && arriba ? abajo.y - arriba.y : null, lienzoAlto: r.height,
      dist_m: e.camara.position.distanceTo(c) * 1000, ojo: e.estadoSuelo().ojo_m };
  }, `${baseUrl}/lib/three/three.module.js`);
  const ord = (x) => [...x].sort((p, q) => p - q);
  const dif = ord(eq.tam).map((x, i) => Math.abs(x - ord(sev.medida_m)[i]) / ord(sev.medida_m)[i]);
  comprobar(eq.factor === 1 && dif.every((d) => d < 0.02), `(d) planted LTV (3D model: ${sev.id}) at ×1: box ${eq.tam.map((x) => x.toFixed(2)).join(' × ')} m vs modelos.json ${sev.medida_m.join(' × ')} m`,
    `(d) model box ${eq.tam} vs ${sev.medida_m}, factor ${eq.factor}`);
  comprobar(eq.dentro && eq.altoPx > 20, `(d) model in view from ${eq.dist_m.toFixed(1)} m, ${eq.altoPx.toFixed(0)} px tall of a ${eq.lienzoAlto.toFixed(0)} px canvas (eye ${eq.ojo.toFixed(2)} m)`, `(d) model not in view: ${JSON.stringify(eq)}`);
  await pag.screenshot({ path: join(SALIDA, 'd-suelo-equipo.png') });
  // El enlace de cámaras no mueve un panel a ras de suelo.
  await pag.click('#enlazar');
  const enl = await pag.evaluate(() => { const [a, b] = window.__az.paneles.map((p) => p.escena); const pa = a.camara.position.toArray(); b.controles.dispatchEvent({ type: 'change' }); return { igual: a.camara.position.toArray().every((v, i) => v === pa[i]), suelo: !!a.suelo }; });
  comprobar(enl.igual && enl.suelo, '(c) Link cameras leaves the ground view alone', `(c) link moved the ground camera ${JSON.stringify(enl)}`);
  await pag.click('#enlazar');
  // Luna a ras de suelo: cielo oscuro y sin bruma.
  await pag.click('.panel[data-lado=b] .suelo');
  await pag.waitForTimeout(600);
  const luna = await suelo(pag, 1);
  const pl = await pag.textContent('.panel[data-lado=b] .pildora-suelo');
  comprobar(luna && luna.ojo_m >= 1.5 && luna.ojo_m <= 3 && /no haze/.test(pl), `(c) Moon ground view eye ${luna?.ojo_m.toFixed(2)} m, "${pl}"`, `(c) Moon ground view ${JSON.stringify(luna)} "${pl}"`);
  await pag.screenshot({ path: join(SALIDA, 'c-suelo-pareja.png') });
  await ctx.close();

  // ---------- (e) teselas cortadas ----------
  {
    const { pag, ctx } = await pagina(1600, 900, 'tiles cut', { red: 'cortada' });
    await abrir(pag, `?lugar=${LAT},${LON}`);
    const e = await panelA(pag);
    comprobar(e.escena && e.id === INDICE.pareja_inicial.tierra && /could not be built/.test(e.aviso ?? '') && !e.dinamico && e.colores >= 20,
      `(e) tiles cut → "${e.aviso}" and catalogue terrain ${e.id}`, `(e) fallback: ${JSON.stringify(e)}`);
    await pag.screenshot({ path: join(SALIDA, 'e-sin-teselas.png') });
    await ctx.close();
  }

  // ---------- (f) sin lugar ----------
  {
    const { pag, ctx, cuenta } = await pagina(1600, 900, 'no place');
    await abrir(pag, '');
    const f = await panelA(pag);
    const b = await pag.evaluate(() => window.__az.paneles[1].id);
    comprobar(f.id === INDICE.pareja_inicial.tierra && b === INDICE.pareja_inicial.luna && !f.dinamico && !f.muestreo && !f.aviso && f.ventana.length === 0 && cuenta.externos === 0,
      `(f) no place → ${f.id} | ${b}, no window selector, no outside requests, "${f.notaEscala}"`, `(f) ${JSON.stringify({ f, b, externos: cuenta.externos })}`);
    await pag.screenshot({ path: join(SALIDA, 'f-sin-lugar-1600.png') });
    await pag.setViewportSize({ width: 1280, height: 800 });
    await pag.waitForTimeout(800);
    await pag.screenshot({ path: join(SALIDA, 'f-sin-lugar-1280.png') });
    await ctx.close();
  }

  // ---------- (g) móvil + (h) contraste ----------
  {
    const { pag, ctx } = await pagina(390, 844, 'mobile', { movil: true });
    await abrir(pag, `?lugar=${LAT},${LON}&nombre=${encodeURIComponent(NOMBRE)}`);
    const g = await pag.evaluate(() => ({ ancho: document.documentElement.scrollWidth, lienzo: document.querySelector('.panel[data-lado=a] .lienzo').getBoundingClientRect().toJSON(), colores: window.__az.paneles[0].escena.muestraLienzo().colores }));
    comprobar(g.ancho <= 390 && g.lienzo.width >= 360 && g.lienzo.height >= 360 && g.colores >= 20, `(g) 390×844: no sideways scroll, canvas ${g.lienzo.width.toFixed(0)}×${g.lienzo.height.toFixed(0)} first on screen (top ${g.lienzo.top.toFixed(0)})`, `(g) mobile layout ${JSON.stringify(g)}`);
    await pag.screenshot({ path: join(SALIDA, 'g-movil.png') });
    await pag.tap(`${A} .suelo`);
    await pag.waitForTimeout(600);
    const sm = await suelo(pag);
    comprobar(sm && sm.ojo_m >= 1.5 && sm.ojo_m <= 3, `(g) mobile ground view eye ${sm?.ojo_m.toFixed(2)} m`, `(g) mobile ground view ${JSON.stringify(sm)}`);
    await pag.evaluate(() => document.querySelector('.panel[data-lado=a] .lienzo').scrollIntoView());
    await pag.screenshot({ path: join(SALIDA, 'g-movil-suelo.png') });
    await pag.evaluate(() => document.querySelector('.panel[data-lado=a] .lado').scrollIntoView());
    await pag.screenshot({ path: join(SALIDA, 'g-movil-panel.png') });
    // (h) colores calculados en la página.
    const rgb = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const css = await pag.evaluate(() => {
      const cs = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
      return { pild: [cs('.panel[data-lado=a] .pildora-suelo', 'color'), cs('.panel[data-lado=a] .pildora-suelo', 'backgroundColor')],
        lado: [cs('.panel[data-lado=a] .tarjeta h2', 'color'), cs('.panel[data-lado=a] .lado', 'backgroundColor')], muestreo: cs('.panel[data-lado=a] .muestreo', 'color') };
    });
    const pares = [
      ['ground view pill', rgb(css.pild[0]).slice(0, 3), rgb(css.pild[1]).slice(0, 3)],
      ['side panel title over the gradient (lightest corner)', rgb(css.lado[0]).slice(0, 3), mezclar(rgb(css.lado[1]).slice(0, 3), rgb(css.lado[1])[3] ?? 1, 'electric-blue')],
      ['sampling note over the gradient (lightest corner)', rgb(css.muestreo).slice(0, 3), mezclar(rgb(css.lado[1]).slice(0, 3), rgb(css.lado[1])[3] ?? 1, 'electric-blue')],
    ];
    for (const [uso, tx, fo] of pares) { const c = contraste(tx, fo); comprobar(c >= 4.5, `(h) ${uso}: ${c.toFixed(2)}:1`, `(h) ${uso}: ${c.toFixed(2)}:1`); }
    for (const p of PAREJAS.filter((x) => /^terrain viewer: (side panel|ground view|"your place)/.test(x.uso))) { const c = contraste(p.texto, p.fondo); comprobar(c >= 4.5, `(h) contraste.js — ${p.uso}: ${c.toFixed(2)}:1`, `(h) ${p.uso}: ${c.toFixed(2)}:1`); }
    await ctx.close();
  }

  // ---------- Suelo con su color y equipo de la misión ----------
  const CAT_MISION = JSON.parse(readFileSync(join(WEB, 'data/equipo_mision.json'), 'utf8'));
  const eqMision = (m, id) => equiposDeMision(CAT_MISION, m).find((q) => q.id === id);
  const Q = `?lugar=${LAT},${LON}&nombre=${encodeURIComponent(NOMBRE)}&vista=suelo`;
  const { t: tS } = esperadoLugar(LAT, LON, 10);
  const nS = tS.meta.n, kS = (nS - 1) / 2;
  // De pie a dx_m al este (negativo = oeste) del lugar, mirando al suelo: fracción ocre (r > b) y azul (b > r) en el tercio de abajo.
  // La imagen sintética cambia de color en la longitud del lugar; el remuestreo la mezcla en unos 200 m alrededor.
  const colorSuelo = (pag, dx_m) => pag.evaluate((dx_m) => {
    const e = window.__az.paneles[0].escena, s = e.suelo, yaw = s.yaw, pitch = s.pitch;
    e.girarSuelo(Math.PI / 2 - yaw, 0);
    e.andarSuelo(dx_m);
    e.girarSuelo(0, -0.6 - s.pitch);
    e.dibujar(true);
    const gl = e.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    e.girarSuelo(0, -0.05 - s.pitch);
    e.andarSuelo(-dx_m);
    e.girarSuelo(yaw - s.yaw, pitch - s.pitch);
    let a = 0, b = 0, t = 0;
    for (let y = 2; y < Math.floor(h * 0.3); y += 3) for (let x = 0; x < w; x += 3) {
      const i = 4 * (y * w + x);
      t++;
      if (px[i] > px[i + 2] + 40) a++; else if (px[i + 2] > px[i] + 40) b++;
    }
    return { ocre: a / t, azul: b / t, x_km: e.estadoSuelo().x_km };
  }, dx_m);
  const plantarSuelo = async (pag, eq) => {
    await pag.click(`${A} .ver-paleta`);
    await pag.click(`${A} .paleta [data-eqm=${eq}]`);
    const r = await pag.evaluate(() => document.querySelector('.panel[data-lado=a] .lienzo').getBoundingClientRect().toJSON());
    await pag.mouse.click(r.left + r.width / 2, r.top + r.height * 0.8);
    await pag.waitForFunction((id) => window.__az.paneles[0].modelos.instancias().some((x) => x.equipo === id && x.enEscena), `mision:${eq}`, { timeout: 120000 });
    await pag.waitForTimeout(500);
    return pag.evaluate(async (url) => {
      const T = await import(url);
      const p = window.__az.paneles[0], e = p.escena, it = p.plantados.lista.at(-1);
      p.modelos.sincronizar(p.plantados.lista);
      const ins = p.modelos.instancias().find((x) => x.uid === it.uid), obj = p.modelos.grupo.children.find((o) => o.userData.uid === it.uid);
      const caja = new T.Box3().setFromObject(obj), tam = caja.getSize(new T.Vector3()).multiplyScalar(1000), c = caja.getCenter(new T.Vector3());
      const s = e.aPantalla(c), hoja = document.querySelector('.panel[data-lado=a] .hoja');
      return { ins, tam: [tam.x, tam.z, tam.y], dentro: !!s?.dentro, dist_m: e.camara.position.distanceTo(c) * 1000, suelo: !!e.suelo, sel: p.sel === it.uid,
        hojaVisible: !hoja.hidden, rotulo: hoja.querySelector('[data-volumen]')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
        fuentes: [...hoja.querySelectorAll('a')].filter((a) => a.textContent === 'source').length, citas: hoja.querySelectorAll('.cita q').length,
        supuesto: hoja.querySelector('.supuesto-mision')?.textContent ?? null, nota: window.__az.paneles[0].modelos.nota() };
    }, `${baseUrl}/lib/three/three.module.js`);
  };
  const cercaRel = (x, y, tol = 0.01) => Math.abs(x - y) <= tol * Math.max(Math.abs(y), 1e-9);
  {
    const { pag, ctx } = await pagina(1600, 900, 'ground colour');
    await abrir(pag, Q);
    const sat = await pag.evaluate(() => {
      const p = window.__az.paneles[0], A = '.panel[data-lado=a]';
      return { modo: p.modo, pulsado: document.querySelector(`${A} [data-modo=satelite]`)?.getAttribute('aria-pressed'), imagen: document.querySelector(`${A} [data-imagen]`)?.textContent ?? null,
        creditos: document.querySelector(`${A} [data-creditos]`)?.textContent ?? '', leyenda: !!document.querySelector(`${A} [data-leyenda=satelite]`), suelo: p.escena.estadoSuelo(),
        pildora: document.querySelector(`${A} .pildora-suelo`).textContent };
    });
    comprobar(sat.modo === 'satelite' && sat.pulsado === 'true' && sat.leyenda && sat.suelo, '(sat) &vista=suelo opens in ground view with Satellite colour pressed', `(sat) default mode ${JSON.stringify(sat)}`);
    comprobar(sat.imagen === TEXTO_IMAGEN && /Imagery: NASA GIBS, Blue Marble/.test(sat.creditos), `(sat) card: "${sat.imagen}" + imagery credit`, `(sat) card image line ${JSON.stringify(sat)}`);
    const oeste = await colorSuelo(pag, -1000), este = await colorSuelo(pag, 1000);
    comprobar(oeste.ocre > 0.8 && este.azul > 0.8 && Math.abs(este.x_km) < 1e-9, `(sat) ground at the feet takes the image colours: 1 km west ${(100 * oeste.ocre).toFixed(0)} % ochre, 1 km east ${(100 * este.azul).toFixed(0)} % blue`, `(sat) colours west ${JSON.stringify(oeste)} east ${JSON.stringify(este)}`);
    await pag.click(`${A} [data-modo=relieve]`);
    const r1 = await colorSuelo(pag, -1000), r2 = await colorSuelo(pag, 1000);
    comprobar(r1.ocre < 0.05 && r2.azul < 0.05, `(sat) Relief ignores the image (ochre ${(100 * r1.ocre).toFixed(0)} %, blue ${(100 * r2.azul).toFixed(0)} %)`, `(sat) Relief still coloured ${JSON.stringify({ r1, r2 })}`);
    await pag.click(`${A} [data-modo=satelite]`);
    await pag.screenshot({ path: join(SALIDA, 'sat-suelo.png') });
    const rN = rumboHorizonte(tS.altura, nS, tS.meta.m_por_px, kS, kS);
    comprobar(Math.abs(sat.suelo.rumbo_deg - rN.rumbo_deg) < 1e-6 && sat.pildora.includes(`facing ${Math.round(rN.rumbo_deg)}°`),
      `(rumbo) ground view faces ${sat.suelo.rumbo_deg}° = node ${rN.rumbo_deg}° (land rises ${rN.angulo_deg.toFixed(2)}° there)`, `(rumbo) page ${sat.suelo.rumbo_deg}° vs node ${rN.rumbo_deg}° · "${sat.pildora}"`);
    await ctx.close();
  }
  {
    const { pag, ctx } = await pagina(1600, 900, 'mission zoe');
    await abrir(pag, `${Q}&mision=biomarcadores`);
    const pal = await pag.evaluate(() => { const pal = document.querySelector('.panel[data-lado=a] .paleta'); return { primera: pal.firstElementChild?.className ?? null, cab: pal.querySelector('.mision-eq .clase')?.textContent ?? null, botones: [...pal.querySelectorAll('[data-eqm]')].map((b) => b.dataset.eqm), lunar: pal.querySelectorAll('[data-eq]').length }; });
    comprobar(pal.primera === 'mision-eq' && pal.cab === 'Equipment of this mission' && pal.botones.join() === 'zoe' && pal.lunar > 0, `(zoe) palette starts with "${pal.cab}" (${pal.botones}), then the ${pal.lunar} lunar systems`, `(zoe) palette ${JSON.stringify(pal)}`);
    const z = await plantarSuelo(pag, 'zoe');
    const f = formaPublicada(eqMision('biomarcadores', 'zoe'));
    const esperado = [f.largo_m, f.ancho_m, f.alto_m];
    comprobar(z.ins.factor === 1 && z.ins.generado === 'volumen' && z.tam.every((v, i) => cercaRel(v, esperado[i], 0.002)), `(zoe) planted box ${z.tam.map((v) => v.toFixed(2)).join(' × ')} m = catalogue ${esperado.join(' × ')} m, ×1`, `(zoe) box ${JSON.stringify(z)}`);
    comprobar(z.suelo && z.dentro && z.dist_m > 5 && z.dist_m < 25 && z.sel && z.hojaVisible, `(zoe) camera ${z.dist_m.toFixed(1)} m away in ground view, box in view, its sheet open`, `(zoe) camera ${JSON.stringify(z)}`);
    comprobar(z.rotulo === ROTULO.caja && z.fuentes >= 3 && z.citas >= 3 && /boxes and domes: published size/.test(z.nota ?? ''), `(zoe) "${z.rotulo}", ${z.fuentes} "source" links with ${z.citas} quotes; canvas note "${z.nota}"`, `(zoe) labels ${JSON.stringify(z)}`);
    await pag.screenshot({ path: join(SALIDA, 'zoe-suelo.png') });
    await ctx.close();
  }
  {
    const { pag, ctx } = await pagina(1600, 900, 'mission dome');
    await abrir(pag, `${Q}&mision=simulacion_larga`);
    const d = await plantarSuelo(pag, 'domo_hi_seas');
    const f = formaPublicada(eqMision('simulacion_larga', 'domo_hi_seas'));
    comprobar(cercaRel(d.tam[0], f.diametro_m, 0.002) && cercaRel(d.tam[1], f.diametro_m, 0.002) && cercaRel(d.tam[2], f.diametro_m / 2, 0.002) && d.rotulo === ROTULO.domo && /height not published/.test(d.supuesto ?? ''),
      `(domo) HI-SEAS dome ${d.tam.map((v) => v.toFixed(2)).join(' × ')} m (36 ft diameter), "${d.supuesto}"`, `(domo) ${JSON.stringify(d)}`);
    comprobar(d.dentro && d.dist_m > 15 && d.dist_m < 60, `(domo) camera ${d.dist_m.toFixed(1)} m from the dome, in view`, `(domo) camera ${JSON.stringify(d)}`);
    const lim = await pag.$eval(`${A} .hoja`, (h) => ({ lim: h.querySelector('.limites-mision .lim')?.textContent.replace(/\s+/g, ' ') ?? null, pend: h.querySelectorAll('[data-pendiente]').length }));
    comprobar(/Wind \(95th percentile\) ≤ 70 mph/.test(lim.lim ?? '') && /source/.test(lim.lim) && lim.pend === 0, `(domo) limit listed with its source, no verdict: "${lim.lim.slice(0, 60)}…"`, `(domo) limits ${JSON.stringify(lim)}`);
    await pag.screenshot({ path: join(SALIDA, 'domo-suelo.png') });
    await ctx.close();
  }
  {
    const { pag, ctx } = await pagina(1600, 900, 'mission SEV');
    await abrir(pag, `${Q}&mision=movilidad_rovers`);
    const sinBoton = await pag.evaluate(() => [...document.querySelectorAll('.panel[data-lado=a] [data-eqm-sin]')].map((x) => `${x.dataset.eqmSin}: ${x.querySelector('.est').textContent}`));
    comprobar(sinBoton.length === 1 && sinBoton[0] === 'k10: no published dimensions', `(sev) listed without a button: ${sinBoton.join(' · ')}`, `(sev) no-size list ${JSON.stringify(sinBoton)}`);
    const v = await plantarSuelo(pag, 'lunar_electric_rover');
    const sev = MODELOS.modelos.find((m) => m.fichero === 'modelos/sev.glb');
    const ord = (x) => [...x].sort((p, q) => p - q);
    comprobar(v.ins.fichero === 'modelos/sev.glb' && ord(v.tam).every((x, i) => cercaRel(x, ord(sev.medida_m)[i], 0.02)), `(sev) Lunar Electric Rover drawn with modelos/sev.glb, ${v.tam.map((x) => x.toFixed(2)).join(' × ')} m`, `(sev) model ${JSON.stringify(v)}`);
    comprobar(v.rotulo?.startsWith('SEV model shown in place of the Lunar Electric Rover (the SEV concept evolved from it)') && v.fuentes >= 1 && v.citas >= 1, `(sev) "${v.rotulo}"`, `(sev) label ${JSON.stringify(v)}`);
    await pag.screenshot({ path: join(SALIDA, 'sev-suelo.png') });
    await ctx.close();
  }
  {
    const { pag, ctx } = await pagina(1600, 900, 'mission scarecrow');
    await abrir(pag, `${Q}&mision=ruedas_en_arena&mes=7`);
    await pag.click(`${A} .ver-paleta`);
    const sc = await pag.evaluate(() => { const x = document.querySelector('.panel[data-lado=a] [data-eqm-sin=scarecrow]'); return x && { est: x.querySelector('.est').textContent, pend: x.querySelector('[data-pendiente]')?.textContent ?? null, fuente: [...x.querySelectorAll('a')].some((a) => a.textContent === 'source'), mes: /Calendar tab/.test(x.textContent), boton: !!document.querySelector('.panel[data-lado=a] [data-eqm=scarecrow]') }; });
    const lim = limitesDe(eqMision('ruedas_en_arena', 'scarecrow')).find((l) => l.parametro === 'pendiente_grados');
    const esperado = `${textoPendiente(pendienteGrados(tS.altura, nS, tS.meta.m_por_px, kS, kS), lim, tS.meta.m_por_px).texto} · at the centre of the window (your place)`;
    comprobar(sc && !sc.boton && sc.est === 'not enough published dimensions (no width or height)' && sc.pend === esperado && sc.fuente && sc.mes,
      `(scarecrow) "${sc?.est}" · "${sc?.pend}"`, `(scarecrow) ${JSON.stringify(sc)} vs "${esperado}"`);
    await pag.screenshot({ path: join(SALIDA, 'scarecrow-paleta.png') });
    await ctx.close();
  }
  {
    // Misión sin equipos y catálogo con 404: la paleta es la de siempre.
    const paleta = async (q, cortar = false) => {
      const { pag, ctx } = await pagina(1600, 900, `palette ${q}`, { tolerar: cortar ? /status of 404/ : null });
      if (cortar) await pag.route('**/data/equipo_mision.json', (r) => r.fulfill({ status: 404, body: '' }));
      await abrir(pag, q);
      const h = await pag.$eval(`${A} .paleta`, (p) => p.innerHTML);
      await ctx.close();
      return h;
    };
    const base = await paleta(Q);
    const vacia = await paleta(`${Q}&mision=polimeros_sellos`), rota = await paleta(`${Q}&mision=biomarcadores`, true);
    comprobar(!base.includes('mision-eq') && vacia === base && rota === base, '(sin equipo) mission without equipment and equipo_mision.json 404 → same palette as without &mision', `(sin equipo) palettes differ: ${vacia === base} ${rota === base}`);
  }
  {
    const { pag, ctx } = await pagina(390, 844, 'mission mobile', { movil: true });
    await abrir(pag, `${Q}&mision=biomarcadores`);
    await pag.tap(`${A} .ver-paleta`);
    const m = await pag.evaluate(() => ({ ancho: document.documentElement.scrollWidth, sec: document.querySelector('.panel[data-lado=a] .mision-eq')?.getBoundingClientRect().width ?? 0, modo: window.__az.paneles[0].modo }));
    comprobar(m.ancho <= 390 && m.sec > 200 && m.sec <= 390 && m.modo === 'satelite', `(móvil) 390×844: no sideways scroll, mission list ${m.sec.toFixed(0)} px wide, Satellite colour`, `(móvil) ${JSON.stringify(m)}`);
    await pag.evaluate(() => document.querySelector('.panel[data-lado=a] .mision-eq').scrollIntoView());
    await pag.screenshot({ path: join(SALIDA, 'movil-mision.png') });
    await pag.evaluate(() => document.querySelector('.panel[data-lado=a] .lienzo').scrollIntoView());
    await pag.screenshot({ path: join(SALIDA, 'movil-suelo-satelite.png') });
    // Contraste: rótulo de acento y texto de la lista sobre el panel lateral (esquina más clara del degradado).
    const rgb = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const c = await pag.evaluate(() => ({ lado: getComputedStyle(document.querySelector('.panel[data-lado=a] .lado')).backgroundColor, nom: getComputedStyle(document.querySelector('.panel[data-lado=a] .mision-eq .nom')).color }));
    const fondo = mezclar(rgb(c.lado).slice(0, 3), rgb(c.lado)[3] ?? 1, 'electric-blue');
    const k = contraste(rgb(c.nom).slice(0, 3), fondo);
    comprobar(k >= 4.5, `(contraste) mission list name over the side panel: ${k.toFixed(2)}:1`, `(contraste) mission list name ${k.toFixed(2)}:1`);
    for (const p of PAREJAS.filter((x) => /^terrain viewer: mission/.test(x.uso))) { const r = contraste(p.texto, p.fondo); comprobar(r >= 4.5, `(contraste) contraste.js — ${p.uso}: ${r.toFixed(2)}:1`, `(contraste) ${p.uso}: ${r.toFixed(2)}:1`); }
    await ctx.close();
  }

  // ---------- (i) humo con red: Yungay ----------
  if (SIN_VIVO) console.log('SKIPPED live smoke test (--sin-vivo)');
  else {
    const { pag, ctx, cuenta } = await pagina(1600, 900, 'live', { red: 'viva' });
    await abrir(pag, '?lugar=-24.0883,-69.9946&nombre=Yungay%2C%20Atacama', 240000);
    const y = await panelA(pag);
    if (!y.dinamico) console.log(`SKIPPED (no network?): ${y.aviso}`);
    else {
      const m = await pag.evaluate(() => window.__az.paneles[0].escena.meta.muestreo);
      ok(`(i) live Yungay: ${m.teselas} elevation tiles at zoom ${m.zoom}, ${(m.descarga_bytes / 1024).toFixed(0)} KiB read with the imagery tiles (${cuenta.teselas} elevation tile responses seen); sources ${JSON.stringify(m.fuentes.fuentes.map((f) => f.nombre))}${m.fuentes.sin_dato ? `, ${m.fuentes.sin_dato} tiles without a known source` : ''}`);
      ok(`(i) live card: "${y.muestreo}"; centre ${y.centro.toFixed(1)} m, relief ${(y.z_max - y.z_min).toFixed(1)} m`);
      await pag.screenshot({ path: join(SALIDA, 'i-vivo-yungay.png') });
      await pag.click(`${A} .suelo`);
      await pag.waitForTimeout(800);
      await pag.screenshot({ path: join(SALIDA, 'i-vivo-yungay-suelo.png') });
    }
    await ctx.close();
  }
} catch (e) {
  falla(`script error: ${e.stack ?? e}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA_LUGAR: ${fallos.length} FAIL` : 'CAPTURA_LUGAR: ok');
process.exit(fallos.length ? 1 : 0);

// Portada y vista del mundo en Chromium con GPU: secciones con encaje, planeta que cambia, arrastre frente a clic,
// chincheta = función pura para ese píxel, sugerencias, paso a «Earth analogs», móvil, sin WebGL y consola limpia.
// Uso: node scripts/captura_portada.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import * as THREE from '../web/lib/three/three.module.js';
import { rayoEsfera, vectorALatLon, formatoLatLon, distanciaAngular } from '../web/explorar/geo.js';
import { decodificarPNG } from '../web/mapa/png.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'portada');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const MUNDOS = JSON.parse(await readFile(join(WEB, 'data/cuerpos/mundos.json'), 'utf8')).mundos;
const sug = (m, id) => MUNDOS.find((x) => x.id === m).sugerencias.find((s) => s.id === id);

const fallos = [];
const falla = (m) => { fallos.push(m); console.error(`FAIL ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);

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
const listoPortada = (pag) => pag.waitForFunction(() => window.__az?.portada?.listo === true, null, { timeout: 60000 });
const listoVista = (pag) => pag.waitForFunction(() => window.__az?.vista?.listo === true, null, { timeout: 60000 });
// waitForFunction toma una promesa por «verdadero»: se espera con evaluate en bucle.
async function esperarQue(pag, f, que, ms = 20000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await pag.evaluate(f, arg)) return; await pag.waitForTimeout(80); }
  throw new Error(`timeout waiting for ${que}`);
}
const quieta = (pag) => esperarQue(pag, () => new Promise((ok) => {
  const v = window.__az.vista, a = v.camara.position.clone();
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => ok(!v.animando() && v.camara.position.distanceTo(a) < 1e-12))));
}), 'the camera to stop');
const asentada = (pag) => esperarQue(pag, () => new Promise((ok) => {
  const c = document.getElementById('secciones'), a = c.scrollTop;
  setTimeout(() => ok(c.scrollTop === a && Math.abs(a / c.clientHeight - Math.round(a / c.clientHeight)) < 0.01), 250);
}), 'the scroll to settle');
// Tras una tecla o un clic del indicador: espera a estar quieta justo en la sección pedida.
const llegar = (pag, i) => esperarQue(pag, (i) => new Promise((ok) => {
  const c = document.getElementById('secciones'), a = c.scrollTop;
  setTimeout(() => ok(c.scrollTop === a && Math.abs(a - i * c.clientHeight) < 1), 120);
}), `section ${i}`, 8000, i).catch(async (e) => { falla(`${e.message}; at ${JSON.stringify(await estadoPortada(pag))}`); });
const estadoPortada = (pag) => pag.evaluate(() => {
  const P = window.__az.portada, c = document.getElementById('secciones');
  return { seccion: P.seccion, planeta: P.planeta, pos: c.scrollTop / c.clientHeight, actual: [...document.querySelectorAll('.indicador a')].findIndex((a) => a.getAttribute('aria-current') === 'true') };
});
// Disco del planeta i en pantalla (centro y radio en px) y caja del texto de su sección.
const discoYTexto = (pag, i) => pag.evaluate((i) => {
  const P = window.__az.portada, g = P.grupos[i], cam = P.camara, cv = document.getElementById('espacio');
  const c = g.position.clone().project(cam), e = g.position.clone().add(cam.up.clone().multiplyScalar(g.scale.x * (i === 2 ? 1.75 : 1))).project(cam);
  const px = (v) => ({ x: ((v.x + 1) / 2) * cv.clientWidth, y: ((1 - v.y) / 2) * cv.clientHeight });
  const pc = px(c), pe = px(e), t = document.querySelectorAll('.seccion .texto')[i].getBoundingClientRect();
  return { cx: pc.x, cy: pc.y, r: Math.hypot(pe.x - pc.x, pe.y - pc.y), texto: { left: t.left, right: t.right, top: t.top, bottom: t.bottom } };
}, i);
const choca = (d, t) => {
  const x = Math.max(t.left, Math.min(d.cx, t.right)), y = Math.max(t.top, Math.min(d.cy, t.bottom));
  return Math.hypot(x - d.cx, y - d.cy) < d.r;
};
const media = async (png, cx, cy, r) => {
  const im = await decodificarPNG(png), k = im.canales;
  let s = [0, 0, 0], n = 0;
  for (let y = Math.round(cy - r); y <= cy + r; y++) for (let x = Math.round(cx - r); x <= cx + r; x++) {
    const i = (y * im.ancho + x) * k;
    s = s.map((v, j) => v + im.datos[i + j]); n++;
  }
  return s.map((v) => v / n);
};

// Cámara de la página → píxel → rayo → esfera → lat/lon, todo en node con la función pura.
function latLonNode(cam, x, y) {
  const inv = new THREE.Matrix4().fromArray(cam.proyInv), mw = new THREE.Matrix4().fromArray(cam.mundo);
  const o = new THREE.Vector3().setFromMatrixPosition(mw);
  const p = new THREE.Vector3((x / cam.ancho) * 2 - 1, -(y / cam.alto) * 2 + 1, 0.5).applyMatrix4(inv).applyMatrix4(mw);
  const h = rayoEsfera(o, p.sub(o).normalize(), 1);
  return h ? vectorALatLon(h) : null;
}
const leerPunto = (pag) => pag.evaluate(() => ({ punto: window.__az.explorar.punto, lat: document.getElementById('lat').textContent, lon: document.getElementById('lon').textContent, nombre: document.getElementById('nombre-punto').textContent, paso2: !document.querySelector('[data-paso="2"]').hidden }));
const centroGlobo = (pag) => pag.evaluate(() => {
  const v = new window.__az.vista.camara.position.constructor(0, 0, 0).project(window.__az.vista.camara), cv = document.getElementById('globo');
  return { x: ((v.x + 1) / 2) * cv.clientWidth, y: ((1 - v.y) / 2) * cv.clientHeight };
});
const cajas = (pag, sel) => pag.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').map((e) => { const r = e.getBoundingClientRect(); return { sel: e.id || e.className || e.tagName, left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; }), sel);
const solapan = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

// Textura frente a imagen dibujada: correlación de luminancia en puntos visibles (y con la textura girada 180° como control).
async function texturaEnSuSitio(pag, mundo, puntos) {
  const muestras = await pag.evaluate(async ([url, puntos]) => {
    const img = new Image(); img.src = url; await img.decode();
    const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const lum = (lat, lon) => { let s = 0, n = 0; const x0 = Math.round(((lon + 180) / 360) * W), y0 = Math.round(((90 - lat) / 180) * H);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = ((x0 + dx) % W + W) % W, y = Math.max(0, Math.min(H - 1, y0 + dy)), i = (y * W + x) * 4; s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; } return s / n; };
    const tapas = ['panel', 'reiniciar', 'pista'].map((id) => document.getElementById(id)).filter((e) => e && !e.hidden).map((e) => e.getBoundingClientRect());
    return puntos.map(([lat, lon]) => {
      const s = window.__az.vista.aPantalla(lat, lon);
      const tapado = tapas.some((r) => s.x > r.left - 6 && s.x < r.right + 6 && s.y > r.top - 6 && s.y < r.bottom + 6);
      return { lat, lon, x: s.x, y: s.y, util: s.visible && !tapado && s.x > 4 && s.y > 60 && s.x < innerWidth - 4 && s.y < innerHeight - 4, tex: lum(lat, lon), giro: lum(lat, lon + 180) };
    });
  }, [`${baseUrl}/data/cuerpos/${MUNDOS.find((m) => m.id === mundo).textura}`, puntos]);
  const png = await pag.screenshot();
  const im = await decodificarPNG(png);
  const util = muestras.filter((m) => m.util);
  for (const m of util) {
    let s = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = ((Math.round(m.y) + dy) * im.ancho + Math.round(m.x) + dx) * im.canales; s += 0.2126 * im.datos[i] + 0.7152 * im.datos[i + 1] + 0.0722 * im.datos[i + 2]; n++; }
    m.pant = s / n;
  }
  const r = (a, b) => { const ma = a.reduce((x, y) => x + y) / a.length, mb = b.reduce((x, y) => x + y) / b.length; let sab = 0, saa = 0, sbb = 0; a.forEach((v, i) => { sab += (v - ma) * (b[i] - mb); saa += (v - ma) ** 2; sbb += (b[i] - mb) ** 2; }); return sab / Math.sqrt(saa * sbb); };
  return { n: util.length, r: r(util.map((m) => m.pant), util.map((m) => m.tex)), rGiro: r(util.map((m) => m.pant), util.map((m) => m.giro)) };
}
const rejilla = (lat0, lat1, lon0, lon1, paso) => { const p = []; for (let la = lat0; la <= lat1; la += paso) for (let lo = lon0; lo <= lon1; lo += paso) p.push([la, ((lo + 540) % 360) - 180]); return p; };

const comprobarDisco = async (pag, i, que) => {
  const d = await discoYTexto(pag, i);
  if (choca(d, d.texto)) falla(`${que}: planet disc (centre ${d.cx.toFixed(0)},${d.cy.toFixed(0)}, r ${d.r.toFixed(0)}) overlaps the text block ${JSON.stringify(d.texto)}`);
  else ok(`${que}: planet disc r ${d.r.toFixed(0)} px clear of the text block`);
};

try {
  // ---------- 1. Portada ----------
  const pag = await pagina(1440, 900, 'home');
  await pag.goto(`${baseUrl}/index.html`);
  await listoPortada(pag);
  const sec = await pag.evaluate(() => [...document.querySelectorAll('.seccion')].map((s) => ({ id: s.id, h: s.getBoundingClientRect().height, boton: s.querySelector('a.marca-boton')?.getAttribute('href') ?? null, titulo: s.querySelector('.nombre').textContent, frase: s.querySelector('.frase').textContent, credito: s.querySelector('.credito')?.textContent ?? null })));
  if (sec.map((s) => s.id).join() !== 'moon,mars,more' || sec.some((s) => Math.abs(s.h - 900) > 1)) falla(`sections: ${JSON.stringify(sec)}`);
  else ok(`3 full-screen sections: ${sec.map((s) => `${s.titulo} — "${s.frase}" → ${s.boton ?? 'no button'}`).join(' | ')}`);
  if (sec[2].boton !== null) falla('coming soon section should have no active button');
  if (!/NASA's Scientific Visualization Studio/.test(sec[0].credito) || !/NASA\/JPL\/USGS/.test(sec[1].credito)) falla(`credits: ${sec[0].credito} / ${sec[1].credito}`);
  const fuentes = await pag.evaluate(() => ({ titulo: getComputedStyle(document.querySelector('.nombre')).fontFamily, cuerpo: getComputedStyle(document.querySelector('.frase')).fontFamily, cargadas: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`) }));
  if (!/^"?Fira Sans/.test(fuentes.titulo) || !/^"?Overpass/.test(fuentes.cuerpo) || !fuentes.cargadas.some((f) => /Fira Sans 900/.test(f))) falla(`fonts: ${JSON.stringify(fuentes)}`);
  else ok(`fonts loaded: ${fuentes.cargadas.join(', ')}`);

  let e = await estadoPortada(pag);
  if (e.seccion !== 'moon' || e.planeta !== 'moon' || e.actual !== 0) falla(`start: ${JSON.stringify(e)}`);
  await comprobarDisco(pag, 0, 'desktop Moon');
  const d0 = await discoYTexto(pag, 0);
  const png0 = await pag.screenshot({ path: join(SALIDA, '01-portada-luna.png') });
  const c0 = await media(png0, d0.cx, d0.cy, d0.r * 0.4);

  await pag.keyboard.press('ArrowDown');
  await llegar(pag, 1);
  e = await estadoPortada(pag);
  if (e.seccion !== 'mars' || e.planeta !== 'mars' || e.actual !== 1 || Math.abs(e.pos - 1) > 0.01) falla(`ArrowDown → Mars: ${JSON.stringify(e)}`);
  else ok('↓ key snaps to Mars; side indicator on Mars');
  await comprobarDisco(pag, 1, 'desktop Mars');
  const d1 = await discoYTexto(pag, 1);
  const png1 = await pag.screenshot({ path: join(SALIDA, '02-portada-marte.png') });
  const c1 = await media(png1, d1.cx, d1.cy, d1.r * 0.4);
  const rojo = (c) => c[0] - c[2];
  if (!(Math.abs(rojo(c0)) < 12 && rojo(c1) > 20)) falla(`planet did not change: centre RGB Moon ${c0.map(Math.round)} Mars ${c1.map(Math.round)}`);
  else ok(`planet changes with the section: centre RGB Moon ${c0.map(Math.round)} (grey), Mars ${c1.map(Math.round)} (red)`);

  await pag.mouse.move(400, 450);
  await pag.mouse.wheel(0, 260);
  await pag.waitForTimeout(200);
  await asentada(pag);
  e = await estadoPortada(pag);
  if (Math.abs(e.pos - Math.round(e.pos)) > 0.01) falla(`a 260 px wheel should end on a whole section: ${JSON.stringify(e)}`);
  else ok(`a 260 px wheel ends on a whole section (${e.pos.toFixed(3)}, ${e.seccion}), never half-way`);
  await pag.mouse.wheel(0, 900);
  await pag.waitForTimeout(200);
  await asentada(pag);
  e = await estadoPortada(pag);
  if (Math.abs(e.pos - 2) > 0.01 || e.seccion !== 'more' || e.planeta !== 'more' || e.actual !== 2) falla(`wheel down to More worlds: ${JSON.stringify(e)}`);
  else ok('wheel down snaps to More worlds; planet = silhouettes');
  await comprobarDisco(pag, 2, 'desktop More worlds');
  await pag.screenshot({ path: join(SALIDA, '03-portada-mas-mundos.png') });
  await pag.keyboard.press('ArrowUp'); await llegar(pag, 1);
  await pag.keyboard.press('ArrowUp'); await llegar(pag, 0);
  e = await estadoPortada(pag);
  if (e.seccion !== 'moon' || e.planeta !== 'moon') falla(`↑↑ back to Moon: ${JSON.stringify(e)}`); else ok('↑ ↑ back to the Moon');
  await pag.click('.indicador a[data-i="1"]'); await llegar(pag, 1);
  e = await estadoPortada(pag);
  if (e.seccion !== 'mars') falla(`indicator click → Mars: ${JSON.stringify(e)}`); else ok('side indicator click → Mars');
  await pag.click('.indicador a[data-i="0"]'); await llegar(pag, 0);

  // ---------- 2. Botón de la Luna ----------
  await pag.click('#moon a.marca-boton');
  await pag.waitForURL(/\/explorar\/index\.html\?mundo=moon$/);
  await listoVista(pag);
  await quieta(pag);
  // Con criterios de sitio, la chincheta empieza en el mejor sitio calculado (captura_sitio.mjs lo compara con node); sin ellos, sin chincheta.
  const v0 = await pag.evaluate(() => ({ titulo: document.getElementById('nombre-mundo').textContent, textura: window.__az.vista.textura, chips: [...document.querySelectorAll('.sugerencia')].map((b) => b.textContent), mundo: window.__az.explorar.mundo, punto: window.__az.explorar.punto, auto: window.__az.vista.sitio?.r?.mejor ?? null, credito: document.getElementById('credito').textContent }));
  const pinInicial = v0.auto ? v0.punto?.lat === v0.auto.lat && v0.punto?.lon === v0.auto.lon : v0.punto === null;
  if (v0.titulo !== 'Moon' || v0.textura !== 'ok' || v0.mundo !== 'moon' || !pinInicial || !/^South pole/.test(v0.chips[0])) falla(`Moon view: ${JSON.stringify(v0)}`);
  else ok(`"Explore the Moon" opens the Moon view; pin ${v0.auto ? `on the computed best spot ${formatoLatLon(v0.punto.lat, v0.punto.lon).texto}` : 'not placed'}; chips: ${v0.chips.join(' | ')}`);
  const texL = await texturaEnSuSitio(pag, 'moon', rejilla(-80, 60, -80, 80, 7));
  if (!(texL.n >= 40 && texL.r > 0.6 && texL.r - texL.rGiro > 0.3)) falla(`Moon texture placement: ${JSON.stringify(texL)}`);
  else ok(`Moon: screen vs texture luminance r = ${texL.r.toFixed(3)} over ${texL.n} points (texture turned 180°: r = ${texL.rGiro.toFixed(3)})`);
  await pag.screenshot({ path: join(SALIDA, '04-luna-vista.png') });

  // ---------- 3. Arrastre frente a clic ----------
  const cg = await centroGlobo(pag);
  const camAntes = await pag.evaluate(() => window.__az.vista.camara.position.toArray());
  await pag.mouse.move(cg.x, cg.y);
  await pag.mouse.down();
  for (let k = 1; k <= 12; k++) await pag.mouse.move(cg.x + k * 14, cg.y + k * 4);
  await pag.mouse.up();
  await quieta(pag);
  const camTras = await pag.evaluate(() => window.__az.vista.camara.position.toArray());
  const giro = new THREE.Vector3(...camAntes).angleTo(new THREE.Vector3(...camTras)) / THREE.MathUtils.DEG2RAD;
  let p = await leerPunto(pag);
  if (!(giro > 5) || JSON.stringify(p.punto) !== JSON.stringify(v0.punto)) falla(`drag: turned ${giro.toFixed(1)}°, pin ${JSON.stringify(p.punto)} (should turn and leave the pin where it was, ${JSON.stringify(v0.punto)})`);
  else ok(`drag of 175 px turns the globe ${giro.toFixed(1)}° and does not move the pin`);

  const cg2 = await centroGlobo(pag);
  const clic = { x: Math.round(cg2.x + 70), y: Math.round(cg2.y + 55) };
  const cam = await pag.evaluate(() => window.__az.vista.camaraJSON());
  await pag.mouse.click(clic.x, clic.y);
  await pag.waitForTimeout(100);
  p = await leerPunto(pag);
  const nodo = latLonNode(cam, clic.x, clic.y), fN = formatoLatLon(nodo.lat, nodo.lon);
  const camDespues = await pag.evaluate(() => window.__az.vista.camaraJSON());
  if (!p.punto || p.lat !== fN.lat || p.lon !== fN.lon || distanciaAngular(p.punto.lat, p.punto.lon, nodo.lat, nodo.lon) > 1e-6 || camDespues.mundo.some((v, i) => Math.abs(v - cam.mundo[i]) > 1e-9)) falla(`click at ${clic.x},${clic.y}: screen ${p.lat}, ${p.lon} (${JSON.stringify(p.punto)}) ≠ node ${fN.texto} (${JSON.stringify(nodo)}); camera moved by ${Math.max(...camDespues.mundo.map((v, i) => Math.abs(v - cam.mundo[i])))}`);
  else ok(`click at ${clic.x},${clic.y} → screen "${p.lat}, ${p.lon}" = node pure function ${nodo.lat.toFixed(6)}, ${nodo.lon.toFixed(6)}; step 2 shown: ${p.paso2}`);
  const sp = await pag.evaluate(([la, lo]) => window.__az.vista.aPantalla(la, lo), [p.punto.lat, p.punto.lon]);
  if (!sp.visible || Math.hypot(sp.x - clic.x, sp.y - clic.y) > 2) falla(`pin drawn at ${sp.x.toFixed(1)},${sp.y.toFixed(1)}, clicked ${clic.x},${clic.y}`);
  else ok(`pin drawn where clicked (${Math.hypot(sp.x - clic.x, sp.y - clic.y).toFixed(2)} px)`);
  await pag.screenshot({ path: join(SALIDA, '05-luna-clic.png') });
  const clic2 = { x: clic.x - 120, y: clic.y - 90 };
  await pag.mouse.click(clic2.x, clic2.y);
  await pag.waitForTimeout(100);
  const p2 = await leerPunto(pag), n2 = latLonNode(cam, clic2.x, clic2.y);
  if (!p2.punto || distanciaAngular(p2.punto.lat, p2.punto.lon, n2.lat, n2.lon) > 1e-6) falla(`second click should move the pin to node ${JSON.stringify(n2)}: ${JSON.stringify(p2)}`);
  else ok(`second click moves the pin to ${p2.lat}, ${p2.lon}`);

  // ---------- 4. Polo sur ----------
  await pag.click('.sugerencia[data-id="polo_sur"]');
  await pag.waitForTimeout(100);
  await quieta(pag);
  p = await leerPunto(pag);
  const sP = await pag.evaluate(() => window.__az.vista.aPantalla(-90, 0));
  const panel = (await cajas(pag, '#panel'))[0];
  const llMarca = await pag.evaluate(([x, y]) => window.__az.vista.latLonDePixel(x, y), [sP.x, sP.y]);
  const pres = await pag.evaluate(() => document.querySelector('.sugerencia[data-id="polo_sur"]').getAttribute('aria-pressed'));
  if (!p.punto || Math.abs(p.punto.lat + 90) > 1e-9 || p.lat !== '90.00° S' || !sP.visible || sP.x < panel.right || pres !== 'true' || !(llMarca && llMarca.lat < -89.5)) falla(`south pole chip: ${JSON.stringify({ p, sP, llMarca, pres })}`);
  else ok(`south pole chip: pin at lat ${p.punto.lat} ("${p.lat}, ${p.lon}", "${p.nombre}"); the globe turned so the pin is on screen at ${sP.x.toFixed(0)},${sP.y.toFixed(0)}; that pixel reads lat ${llMarca.lat.toFixed(3)}`);
  await pag.screenshot({ path: join(SALIDA, '06-luna-polo-sur.png') });

  // ---------- 6. «Find Earth analogs» ----------
  const href = await pag.getAttribute('#buscar', 'href');
  await pag.click('#buscar');
  await pag.waitForURL(/\/analogos\/index\.html\?/);
  await pag.waitForFunction(() => window.__az?.analogos?.listo === true, null, { timeout: 120000 });
  const a = await pag.evaluate(() => ({ mundo: window.__az.analogos.mundo, lat: window.__az.analogos.lat, lon: window.__az.analogos.lon, nombre: window.__az.analogos.nombre, origen: document.getElementById('origen').textContent, url: location.search }));
  if (a.mundo !== 'moon' || a.lat !== -90 || a.lon !== 0 || a.nombre !== 'South pole' || !a.origen.includes(formatoLatLon(-90, 0).texto)) falla(`analogs page: ${JSON.stringify(a)} (href ${href})`);
  else ok(`"Find Earth analogs" → ${a.url}: "${a.origen}"`);
  await pag.screenshot({ path: join(SALIDA, '07-analogos.png') });
  await pag.goBack();
  await listoVista(pag);
  p = await leerPunto(pag);
  if (!p.punto || Math.abs(p.punto.lat + 90) > 1e-9) falla(`back from analogs: pin lost ${JSON.stringify(p)}`); else ok(`back from the analogs page keeps the pin (${p.lat}, ${p.lon})`);
  await pag.context().close();

  // ---------- 5. Marte con Jezero ----------
  const pm = await pagina(1440, 900, 'mars');
  await pm.goto(`${baseUrl}/explorar/index.html?mundo=mars`);
  await listoVista(pm);
  await quieta(pm);
  const tm = await pm.evaluate(() => window.__az.vista.textura);
  const texM = await texturaEnSuSitio(pm, 'mars', rejilla(-55, 60, 15, 130, 6));
  if (tm !== 'ok' || !(texM.n >= 40 && texM.r > 0.6 && texM.r - texM.rGiro > 0.3)) falla(`Mars texture placement: ${tm} ${JSON.stringify(texM)}`);
  else ok(`Mars: screen vs texture luminance r = ${texM.r.toFixed(3)} over ${texM.n} points (texture turned 180°: r = ${texM.rGiro.toFixed(3)})`);
  const syrtis = await pm.evaluate(() => [window.__az.vista.aPantalla(10, 70), window.__az.vista.aPantalla(-40, 70)]);
  const pngM = await pm.screenshot({ path: join(SALIDA, '08-marte-vista.png') });
  const lumS = await media(pngM, syrtis[0].x, syrtis[0].y, 6), lumH = await media(pngM, syrtis[1].x, syrtis[1].y, 6);
  const L = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  if (!(L(lumS) < L(lumH))) falla(`Syrtis Major (10N 70E) should be darker than Hellas (40S 70E) on screen: ${L(lumS).toFixed(0)} vs ${L(lumH).toFixed(0)}`);
  else ok(`on screen Syrtis Major (10° N 70° E) ${L(lumS).toFixed(0)} darker than Hellas (40° S 70° E) ${L(lumH).toFixed(0)}`);
  await pm.click('.sugerencia[data-id="jezero"]');
  await pm.waitForTimeout(100);
  await quieta(pm);
  p = await leerPunto(pm);
  const J = sug('mars', 'jezero');
  const sJ = await pm.evaluate(([la, lo]) => window.__az.vista.aPantalla(la, lo), [J.lat, J.lon]);
  const llJ = await pm.evaluate(([x, y]) => window.__az.vista.latLonDePixel(x, y), [sJ.x, sJ.y]);
  if (!p.punto || p.punto.lat !== J.lat || p.punto.lon !== J.lon || p.lat !== '18.38° N' || p.lon !== '77.58° E' || !sJ.visible || distanciaAngular(llJ.lat, llJ.lon, J.lat, J.lon) > 0.3) falla(`Jezero chip: ${JSON.stringify({ p, sJ, llJ })}`);
  else ok(`Jezero chip: pin ${p.lat}, ${p.lon}; drawn at ${sJ.x.toFixed(0)},${sJ.y.toFixed(0)}; that pixel reads ${llJ.lat.toFixed(3)}, ${llJ.lon.toFixed(3)}`);
  await pm.screenshot({ path: join(SALIDA, '09-marte-jezero.png') });
  await pm.click('#reiniciar');
  await pm.waitForTimeout(100);
  await quieta(pm);
  await pm.mouse.move(900, 450);
  await pm.mouse.wheel(0, -600);
  await pm.waitForTimeout(400);
  await quieta(pm);
  const zoom = await pm.evaluate(() => ({ d: window.__az.vista.camara.position.length(), min: window.__az.vista.controles.minDistance, max: window.__az.vista.controles.maxDistance }));
  if (!(zoom.d < zoom.max && zoom.d >= zoom.min - 1e-9)) falla(`wheel zoom: ${JSON.stringify(zoom)}`); else ok(`wheel zooms in (distance ${zoom.d.toFixed(2)}, limits ${zoom.min}–${zoom.max.toFixed(2)})`);
  await pm.screenshot({ path: join(SALIDA, '10-marte-ampliado.png') });
  await pm.context().close();

  // ---------- 7. Móvil (390 px) ----------
  const mov = await pagina(390, 844, 'mobile', { isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await mov.goto(`${baseUrl}/index.html`);
  await listoPortada(mov);
  for (const [i, nombre] of ['moon', 'mars', 'more'].entries()) {
    if (i) { await mov.evaluate((i) => document.getElementById('secciones').scrollTo({ top: i * innerHeight, behavior: 'instant' }), i); await mov.waitForTimeout(300); await asentada(mov); }
    await comprobarDisco(mov, i, `mobile ${nombre}`);
    const fuera = await mov.evaluate((i) => [...document.querySelectorAll(`.seccion:nth-child(${i + 1}) *, .marca-barra *`)].filter((el) => { const r = el.getBoundingClientRect(); return r.width && (r.left < -0.5 || r.right > innerWidth + 0.5); }).map((el) => el.className || el.tagName), i);
    const ancho = await mov.evaluate(() => document.documentElement.scrollWidth);
    if (fuera.length || ancho > 390) falla(`mobile ${nombre}: out of the screen ${JSON.stringify(fuera)}, scrollWidth ${ancho}`); else ok(`mobile ${nombre}: nothing past the 390 px edges`);
    await mov.screenshot({ path: join(SALIDA, `11-movil-portada-${nombre}.png`) });
  }
  await mov.evaluate(() => document.getElementById('secciones').scrollTo({ top: 0, behavior: 'instant' }));
  await mov.waitForTimeout(200);
  await mov.tap('#moon a.marca-boton');
  await mov.waitForURL(/\/explorar\//);
  await listoVista(mov);
  await quieta(mov);
  await mov.screenshot({ path: join(SALIDA, '12-movil-luna.png') });
  await mov.tap('.sugerencia[data-id="polo_sur"]');
  await mov.waitForTimeout(100);
  await quieta(mov);
  const m1 = await cajas(mov, '.marca-barra a, #panel, #reiniciar, #pista, #buscar');
  const sPm = await mov.evaluate(() => window.__az.vista.aPantalla(-90, 0));
  const pnl = m1.find((b) => b.sel.includes('panel')), bus = m1.find((b) => b.sel.includes('marca-boton')) ?? m1.find((b) => b.sel === 'buscar');
  const malos = [];
  for (const b of m1) if (b.left < -0.5 || b.right > 390.5 || b.top < -0.5 || b.bottom > 844.5) malos.push(`${b.sel} outside`);
  const tops = m1.filter((b) => ['reiniciar', 'pista'].includes(b.sel) || b.sel.includes('reiniciar') || b.sel.includes('pista'));
  for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) if (solapan(tops[i], tops[j])) malos.push(`${tops[i].sel} overlaps ${tops[j].sel}`);
  for (const t of tops) if (solapan(t, pnl)) malos.push(`${t.sel} overlaps the panel`);
  if (!sPm.visible || sPm.y > pnl.top - 8 || sPm.y < 60) malos.push(`pin at ${sPm.y.toFixed(0)} px hidden (panel top ${pnl.top.toFixed(0)})`);
  if (!bus || bus.bottom > 844) malos.push(`Find Earth analogs button not fully on screen ${JSON.stringify(bus)}`);
  if (malos.length) falla(`mobile view: ${malos.join('; ')}`);
  else ok(`mobile view: bar links, panel, Reset view, hint and "Find Earth analogs" inside 390×844 without overlaps; pin at ${sPm.x.toFixed(0)},${sPm.y.toFixed(0)} above the panel (top ${pnl.top.toFixed(0)})`);
  await mov.screenshot({ path: join(SALIDA, '13-movil-polo-sur.png') });
  const t0 = await mov.evaluate(() => window.__az.vista.camara.position.toArray());
  // Lejos del botón «… spots here · zoom in», que cae bajo la chincheta.
  await mov.touchscreen.tap(120, 205);
  await mov.waitForTimeout(150);
  const pTap = await leerPunto(mov);
  const t1 = await mov.evaluate(() => window.__az.vista.camara.position.toArray());
  if (!pTap.punto || pTap.punto.sugerencia === 'polo_sur' || t0.some((v, i) => Math.abs(v - t1[i]) > 1e-9)) falla(`mobile tap should move the pin without turning: ${JSON.stringify(pTap)}`);
  else ok(`mobile tap moves the pin to ${pTap.lat}, ${pTap.lon} ("${pTap.nombre}")`);
  await mov.context().close();

  // ---------- Sin WebGL y movimiento reducido ----------
  const sw = await pagina(1440, 900, 'no WebGL');
  await sw.addInitScript(() => { const o = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...r) { return /webgl/.test(t) ? null : o.call(this, t, ...r); }; });
  await sw.goto(`${baseUrl}/index.html`);
  await listoPortada(sw);
  const s1 = await sw.evaluate(() => ({ sin: document.body.classList.contains('sin-webgl'), botones: [...document.querySelectorAll('.seccion a.marca-boton')].map((b) => b.offsetParent !== null && b.getBoundingClientRect().width > 100) }));
  await sw.screenshot({ path: join(SALIDA, '14-sin-webgl.png') });
  await sw.click('#moon a.marca-boton');
  await listoVista(sw);
  await sw.click('.sugerencia[data-id="shoemaker"]');
  const s2 = await leerPunto(sw);
  if (!s1.sin || s1.botones.join() !== 'true,true' || !s2.punto || s2.lat !== '88.14° S') falla(`without WebGL: ${JSON.stringify({ s1, s2 })}`);
  else ok(`without WebGL: home shows both buttons; the view still takes a suggestion (${s2.nombre}: ${s2.lat}, ${s2.lon})`);
  await sw.context().close();

  const rm = await pagina(1440, 900, 'reduced motion', { reducedMotion: 'reduce' });
  await rm.goto(`${baseUrl}/index.html`);
  await listoPortada(rm);
  const giroRM = await rm.evaluate(() => new Promise((ok) => { const m = window.__az.portada.grupos[0].userData.eje.userData.malla, a = m.rotation.y; setTimeout(() => ok(m.rotation.y - a), 600); }));
  if (giroRM !== 0) falla(`reduced motion: the Moon still spins (${giroRM})`); else ok('prefers-reduced-motion: planets do not spin');
  await rm.context().close();
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA_PORTADA: ${fallos.length} failure(s)` : 'CAPTURA_PORTADA: ok');
process.exit(fallos.length ? 1 : 0);

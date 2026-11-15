// Pantalla del mundo (Chromium): (a) cada mundo lista solo sus misiones; una del otro mundo que llega en la URL se queda,
// rotulada; (b) Luna: los sitios que se pisan se anuncian con «+N more · zoom in» y al pulsarlo se ven los cinco;
// (c) Marte: al elegir misión salen sus puntos A–E = búsqueda al revés del motor en node, dentro de los límites del
// paso 2, y la chincheta va al A; (d) otra misión, otros puntos; (e) una chincheta puesta a mano no se mueve;
// (f) pulsar una letra lleva la chincheta; (g) quitar la misión quita los puntos; (h) Luna: puntos dentro de la zona puntuada.
// Uso: node scripts/captura_puntos_mision.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { cargar } from '../web/buscar/motor.js';
import { misionesDe, textoOpcion, activaDeCatalogo } from '../web/analogos/misiones.js';
import { distanciaKm, LETRAS } from '../web/explorar/mision_puntos.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'puntos_mision');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const fallos = [];
const comprobar = (cond, bien, mal) => { if (cond) console.log(`ok   ${bien}`); else { fallos.push(mal); console.error(`FAIL ${mal}`); } };

const servidor = createServer(async (req, res) => {
  const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = join(WEB, ruta.endsWith('/') ? `${ruta}index.html` : ruta);
  if (!f.startsWith(WEB)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': TIPOS[extname(f)] ?? 'application/octet-stream' }).end(await readFile(f)); } catch { res.writeHead(404).end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}`;
await mkdir(SALIDA, { recursive: true });

// Motor en node con los mismos ficheros.
const M = await cargar(`${join(WEB, 'data/cuerpos')}/`, async (ruta, tipo) => { const b = readFileSync(ruta); return tipo === 'json' ? JSON.parse(b.toString('utf8')) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
const MISIONES = JSON.parse(readFileSync(join(WEB, 'data/misiones.json'), 'utf8')).misiones;
const SITIOS = JSON.parse(readFileSync(join(WEB, 'data/sitios_ensayo.json'), 'utf8')).sitios;
const MUNDOS = JSON.parse(readFileSync(join(WEB, 'data/cuerpos/mundos.json'), 'utf8'));
const radio = (id) => (Array.isArray(MUNDOS) ? MUNDOS : MUNDOS.mundos).find((m) => m.id === id).radio_km;

const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pag = await nav.newPage({ viewport: { width: 1600, height: 1000 } });
pag.on('console', (m) => { if (m.type() === 'error') { fallos.push(`console: ${m.text()}`); console.error(`FAIL console: ${m.text()}`); } });
pag.on('pageerror', (e) => { fallos.push(`page error: ${e.message}`); console.error(`FAIL page error: ${e.message}`); });
const abrir = async (q) => {
  await pag.goto(`${base}/explorar/index.html?${q}`);
  await pag.waitForFunction(() => window.__az?.vista?.listo === true, null, { timeout: 120000 });
  await pag.waitForFunction(() => window.__az.vista.misionPuntos && window.__az.vista.misionPuntos.estado !== 'calculando', null, { timeout: 60000 });
  await pag.waitForTimeout(1200);
};
const elegir = async (id) => {
  await pag.selectOption('#mision', id);
  await pag.waitForFunction(() => window.__az.vista.misionPuntos && window.__az.vista.misionPuntos.estado !== 'calculando', null, { timeout: 60000 });
  await pag.waitForTimeout(1500);
};
const opciones = () => pag.$$eval('#mision option', (os) => os.map((o) => ({ v: o.value, t: o.textContent })));
const estado = () => pag.evaluate(async () => {
  const V = window.__az.vista, r = V.misionPuntos;
  return {
    pin: window.__az.explorar.punto, nombre: document.getElementById('nombre-punto').textContent, href: document.getElementById('buscar').getAttribute('href'),
    estado: r.estado, usados: r.usados ?? [], sin_capa: r.sin_capa ?? [],
    puntos: r.puntos.map((p) => ({ letra: p.letra, lat: p.lat, lon: p.lon, sim: p.similitud_pct })),
    caja: document.getElementById('mision-puntos').hidden ? null : document.getElementById('mision-puntos').textContent.replace(/\s+/g, ' ').trim(),
    lista: [...document.querySelectorAll('#mision-puntos .punto-mision')].map((b) => `${b.dataset.letra}:${b.getAttribute('aria-pressed')}`),
    letras: [...document.querySelectorAll('#opciones-mision button')].filter((b) => !b.hidden).map((b) => b.textContent),
    numeros: [...document.querySelectorAll('#opciones button[data-rango]')].filter((b) => !b.hidden).map((b) => b.textContent),
    juntos: (() => { const j = document.querySelector('#opciones .juntos'); return j && !j.hidden ? j.textContent : null; })(),
    errores: V.errores,
  };
});
// Lo que debe salir: candidatos del motor en node, de mejor a peor, separados; apta = función de la página (paso 2).
async function esperado(mundo, id, sep_km, apta, ambito = null) {
  const a = activaDeCatalogo(MISIONES.find((m) => m.id === id), M.indice, SITIOS);
  const ref = M.leerPunto('earth', a.referencia.lat, a.referencia.lon).valores;
  const r = M.parecidosEnCuerpo(mundo, ref, a.parametros, { filtro: ambito });
  const puntos = [];
  for (const c of r.candidatos) {
    if (puntos.length >= LETRAS.length) break;
    if (puntos.some((p) => distanciaKm(p, c, radio(mundo)) < sep_km)) continue;
    if (!(await apta(c.lat, c.lon))) continue;
    puntos.push(c);
  }
  return { r, puntos, activa: a };
}
const iguales = (a, b) => a.length === b.length && a.every((p, k) => Math.abs(p.lat - b[k].lat) < 1e-6 && Math.abs(p.lon - b[k].lon) < 1e-6 && Math.abs((p.sim ?? p.similitud_pct) - b[k].similitud_pct) < 1e-3);

try {
  // ---------- (a) listas por mundo ----------
  await abrir('mundo=moon');
  const quiero = (mundo, conservar = null) => ['', ...misionesDe(MISIONES, mundo, conservar).map((m) => m.id), 'nueva'];
  let op = await opciones();
  comprobar(JSON.stringify(op.map((o) => o.v)) === JSON.stringify(quiero('moon')) && !op.some((o) => /Mars only/.test(o.t)) && !op.some((o) => o.v === 'biomarcadores'), `(a) Moon lists ${op.length - 2} missions, none of them Mars-only`, `(a) Moon list: ${JSON.stringify(op)}`);

  // ---------- (b) Luna: sitios que se pisan ----------
  let e = await estado();
  comprobar(e.juntos && /^\+\d more · zoom in$/.test(e.juntos) && e.numeros.length < 4, `(b) from far away ${e.numeros.length} of the 4 other spots show, and a button says "${e.juntos}"`, `(b) far view: ${JSON.stringify({ n: e.numeros, j: e.juntos })}`);
  await pag.screenshot({ path: join(SALIDA, 'b-luna-lejos.png') });
  await pag.click('#opciones .juntos');
  await pag.waitForFunction(() => !window.__az.vista.animando(), null, { timeout: 10000 });
  await pag.waitForTimeout(600);
  e = await estado();
  const enPantalla = await pag.$$eval('#opciones button[data-rango]', (bs) => bs.filter((b) => !b.hidden).every((b) => { const r = b.getBoundingClientRect(); return r.left > 0 && r.top > 56 && r.right < innerWidth && r.bottom < innerHeight; }));
  comprobar(e.numeros.join() === '2,3,4,5' && !e.juntos && enPantalla, '(b) after the button: spots 2, 3, 4 and 5 are all on screen next to the pin (spot 1)', `(b) after zoom: ${JSON.stringify({ n: e.numeros, j: e.juntos, enPantalla })}`);
  await pag.screenshot({ path: join(SALIDA, 'b-luna-cerca.png') });

  // ---------- (h) Luna: puntos de misión dentro de la zona puntuada ----------
  await elegir('habitats_inflables');
  e = await estado();
  const aptaPag = (lat, lon) => pag.evaluate(([la, lo]) => window.__az.vista.sitioApi.apta(la, lo), [lat, lon]);
  const zona = await pag.evaluate(() => { const s = window.__az.vista.sitioApi; return { sep: s.separacion_km, limites: s.hayLimites, colat: (() => { let c = 0; for (let la = -90; la <= -80; la += 0.25) if (s.ambito(la, 0)) c = la; return c; })() }; });
  const qL = await esperado('moon', 'habitats_inflables', zona.sep, aptaPag, (la) => la <= zona.colat);
  comprobar(e.estado === 'ok' && iguales(e.puntos, qL.puntos) && e.puntos.every((p) => p.lat < -83), `(h) Moon, inflatable habitats: A–${e.puntos.at(-1)?.letra} = node (${e.puntos.map((p) => `${p.lat},${p.lon}`).join(' | ')}), all inside the south-pole area of step 2`, `(h) Moon mission spots: page ${JSON.stringify(e.puntos)} vs node ${JSON.stringify(qL.puntos.map((p) => [p.lat, p.lon, p.similitud_pct]))}`);
  comprobar(/inside the area searched in step 2/.test(e.caja ?? '') && /Where on the Moon this test fits/.test(e.caja) && e.nombre === 'Mission spot A', `(h) "${e.caja.slice(0, 150)}…"`, `(h) Moon text: ${e.caja} / ${e.nombre}`);
  await pag.screenshot({ path: join(SALIDA, 'h-luna-mision.png') });

  // ---------- (a) Marte + misión del otro mundo en la URL ----------
  await abrir('mundo=mars&mision=habitats_inflables');
  op = await opciones();
  comprobar(JSON.stringify(op.map((o) => o.v)) === JSON.stringify(quiero('mars', 'habitats_inflables')) && op.find((o) => o.v === 'habitats_inflables').t === 'Inflatable habitat testing — Moon only', '(a) a Moon mission that arrives in the URL stays in the Mars list, labelled "— Moon only"', `(a) Mars list with a Moon mission: ${JSON.stringify(op)}`);
  await abrir('mundo=mars');
  op = await opciones();
  comprobar(JSON.stringify(op.map((o) => o.v)) === JSON.stringify(quiero('mars')) && !op.some((o) => /Moon only/.test(o.t)) && op.every((o) => !o.v || o.v === 'nueva' || o.t === textoOpcion(MISIONES.find((m) => m.id === o.v), 'mars', M.indice)), `(a) Mars lists ${op.length - 2} missions, none of them Moon-only`, `(a) Mars list: ${JSON.stringify(op)}`);

  // ---------- (c) Marte: puntos de la misión ----------
  e = await estado();
  const pin0 = e.pin;
  comprobar(e.estado === 'sin_mision' && e.caja === null && !e.letras.length && e.nombre === 'Best spot', '(c) without a mission there are no lettered spots and the pin is the best base site', `(c) no mission: ${JSON.stringify(e)}`);
  await elegir('ruedas_en_arena');
  e = await estado();
  const sepM = await pag.evaluate(() => window.__az.vista.sitioApi.separacion_km);
  const q1 = await esperado('mars', 'ruedas_en_arena', sepM, aptaPag);
  comprobar(e.estado === 'ok' && e.puntos.length === 5 && iguales(e.puntos, q1.puntos), `(c) rover wheels on sand: A–E = node reverse search from ${q1.activa.referencia.nombre} (${e.puntos.map((p) => `${p.letra} ${p.lat},${p.lon} ${p.sim.toFixed(1)} %`).join(' | ')})`, `(c) page ${JSON.stringify(e.puntos)} vs node ${JSON.stringify(q1.puntos.map((p) => [p.lat, p.lon, p.similitud_pct]))}`);
  const lejos = e.puntos.every((p, i) => e.puntos.every((o, j) => i === j || distanciaKm(p, o, radio('mars')) >= sepM));
  comprobar(lejos && e.puntos.every((p) => Math.abs(p.lat) <= 50), `(c) the five are at least ${sepM} km apart and within NASA's 50° latitude limit`, `(c) separation or latitude: ${JSON.stringify(e.puntos)}`);
  comprobar(e.nombre === 'Mission spot A' && Math.abs(e.pin.lat - e.puntos[0].lat) < 1e-6 && Math.abs(e.pin.lon - e.puntos[0].lon) < 1e-6 && (e.pin.lat !== pin0.lat || e.pin.lon !== pin0.lon), `(c) the pin moved from the base site to mission spot A (${e.pin.lat}, ${e.pin.lon})`, `(c) pin: ${JSON.stringify({ pin: e.pin, nombre: e.nombre, pin0 })}`);
  const u = new URLSearchParams(e.href.split('?')[1]);
  comprobar(u.get('mision') === 'ruedas_en_arena' && Math.abs(+u.get('lat') - e.puntos[0].lat) < 1e-3 && Math.abs(+u.get('lon') - e.puntos[0].lon) < 1e-3, '(c) "Find Earth analogs" carries spot A and the mission', `(c) link ${e.href}`);
  comprobar(/Where on Mars this test fits/.test(e.caja) && /most like Dumont Dunes/.test(e.caja) && /in roughness, among those that meet NASA's limits in step 2\. Own metric, year averages\./.test(e.caja) && e.lista.join() === 'A:true,B:false,C:false,D:false,E:false', `(c) "${e.caja.slice(0, 170)}…"`, `(c) text: ${e.caja} / ${e.lista}`);
  await pag.waitForFunction(() => !window.__az.vista.animando(), null, { timeout: 10000 });
  await pag.screenshot({ path: join(SALIDA, 'c-marte-ruedas.png') });

  // ---------- (d) otra misión ----------
  await elegir('biomarcadores');
  const e2 = await estado();
  const q2 = await esperado('mars', 'biomarcadores', sepM, aptaPag);
  comprobar(e2.estado === 'ok' && iguales(e2.puntos, q2.puntos) && JSON.stringify(e2.puntos.map((p) => [p.lat, p.lon])) !== JSON.stringify(e.puntos.map((p) => [p.lat, p.lon])) && e2.nombre === 'Mission spot A' && Math.abs(e2.pin.lat - e2.puntos[0].lat) < 1e-6,
    `(d) another mission, other spots: life-detection instruments → ${e2.puntos.map((p) => `${p.letra} ${p.lat},${p.lon}`).join(' | ')}; the pin follows to its A`, `(d) page ${JSON.stringify(e2)} vs node ${JSON.stringify(q2.puntos.map((p) => [p.lat, p.lon]))}`);
  comprobar(/in daytime high/.test(e2.caja) && /Earth only, not on Mars: .*rock type\./.test(e2.caja), `(d) it says what Mars lacks: "${e2.caja.match(/Earth only[^.]*\./)?.[0]}"`, `(d) text: ${e2.caja}`);
  await pag.waitForFunction(() => !window.__az.vista.animando(), null, { timeout: 10000 });
  await pag.screenshot({ path: join(SALIDA, 'd-marte-biomarcadores.png') });

  // ---------- (f) pulsar una letra ----------
  await pag.click('#mision-puntos .punto-mision[data-letra=C]');
  await pag.waitForFunction(() => !window.__az.vista.animando(), null, { timeout: 10000 });
  await pag.waitForTimeout(400);
  const e3 = await estado();
  comprobar(e3.nombre === 'Mission spot C' && Math.abs(e3.pin.lat - e2.puntos[2].lat) < 1e-6 && e3.lista.includes('C:true') && !e3.letras.includes('C'), '(f) clicking C in the list moves the pin there (its letter hides under the pin)', `(f) after C: ${JSON.stringify({ n: e3.nombre, pin: e3.pin, l: e3.lista, letras: e3.letras })}`);

  // ---------- (e) chincheta a mano ----------
  await pag.evaluate(() => window.__az.vista.fijarPunto(10, 20));
  await elegir('ruedas_en_arena');
  const e4 = await estado();
  comprobar(e4.nombre === 'Your pin' && e4.pin.lat === 10 && e4.pin.lon === 20 && e4.puntos.length === 5 && e4.letras.length > 0, '(e) a pin placed by hand stays where it is when the mission changes; the new spots are still offered', `(e) manual pin: ${JSON.stringify({ n: e4.nombre, pin: e4.pin, letras: e4.letras })}`);

  // ---------- (g) sin misión ----------
  await elegir('');
  const e5 = await estado();
  comprobar(e5.estado === 'sin_mision' && e5.caja === null && !e5.letras.length && e5.numeros.length > 0, '(g) back to no mission: the lettered spots go, the numbered base sites stay', `(g) no mission again: ${JSON.stringify({ estado: e5.estado, caja: e5.caja, letras: e5.letras, numeros: e5.numeros })}`);
  comprobar(!e5.errores.length, '(all) no errors logged by the page', `page errors: ${e5.errores.join('; ')}`);
} catch (err) {
  fallos.push(`script: ${err.message}`); console.error(err);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `\n${fallos.length} FAILED` : '\nall ok');
process.exit(fallos.length ? 1 : 0);

// Recuadro «What makes a good base site?» en Chromium con GPU: cálculo automático, mismo punto que optimo.js en node,
// regenerar con otros pesos y límites, «Your own pick», alternativas, Luna, punto en la URL, móvil, consola limpia
// y globo quieto (0 fotogramas en 3 s sin tocar). Uso: node scripts/captura_sitio.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, access } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { cargarIndice, cargarMundo, mejorSitio, ajustesPorDefecto, valoresEn, CUMPLE } from '../web/sitio/optimo.js';
import { lineaValores, rotuloRango, fraseUnPeso } from '../web/sitio/panel.js';
import { formatoLatLon } from '../web/explorar/geo.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'sitio');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

const fallos = [];
const falla = (m) => { fallos.push(m); console.error(`FAIL ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);

// ---------- Referencia en node ----------
const BASE = pathToFileURL(join(WEB, 'data/sitio') + '/').href;
const leer = async (url, tipo) => { const b = await readFile(new URL(url)); return tipo === 'json' ? JSON.parse(b.toString('utf8')) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
if (!(await access(new URL('indice.json', BASE)).then(() => true, () => false))) { console.log('CAPTURA_SITIO: web/data/sitio/indice.json not generated yet'); process.exit(1); }
const MUNDOS = JSON.parse(await readFile(join(WEB, 'data/cuerpos/mundos.json'), 'utf8')).mundos;
const IDX = await cargarIndice(BASE, leer);
const W = {};
for (const id of ['mars', 'moon']) W[id] = await cargarMundo(IDX, id, BASE, { radio_km: MUNDOS.find((m) => m.id === id).radio_km, leer });
const nodo = (id, aj) => mejorSitio(W[id], aj);
const igualPunto = (a, b) => a && b && Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9;
// Celda de Marte leída a mano de las capas (sin optimo.js) para comprobar los tres límites de NASA.
function limitesMarteAMano(lat, lon) {
  const g = IDX.mundos.mars.rejilla, f = Math.round((g.lat0 - lat) / g.paso_deg), c = Math.round((lon - g.lon0) / g.paso_deg);
  return IDX.mundos.mars.criterios.filter((x) => x.limite).map((x) => {
    const v = W.mars.capas[x.id][f * g.ancho + c];
    return { id: x.id, v, op: x.limite.op, limite: x.limite.valor, ok: Number.isFinite(v) && CUMPLE[x.limite.op](v, x.limite.valor) };
  });
}

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
async function esperarQue(pag, f, que, ms = 30000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await pag.evaluate(f, arg)) return; await pag.waitForTimeout(80); }
  throw new Error(`timeout waiting for ${que}`);
}
const listoVista = (pag) => pag.waitForFunction(() => window.__az?.vista?.listo === true, null, { timeout: 120000 });
const quieta = (pag) => esperarQue(pag, () => new Promise((ok) => {
  const v = window.__az.vista, a = v.camara.position.clone();
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => ok(!v.animando() && v.camara.position.distanceTo(a) < 1e-12))));
}), 'the camera to stop');
const estado = (pag) => pag.evaluate(() => {
  const S = window.__az.vista.sitio;
  const punto = window.__az.explorar.punto;
  return {
    estado: S.estado, n: S.n, ms: S.ms, rango: S.rango, propio: S.propio && { lat: S.propio.lat, lon: S.propio.lon, v: S.propio.v },
    mejor: S.r?.mejor ?? null, alternativas: S.r?.alternativas ?? [], aptas: S.r?.aptas ?? null, motivo: S.r?.motivo ?? null,
    punto, ajustes: S.ajustes,
    titulo: document.querySelector('#resultado .r-titulo')?.textContent ?? null,
    valores: document.querySelector('#resultado .r-valores')?.textContent ?? null,
    aptasTxt: [...document.querySelectorAll('#resultado .r-aptas')].map((p) => p.textContent),
    aviso: document.querySelector('#resultado .r-aviso')?.textContent ?? null,
    marcas: Object.fromEntries([...document.querySelectorAll('#resultado .item')].filter((s) => s.querySelector('.marca')).map((s) => [s.dataset.id, s.querySelector('.marca').classList.contains('cumple')])),
    visibles: [...document.querySelectorAll('#opciones button')].filter((b) => !b.hidden).map((b) => b.textContent),
    caja: !document.getElementById('sitio').hidden,
  };
});
// Cambia un control como lo haría el usuario y pulsa «Find the best spot»; espera al resultado nuevo.
async function regenerar(pag, cambio) {
  const n0 = (await estado(pag)).n;
  await pag.evaluate(cambio);
  await pag.click('#calcular');
  await esperarQue(pag, (n0) => window.__az.vista.sitio.n > n0 && !document.getElementById('calcular').disabled, 'the new best spot', 30000, n0);
  await pag.waitForTimeout(50);
  await quieta(pag);
  return estado(pag);
}
const deslizar = (id, v) => `(() => { const r = document.querySelector('.criterio[data-id="${id}"] input[type=range]'); r.value = '${v}'; r.dispatchEvent(new Event('input', { bubbles: true })); })()`;
const limite = (id, v) => `(() => { const n = document.querySelector('.criterio[data-id="${id}"] input[type=number]'); n.value = '${v}'; n.dispatchEvent(new Event('input', { bubbles: true })); })()`;
const casilla = (id, on) => `(() => { const c = document.querySelector('.criterio[data-id="${id}"] input[type=checkbox]'); if (c.checked !== ${on}) c.click(); })()`;
const ajustesDe = (e) => JSON.parse(JSON.stringify(e.ajustes));

function compararConNodo(que, e, id, aj) {
  const r = nodo(id, aj);
  if (!r.mejor) { falla(`${que}: node has no best site (${r.motivo})`); return r; }
  const sitios = [r.mejor, ...r.alternativas], dom = [e.mejor, ...e.alternativas];
  const iguales = sitios.length === dom.length && sitios.every((s, k) => igualPunto(s, dom[k]) && s.puntuacion === dom[k].puntuacion);
  const linea = lineaValores(W[id].criterios, r.mejor.valores);
  const titulo = `${rotuloRango(1)} · ${formatoLatLon(r.mejor.lat, r.mejor.lon).texto}`;
  if (!iguales || !igualPunto(e.punto, r.mejor) || e.valores !== linea || e.titulo !== titulo || e.aptas.n !== r.aptas.n) {
    falla(`${que}: page ${JSON.stringify({ punto: e.punto, mejor: e.mejor && [e.mejor.lat, e.mejor.lon], titulo: e.titulo, valores: e.valores, aptas: e.aptas })} ≠ node ${JSON.stringify({ mejor: [r.mejor.lat, r.mejor.lon], titulo, linea, aptas: r.aptas })}`);
  } else ok(`${que}: pin at ${titulo} = node; "${e.valores}"; ${e.aptasTxt.join(' ')}; options ${r.alternativas.map((s) => formatoLatLon(s.lat, s.lon).texto).join(' | ')}`);
  return r;
}

try {
  // ---------- 1-2. Portada → Marte: recuadro, cálculo automático, límites, = node ----------
  const pag = await pagina(1440, 900, 'Mars desktop');
  await pag.goto(`${baseUrl}/index.html`);
  await pag.waitForFunction(() => window.__az?.portada?.listo === true, null, { timeout: 60000 });
  // Portada: giro lento a ≤ 30 fotogramas por segundo y nada con la pestaña oculta.
  const fps = await pag.evaluate(async () => {
    const P = window.__az.portada, a = P.fotogramas;
    await new Promise((r) => setTimeout(r, 2000));
    const visible = (P.fotogramas - a) / 2;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const b = P.fotogramas;
    await new Promise((r) => setTimeout(r, 1000));
    const oculta = P.fotogramas - b;
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
    return { visible, oculta };
  });
  if (!(fps.visible > 5 && fps.visible <= 31) || fps.oculta !== 0) falla(`home page frame rate: ${JSON.stringify(fps)}`); else ok(`home page: slow spin at ${fps.visible} frames/s (≤ 30), 0 frames with the tab hidden`);
  await pag.keyboard.press('ArrowDown');
  await pag.waitForTimeout(900);
  await pag.click('#mars a.marca-boton');
  await pag.waitForURL(/\/explorar\/index\.html\?mundo=mars/);
  await listoVista(pag);
  await quieta(pag);
  let e = await estado(pag);
  const cab = await pag.evaluate(() => ({ titulo: document.querySelector('#criterios > summary').textContent.trim(), abierto: document.getElementById('criterios').open, ambito: document.getElementById('ambito').textContent, filas: [...document.querySelectorAll('.criterio')].map((f) => ({ id: f.dataset.id, limite: !!f.querySelector('input[type=number]'), peso: !!f.querySelector('input[type=range]'), nasa: !!f.querySelector('.nasa') })), nm: document.querySelectorAll('#no-medidos-lista li').length, propios: !document.getElementById('pesos-propios').hidden }));
  if (!e.caja || e.estado !== 'ok' || !cab.abierto || cab.titulo !== '1 What makes a good base site?' || cab.ambito !== IDX.mundos.mars.ambito || cab.filas.length !== IDX.mundos.mars.criterios.length || !cab.filas.every((f) => f.nasa)) falla(`Mars box: ${JSON.stringify({ e: e.estado, cab })}`);
  else ok(`Mars box open on arrival: "${cab.titulo}", ${cab.filas.map((f) => `${f.id}${f.limite ? ' [limit]' : ''}${f.peso ? ' [weight]' : ''}`).join(', ')}; ${cab.nm} not measured; own-weights line ${cab.propios}`);
  const aj0 = ajustesDe(e);
  if (JSON.stringify(aj0) !== JSON.stringify(ajustesPorDefecto(W.mars))) falla(`Mars default settings ${JSON.stringify(aj0)}`);
  const lm = limitesMarteAMano(e.punto.lat, e.punto.lon);
  if (!lm.every((x) => x.ok)) falla(`Mars best spot breaks a NASA limit (read by hand): ${JSON.stringify(lm)}`);
  else ok(`Mars best spot meets NASA's three limits, read by hand from the layers: ${lm.map((x) => `${x.id} ${x.v.toFixed(2)} ${x.op} ${x.limite}`).join(', ')}`);
  const rM = compararConNodo('Mars, default settings', e, 'mars', aj0);
  ok(`Mars computed in the worker in ${e.ms.toFixed(0)} ms; markers on screen: ${e.visibles.join(', ') || 'none'}`);
  await pag.screenshot({ path: join(SALIDA, '01-marte-auto.png') });

  // Cita de NASA
  await pag.click('.criterio[data-id="altitud_m"] .nasa');
  const cita = await pag.evaluate(() => { const c = document.querySelector('.criterio[data-id="altitud_m"] .cita'); return { visible: !c.hidden, txt: c.querySelector('blockquote').textContent, href: c.querySelector('a')?.href }; });
  const cAlt = IDX.mundos.mars.criterios.find((c) => c.id === 'altitud_m').cita;
  if (!cita.visible || cita.txt !== `“${cAlt.texto}”` || cita.href !== (cAlt.url ?? cAlt.fuente)) falla(`NASA says: ${JSON.stringify(cita)}`); else ok(`"NASA says" opens the literal quote with its source ${cita.href}`);
  await pag.screenshot({ path: join(SALIDA, '02-marte-cita.png') });
  await pag.click('.criterio[data-id="altitud_m"] .nasa');

  // ---------- 3. Pesos y límites: regenerar ----------
  // Marte trae un solo criterio de peso: sin deslizador, una frase que dice por qué se ordena.
  const pesosM = W.mars.criterios.filter((c) => c.tipo === 'peso' || c.tipo === 'limite+peso');
  const unPeso = await pag.evaluate(() => ({ sliders: document.querySelectorAll('.criterio input[type=range]').length, frase: document.getElementById('pesos-propios').textContent, visible: !document.getElementById('pesos-propios').hidden }));
  const fraseQ = fraseUnPeso(pesosM[0], true);
  if (pesosM.length !== 1 || unPeso.sliders !== 0 || unPeso.frase !== fraseQ || !unPeso.visible) falla(`Mars single weight: ${JSON.stringify(unPeso)} (expected "${fraseQ}")`);
  else ok(`Mars has one weighted criterion: no slider, the box says "${unPeso.frase}"; best spot = the lowest-neutron cell inside the limits: row ${rM.mejor.fila}, col ${rM.mejor.col} (pipeline reference row 80, col 78), ${(100 * rM.aptas.fracArea).toFixed(1)} % of the area meets the limits (pipeline 55.7 %)`);
  if (rM.mejor.fila !== 80 || rM.mejor.col !== 78) falla(`Mars best cell ${rM.mejor.fila},${rM.mejor.col} ≠ pipeline reference 80,78`);
  e = await regenerar(pag, limite('altitud_m', -3000));
  const rA = compararConNodo('Mars, elevation limit −3000 m', e, 'mars', ajustesDe(e));
  const nota = await pag.evaluate(() => document.querySelector('.criterio[data-id="altitud_m"] .nota').textContent);
  if (igualPunto(rA.mejor, rM.mejor) || !/^changed from NASA's/.test(nota)) falla(`changed limit: pin did not move or note "${nota}"`); else ok(`changing the elevation limit moves the pin; note "${nota}"`);
  await pag.screenshot({ path: join(SALIDA, '03-marte-limite-cambiado.png') });

  // ---------- 4. Apagar un límite ----------
  const antes = e.aptas.n;
  e = await regenerar(pag, casilla('lat_abs_deg', false));
  compararConNodo('Mars, latitude limit off', e, 'mars', ajustesDe(e));
  if (!(e.aptas.n > antes)) falla(`switching off the latitude limit: ${e.aptas.n} ≤ ${antes}`); else ok(`latitude limit off: ${antes} → ${e.aptas.n} cells meet the limits`);
  await pag.screenshot({ path: join(SALIDA, '04-marte-limite-apagado.png') });

  // ---------- 5. Chincheta a mano ----------
  await pag.evaluate(`${casilla('lat_abs_deg', true)}; ${limite('altitud_m', 2000)}`);
  const centro = await pag.evaluate(() => { const v = window.__az.vista, p = document.getElementById('panel').getBoundingClientRect(); return { x: (p.right + innerWidth) / 2, y: innerHeight / 2 + 60 }; });
  await pag.mouse.click(Math.round(centro.x), Math.round(centro.y));
  await esperarQue(pag, () => window.__az.vista.sitio.propio?.v !== undefined, 'own pick values');
  e = await estado(pag);
  const vN = valoresEn(W.mars, e.punto.lat, e.punto.lon, ajustesDe({ ajustes: await pag.evaluate(() => window.__az.vista.sitio.aj) }));
  const lineaN = W.mars.criterios.map((c) => {
    const base = lineaValores([c], vN.valores);
    return c.id in vN.cumple ? `${base}${vN.cumple[c.id] === null ? ' ?' : vN.cumple[c.id] ? ' ✓' : ' ✕'}` : base;
  }).join(' · ');
  if (e.rango !== null || e.titulo !== `Your own pick · ${formatoLatLon(e.punto.lat, e.punto.lon).texto}` || e.valores !== lineaN) falla(`own pick: ${JSON.stringify({ titulo: e.titulo, valores: e.valores })} ≠ node "${lineaN}"`);
  else ok(`own pick by click: "${e.titulo}" — "${e.valores}" = node valoresEn`);
  await pag.screenshot({ path: join(SALIDA, '05-marte-a-mano.png') });

  // ---------- 6. Alternativa 2 ----------
  e = await regenerar(pag, () => {});
  const alt = e.alternativas[0];
  await pag.evaluate(([la, lo]) => window.__az.vista.mirar({ lat: la, lon: lo }), [alt.lat, alt.lon]);
  await pag.waitForTimeout(50);
  await quieta(pag);
  const b2 = await pag.evaluate(() => { const b = document.querySelector('#opciones button[data-rango="2"]'); const r = b.getBoundingClientRect(); return { hidden: b.hidden, x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (b2.hidden) falla('marker 2 hidden after turning the globe to it');
  else {
    await pag.mouse.click(b2.x, b2.y);
    await pag.waitForTimeout(100);
    e = await estado(pag);
    if (e.rango !== 2 || !igualPunto(e.punto, alt) || !e.titulo.startsWith('Option 2 · ') || e.visibles.includes('2')) falla(`option 2: ${JSON.stringify({ rango: e.rango, punto: e.punto, titulo: e.titulo, visibles: e.visibles })}`);
    else ok(`clicking marker 2 moves the pin there: "${e.titulo}"; markers now ${e.visibles.join(', ')}`);
  }
  await pag.screenshot({ path: join(SALIDA, '06-marte-opcion-2.png') });

  // ---------- 11. Sin interacción: 0 fotogramas en 3 s ----------
  await quieta(pag);
  await pag.mouse.move(5, 5);
  await pag.waitForTimeout(3000);
  const f0 = await pag.evaluate(() => window.__az.vista.fotogramas());
  await pag.waitForTimeout(3000);
  const f1 = await pag.evaluate(() => window.__az.vista.fotogramas());
  if (f1 !== f0) falla(`idle world view drew ${f1 - f0} frames in 3 s`); else ok(`idle world view: 0 new frames in 3 s (total so far ${f1})`);
  const hidden = await pag.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const a = window.__az.vista.fotogramas();
    window.__az.vista.mirar({ lat: 0, lon: 0 });
    await new Promise((r) => setTimeout(r, 1500));
    const b = window.__az.vista.fotogramas();
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 1500));
    return { oculta: b - a, vuelta: window.__az.vista.fotogramas() - b };
  });
  if (hidden.oculta !== 0 || !(hidden.vuelta > 0)) falla(`hidden tab: ${JSON.stringify(hidden)}`); else ok(`hidden tab: 0 frames while hidden, ${hidden.vuelta} frames to finish the turn once visible`);
  await pag.context().close();

  // ---------- 7. Luna ----------
  const pl = await pagina(1440, 900, 'Moon desktop');
  await pl.goto(`${baseUrl}/explorar/index.html?mundo=moon`);
  await listoVista(pl);
  await quieta(pl);
  e = await estado(pl);
  const rL = compararConNodo('Moon, default settings', e, 'moon', ajustesDe(e));
  const vL = valoresEn(W.moon, e.punto.lat, e.punto.lon, ajustesDe(e));
  if (!(e.punto.lat <= -84) || !vL || !Number.isFinite(vL.valores.iluminacion)) falla(`Moon best spot outside the south-pole patch: ${JSON.stringify(e.punto)}`);
  else ok(`Moon best spot ${formatoLatLon(e.punto.lat, e.punto.lon).texto} is inside the south-pole patch (within 6° of the pole, cell with data); worker ${e.ms.toFixed(0)} ms`);
  await pl.screenshot({ path: join(SALIDA, '07-luna-auto.png') });
  e = await regenerar(pl, `${deslizar('pendiente_deg', 1)}; ${deslizar('iluminacion', 0.1)}; ${deslizar('dist_sombra_km', 0.1)}`);
  const rL2 = compararConNodo('Moon, slope matters most', e, 'moon', ajustesDe(e));
  if (igualPunto(rL2.mejor, rL.mejor)) falla('Moon: putting slope first did not move the pin'); else ok(`Moon: slope first moves the pin to ${formatoLatLon(rL2.mejor.lat, rL2.mejor.lon).texto}`);
  await pl.screenshot({ path: join(SALIDA, '08-luna-pendiente.png') });
  e = await regenerar(pl, `${deslizar('pendiente_deg', 0)}; ${deslizar('iluminacion', 0)}; ${deslizar('dist_sombra_km', 0)}`);
  if (e.mejor !== null || e.motivo !== 'sin_pesos' || !e.aviso) falla(`Moon all weights at zero: ${JSON.stringify({ mejor: e.mejor, motivo: e.motivo, aviso: e.aviso })}`); else ok(`all sliders at zero: "${e.aviso}"; pin stays`);
  // Tiempo en el hilo principal (la razón del worker).
  const tPrincipal = await pl.evaluate(async () => {
    const o = await import('/sitio/optimo.js');
    const idx = await o.cargarIndice('/data/sitio/');
    const out = {};
    for (const id of ['moon', 'mars']) {
      const M = await o.cargarMundo(idx, id, '/data/sitio/', { radio_km: id === 'moon' ? 1737.4 : 3389.5 });
      const t = []; for (let k = 0; k < 3; k++) { const t0 = performance.now(); o.mejorSitio(M, o.ajustesPorDefecto(M)); t.push(Math.round(performance.now() - t0)); }
      out[id] = t;
    }
    return out;
  });
  ok(`main-thread mejorSitio in the page (3 runs): Moon ${tPrincipal.moon.join(', ')} ms; Mars ${tPrincipal.mars.join(', ')} ms`);
  if (!(Math.max(...tPrincipal.mars) < 300)) falla(`Mars main thread ≥ 300 ms: ${tPrincipal.mars}`);
  await pl.context().close();

  // ---------- 8. Punto en la URL: no se mueve ----------
  const pu = await pagina(1440, 900, 'URL point');
  await pu.goto(`${baseUrl}/explorar/index.html?mundo=mars&lat=10.5000&lon=20.2500`);
  await listoVista(pu);
  await esperarQue(pu, () => window.__az.vista.sitio.propio?.v !== undefined, 'own pick values');
  e = await estado(pu);
  if (e.punto.lat !== 10.5 || e.punto.lon !== 20.25 || !e.mejor || !e.titulo.startsWith('Your own pick')) falla(`URL point moved or mislabelled: ${JSON.stringify({ punto: e.punto, titulo: e.titulo })}`);
  else ok(`arriving with lat/lon in the URL keeps the pin (${e.titulo}); best spot still computed and shown as marker 1: ${e.visibles.includes('1') ? 'on screen' : 'on the far side'}`);
  const bm = rM.mejor;
  await pu.goto(`${baseUrl}/explorar/index.html?mundo=mars&lat=${bm.lat.toFixed(4)}&lon=${bm.lon.toFixed(4)}`);
  await listoVista(pu);
  e = await estado(pu);
  if (e.rango !== 1 || !e.titulo.startsWith('Best spot')) falla(`back with the best spot in the URL: ${e.titulo}`); else ok(`URL point equal to the best spot (e.g. back from the analogs page) is labelled "${e.titulo}"`);
  await pu.screenshot({ path: join(SALIDA, '09-url-punto.png') });
  await pu.click('#buscar');
  await pu.waitForURL(/\/analogos\/index\.html\?/);
  await pu.waitForFunction(() => window.__az?.analogos?.listo === true, null, { timeout: 120000 });
  const an = await pu.evaluate(() => ({ lat: window.__az.analogos.lat, lon: window.__az.analogos.lon }));
  if (an.lat !== Number(bm.lat.toFixed(4)) || an.lon !== Number(bm.lon.toFixed(4))) falla(`Find Earth analogs with the best spot: ${JSON.stringify(an)}`); else ok(`"Find Earth analogs" opens the analogs page for the best spot (${an.lat}, ${an.lon})`);
  await pu.context().close();

  // ---------- 9. Móvil ----------
  const mv = await pagina(390, 844, 'mobile', { isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await mv.goto(`${baseUrl}/explorar/index.html?mundo=mars`);
  await listoVista(mv);
  await quieta(mv);
  e = await estado(mv);
  const mov = await mv.evaluate(() => {
    const malos = [], p = document.getElementById('panel').getBoundingClientRect();
    for (const x of document.querySelectorAll('#panel *, .marca-barra a, #reiniciar')) {
      if (x.closest('[hidden]') || !x.getClientRects().length || x.closest('details:not([open]) > :not(summary)')) continue;
      const r = x.getBoundingClientRect();
      if (r.width && (r.left < -0.5 || r.right > innerWidth + 0.5)) malos.push(`${x.id || x.className || x.tagName} x ${r.left.toFixed(0)}–${r.right.toFixed(0)}`);
    }
    if (document.documentElement.scrollWidth > innerWidth) malos.push(`page ${document.documentElement.scrollWidth} px wide`);
    const b = document.getElementById('calcular').getBoundingClientRect();
    return { malos, panelTop: p.top, cerrado: !document.getElementById('criterios').open, boton: { top: b.top, bottom: b.bottom, h: b.height } };
  });
  const pinM = await mv.evaluate(([la, lo]) => window.__az.vista.aPantalla(la, lo), [e.punto.lat, e.punto.lon]);
  if (mov.malos.length || !pinM.visible || pinM.y > mov.panelTop || !mov.cerrado || mov.boton.bottom > 844 || mov.boton.h < 44) falla(`mobile: ${JSON.stringify({ mov, pinM })}`);
  else ok(`mobile 390×844: bottom sheet from y=${mov.panelTop.toFixed(0)}, criteria folded, "Find the best spot" on screen (${mov.boton.top.toFixed(0)}–${mov.boton.bottom.toFixed(0)}), pin at ${pinM.x.toFixed(0)},${pinM.y.toFixed(0)} above the sheet`);
  await mv.screenshot({ path: join(SALIDA, '10-movil.png') });
  await mv.tap('#criterios > summary');
  await mv.waitForTimeout(200);
  await mv.screenshot({ path: join(SALIDA, '11-movil-criterios.png') });
  await mv.context().close();
} catch (err) {
  falla(`script: ${err.stack ?? err.message}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA_SITIO: ${fallos.length} failure(s)` : 'CAPTURA_SITIO: ok');
process.exit(fallos.length ? 1 : 0);

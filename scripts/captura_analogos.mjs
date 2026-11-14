// Resultados en la Tierra y pestaña Metrics en Chromium con GPU: recorrido desde la portada, lugares, porcentajes,
// valores por parámetro y grupos iguales a motor.js en node; capa de similitud; clic libre; móvil; consola limpia.
// Uso: node scripts/captura_analogos.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { cargar } from '../web/buscar/motor.js';
import { enlaceTerreno } from '../web/mapa/estado.js';
import { formatoLatLon } from '../web/explorar/geo.js';
import { NO_COMPARADO, grupoDe, fmtPct, formatoValor as formatoValorSup, celsius, masCercano, lineaContexto, fraseParcial, terrenoDelPunto, minMax, planoSup } from '../web/analogos/metricas.js';

// En pantalla los superíndices van en <sup>: su texto es el de planoSup.
const formatoValor = (v, u) => planoSup(formatoValorSup(v, u));

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'analogos');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

const fallos = [];
const falla = (m) => { fallos.push(m); console.error(`FAIL ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);

// ---------- Referencia en node ----------
const M = await cargar(join(WEB, 'data/cuerpos') + '/', async (ruta, tipo) => {
  const b = await readFile(ruta);
  return tipo === 'json' ? JSON.parse(b.toString('utf8')) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});
const P = Object.fromEntries(M.indice.parametros.map((p) => [p.id, p]));
const NOMBRES = { moon: 'Moon', mars: 'Mars' };
const SITIOS = JSON.parse(readFileSync(join(WEB, 'data/sitios_ensayo.json'), 'utf8')).sitios;
const IDX = JSON.parse(readFileSync(join(WEB, 'data/terreno/index.json'), 'utf8')).terrenos;
const TERRENOS = IDX.map((t) => { const m = JSON.parse(readFileSync(join(WEB, 'data/terreno', t.id, 'meta.json'), 'utf8')); return { ...t, lat: m.centro.lat, lon: m.centro.lon }; });
const MUNDOS = JSON.parse(readFileSync(join(WEB, 'data/cuerpos/mundos.json'), 'utf8')).mundos;
const sug = (m, id) => MUNDOS.find((x) => x.id === m).sugerencias.find((s) => s.id === id);
const nodo = (mundo, lat, lon) => M.buscar(M.leerPunto(mundo, lat, lon));
const terrenoEsperado = (mundo, lat, lon, x) => {
  const t = masCercano(x.lat, x.lon, TERRENOS.filter((t) => t.cuerpo === 'tierra'));
  if (!t) return null;
  const obj = mundo === 'moon' ? terrenoDelPunto(lat, lon, TERRENOS.filter((t) => t.cuerpo === 'luna'), M.indice.cuerpos.moon.radio_km) : null;
  return `../${enlaceTerreno(t.item.id, obj, TERRENOS.filter((t) => t.cuerpo === 'luna').map((t) => t.id)).href}`;
};

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
// waitForFunction toma una promesa por «verdadero»: se espera con evaluate en bucle.
async function esperarQue(pag, f, que, ms = 20000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await pag.evaluate(f, arg)) return; await pag.waitForTimeout(80); }
  throw new Error(`timeout waiting for ${que}`);
}
const listo = (pag) => pag.waitForFunction(() => window.__az?.analogos?.listo === true, null, { timeout: 120000 });
const quieta = (pag, clave = 'analogos') => esperarQue(pag, (clave) => new Promise((ok) => {
  const v = clave === 'analogos' ? window.__az.analogos.vista : window.__az.vista, a = v.camara.position.clone();
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => ok(!v.animando() && v.camara.position.distanceTo(a) < 1e-12))));
}), 'the camera to stop', 20000, clave);

const leerLugares = (pag, sel = '#lista') => pag.evaluate((sel) => [...document.querySelectorAll(`${sel} > .tarjeta`)].map((t) => ({
  num: t.querySelector('.num').textContent, pct: t.querySelector('.pct span').textContent, coords: t.querySelector('.coords').textContent,
  contexto: t.querySelector('.contexto').textContent, parcial: t.querySelector('.parcial')?.textContent ?? null,
  terreno: t.querySelector('a.marca-boton')?.getAttribute('href') ?? null,
})), sel);
const leerMetricas = (pag) => pag.evaluate(() => {
  const c = document.getElementById('metricas');
  return {
    total: c.querySelector('[data-v=total] span')?.textContent ?? null,
    que: c.querySelector('.met-que')?.textContent ?? null,
    grupos: Object.fromEntries([...c.querySelectorAll('.grupo')].map((g) => [g.dataset.grupo, [...g.querySelectorAll('.fila')].map((f) => ({
      id: f.dataset.id, objetivo: f.querySelector('[data-v=objetivo]').textContent, tierra: f.querySelector('[data-v=tierra]').textContent, desv: f.querySelector('[data-v=desv]').textContent,
    }))])),
    corte: [...c.querySelectorAll('.grupo .corte')].map((p) => p.textContent),
    noRepro: [...c.querySelectorAll('.no-repro li')].map((li) => ({ id: li.dataset.id, txt: li.textContent, objetivo: li.querySelector('[data-v=objetivo]')?.textContent, tierra: li.querySelector('[data-v=tierra]')?.textContent })),
    noComparado: [...c.querySelectorAll('.no-comparado li')].map((li) => li.textContent),
    noComparadoNota: c.querySelector('.no-comparado p')?.textContent ?? null,
    sinDato: c.querySelector('.sin-dato')?.textContent ?? null,
    lugar: c.querySelector('.met-lugar')?.textContent ?? null,
  };
});

function compararLugares(que, dom, esperado, mundo, lat, lon) {
  if (dom.length !== esperado.length) { falla(`${que}: ${dom.length} cards on screen, node has ${esperado.length}`); return; }
  esperado.forEach((x, k) => {
    const c = masCercano(x.lat, x.lon, SITIOS);
    const quiero = { pct: fmtPct(x.similitud_pct), coords: formatoLatLon(x.lat, x.lon).texto, contexto: lineaContexto(c), terreno: terrenoEsperado(mundo, lat, lon, x) };
    for (const [kk, v] of Object.entries(quiero)) if (dom[k][kk] !== v) falla(`${que} card ${k + 1} ${kk}: screen "${dom[k][kk]}" ≠ node "${v}"`);
  });
  ok(`${que}: ${dom.map((d) => `${d.num}. ${d.pct} ${d.coords}${d.terreno ? ' [terrain]' : ''}`).join(' | ')} = node`);
}

function compararMetricas(que, dom, x, r, mundo) {
  if (dom.total !== fmtPct(x.similitud_pct)) falla(`${que} total "${dom.total}" ≠ "${fmtPct(x.similitud_pct)}"`);
  if (!dom.que?.startsWith(`Average of the ${x.comparados} parameters we could compare`) || !/Our own metric — not a probability\./.test(dom.que)) falla(`${que} sentence: ${dom.que}`);
  const filas = Object.entries(dom.grupos).flatMap(([g, fs]) => fs.map((f) => ({ ...f, g })));
  const comparables = x.parametros.filter((p) => p.estado === 'ok' || p.estado === 'sin_dato_tierra');
  if (filas.length !== comparables.length) falla(`${que}: ${filas.length} rows, node has ${comparables.length}`);
  for (const p of comparables) {
    const f = filas.find((z) => z.id === p.id);
    if (!f) { falla(`${que}: row ${p.id} missing`); continue; }
    const quiero = { objetivo: formatoValor(p.valor_objetivo, P[p.id].unidad), tierra: formatoValor(p.valor_tierra, P[p.id].unidad), desv: p.desviacion_pct === null ? 'no data' : `${fmtPct(p.desviacion_pct)} off`, g: grupoDe(p.desviacion_pct) ?? 'sin' };
    for (const [k, v] of Object.entries(quiero)) if (f[k] !== v) falla(`${que} ${p.id} ${k}: screen "${f[k]}" ≠ node "${v}"`);
  }
  for (const [g, fs] of Object.entries(dom.grupos)) {
    const d = fs.map((f) => x.parametros.find((p) => p.id === f.id).desviacion_pct ?? Infinity);
    if (d.some((v, i) => i && v < d[i - 1])) falla(`${que} group ${g} not sorted by deviation: ${d.join(', ')}`);
  }
  if (!dom.corte.every((c) => /\(own cut-offs\)|not counted/.test(c))) falla(`${que}: cut-offs not labelled own: ${dom.corte.join(' | ')}`);
  for (const n of x.no_reproducibles) {
    const li = dom.noRepro.find((z) => z.id === n.id), u = P[n.id].unidad;
    const quiero = `${P[n.id].nombre}: ${NOMBRES[mundo]} ${formatoValor(n.valor_objetivo, u)}·Earth ${formatoValor(n.valor_tierra, u)}`;
    if (li?.txt !== quiero || li.objetivo !== formatoValor(n.valor_objetivo, u) || li.tierra !== formatoValor(n.valor_tierra, u)) falla(`${que} cannot reproduce ${n.id}: "${li?.txt}" ≠ "${quiero}"`);
    if (/%/.test(li?.txt ?? '')) falla(`${que}: a percentage in "Earth cannot reproduce this"`);
  }
  if (dom.noComparado.join() !== NO_COMPARADO.join() || dom.noComparadoNota !== 'no global layer in this version') falla(`${que} not compared yet: ${JSON.stringify(dom.noComparado)} ${dom.noComparadoNota}`);
  if (r.sin_dato.length && !dom.sinDato?.includes(P[r.sin_dato[0]].nombre)) falla(`${que}: no-data-at-your-point line missing`);
  if (!r.sin_dato.length && dom.sinDato) falla(`${que}: unexpected no-data line ${dom.sinDato}`);
  const resumen = Object.entries(dom.grupos).map(([g, fs]) => `${g}: ${fs.map((f) => `${f.id} ${f.desv}`).join(', ') || '—'}`).join(' / ');
  ok(`${que}: total ${dom.total}; ${resumen}; cannot reproduce: ${dom.noRepro.map((n) => n.txt).join(' | ')} = node`);
}

async function abrirResultados(pag) {
  await pag.waitForURL(/\/analogos\/index\.html\?/);
  await listo(pag);
  const e = await pag.evaluate(() => window.__az.analogos.errores);
  if (e.length) falla(`analogs page errors: ${e.join('; ')}`);
  await quieta(pag);
  return pag.evaluate(() => ({ mundo: window.__az.analogos.mundo, lat: window.__az.analogos.lat, lon: window.__az.analogos.lon, nombre: window.__az.analogos.nombre, origen: document.getElementById('origen').textContent }));
}
const verMetricas = async (pag) => { await pag.click('#tab-metricas'); await pag.waitForTimeout(250); };
const verLugares = async (pag) => { await pag.click('#tab-lugares'); await pag.waitForTimeout(250); };

try {
  // ---------- 1. Recorrido entero: portada → Marte → Jezero → Find Earth analogs ----------
  const pag = await pagina(1440, 900, 'Mars desktop');
  await pag.goto(`${baseUrl}/index.html`);
  await pag.waitForFunction(() => window.__az?.portada?.listo === true, null, { timeout: 60000 });
  await pag.click('#mars a.marca-boton');
  await pag.waitForURL(/\/explorar\/index\.html\?mundo=mars$/);
  await pag.waitForFunction(() => window.__az?.vista?.listo === true, null, { timeout: 60000 });
  await pag.click('.sugerencia[data-id="jezero"]');
  await pag.waitForFunction(() => !!window.__az.vista.ambiente && !document.getElementById('ambiente').hidden, null, { timeout: 120000 });
  const J = sug('mars', 'jezero');
  const amb = await pag.evaluate(() => Object.fromEntries([...document.querySelectorAll('#ambiente-valores dd')].map((d) => [d.dataset.id, d.textContent])));
  const vJ = M.leerPunto('mars', J.lat, J.lon).valores;
  const ambQ = { t_max_k: celsius(vJ.t_max_k), t_min_k: celsius(vJ.t_min_k), rugosidad_tan: formatoValor(vJ.rugosidad_tan, '1 (tangent)'), gravedad_m_s2: formatoValor(vJ.gravedad_m_s2, 'm/s2') };
  if (JSON.stringify(amb) !== JSON.stringify(ambQ)) falla(`"What it is like there": screen ${JSON.stringify(amb)} ≠ node ${JSON.stringify(ambQ)}`);
  else ok(`"What it is like there" at Jezero: ${Object.values(amb).join(' · ')} = node leerPunto`);
  await pag.screenshot({ path: join(SALIDA, '01-explorar-jezero-ambiente.png') });
  await pag.click('#buscar');
  const o1 = await abrirResultados(pag);
  if (o1.mundo !== 'mars' || o1.lat !== J.lat || o1.lon !== J.lon || o1.nombre !== J.nombre || o1.origen !== `Your place on Mars·${J.nombre}·${formatoLatLon(J.lat, J.lon).texto}`) falla(`header: ${JSON.stringify(o1)}`);
  else ok(`full path home → Mars → Jezero → results; header "${o1.origen.replace(/·/g, ' · ')}"`);

  // ---------- 2. Lugares = node ----------
  const rJ = nodo('mars', J.lat, J.lon);
  compararLugares('Jezero places', await leerLugares(pag), rJ.resultados, 'mars', J.lat, J.lon);
  const parcJ = await leerLugares(pag, '#lista-parciales');
  if (parcJ.length !== rJ.parciales.length || parcJ.some((d, k) => d.parcial !== fraseParcial(rJ.parciales[k]) || d.pct !== fmtPct(rJ.parciales[k].similitud_pct))) falla(`partly compared: ${JSON.stringify(parcJ)}`);
  else ok(`partly compared (folded): ${parcJ.map((d) => `${d.pct} "${d.parcial}"`).join(' | ')}`);
  const s0 = await pag.evaluate(([la, lo]) => window.__az.analogos.vista.aPantalla(la, lo), [rJ.resultados[0].lat, rJ.resultados[0].lon]);
  const panel = await pag.evaluate(() => document.getElementById('panel').getBoundingClientRect().left);
  if (!s0.visible || s0.x > panel) falla(`globe should face place 1: ${JSON.stringify(s0)}`); else ok(`globe turned to place 1 (marker at ${s0.x.toFixed(0)},${s0.y.toFixed(0)})`);
  await pag.screenshot({ path: join(SALIDA, '02-jezero-lugares.png') });
  await pag.click('#lista > .tarjeta[data-k="1"]');
  await pag.waitForTimeout(100);
  await quieta(pag);
  const s1 = await pag.evaluate(([la, lo]) => ({ s: window.__az.analogos.vista.aPantalla(la, lo), sel: window.__az.analogos.sel, num: document.querySelector('#numeros button[aria-current="true"]')?.textContent }), [rJ.resultados[1].lat, rJ.resultados[1].lon]);
  if (!s1.s.visible || s1.sel.k !== 1 || s1.num !== '2') falla(`card 2 should select place 2 and turn the globe: ${JSON.stringify(s1)}`); else ok('clicking card 2 selects place 2, its globe marker turns yellow and faces the camera');
  await pag.screenshot({ path: join(SALIDA, '03-jezero-lugar-2.png') });

  // ---------- 3. Metrics del primero ----------
  await pag.click('#lista > .tarjeta[data-k="0"]');
  await verMetricas(pag);
  compararMetricas('Jezero metrics place 1', await leerMetricas(pag), rJ.resultados[0], rJ, 'mars');
  await pag.screenshot({ path: join(SALIDA, '04-jezero-metrics.png') });
  const primera = await pag.evaluate(() => document.querySelector('#metricas .fila')?.dataset.id);
  await pag.click(`#metricas .fila[data-id="${primera}"] summary`);
  await pag.waitForTimeout(150);
  const det = await pag.evaluate((id) => { const d = document.querySelector(`#metricas .fila[data-id="${id}"] .detalle`); return { txt: d.textContent, enlaces: [...d.querySelectorAll('a')].map((a) => a.href) }; }, primera);
  const pp = P[primera];
  const fuentesUrl = [pp.fuentes.mars?.url, pp.fuentes.earth?.url].filter(Boolean);
  if (!det.txt.includes(pp.definicion) || (pp.aviso && !det.txt.includes(pp.aviso)) || fuentesUrl.some((u) => !det.enlaces.includes(u))) falla(`row ${primera} opened: ${JSON.stringify(det)}`);
  else ok(`row "${pp.nombre}" opens: definition, "Not quite the same measure", ${det.enlaces.length} source link(s)`);
  await pag.$eval(`#metricas .fila[data-id="${primera}"]`, (e) => e.scrollIntoView({ block: 'start' }));
  await pag.screenshot({ path: join(SALIDA, '05-jezero-fila-abierta.png') });
  await pag.click('#metricas .como summary');
  await pag.$eval('#metricas .no-repro', (e) => e.scrollIntoView({ block: 'center' }));
  await pag.waitForTimeout(150);
  await pag.screenshot({ path: join(SALIDA, '06-jezero-no-reproducible.png') });

  // ---------- 5. Capa de similitud ----------
  await verLugares(pag);
  await pag.click('#lista > .tarjeta[data-k="0"]');
  await quieta(pag);
  await pag.click('label.interruptor');
  await pag.waitForTimeout(300);
  const ley = await pag.evaluate(() => ({ on: window.__az.analogos.capa, visible: !document.getElementById('leyenda').hidden, min: document.getElementById('ley-min').textContent, max: document.getElementById('ley-max').textContent }));
  const mmJ = minMax(rJ.mapa);
  if (!ley.on || !ley.visible || ley.min !== fmtPct(mmJ.min) || ley.max !== fmtPct(mmJ.max)) falla(`similarity layer legend: ${JSON.stringify(ley)} ≠ node ${fmtPct(mmJ.min)}–${fmtPct(mmJ.max)}`);
  else ok(`"Show similarity everywhere": legend ${ley.min} – ${ley.max} = node min/max of the map`);
  await pag.screenshot({ path: join(SALIDA, '07-jezero-capa.png') });
  await pag.click('label.interruptor');
  await pag.waitForTimeout(200);
  if (await pag.evaluate(() => !document.getElementById('leyenda').hidden)) falla('legend should hide when the layer is off');
  await pag.context().close();

  // ---------- 4. Polo sur lunar: borde de Shackleton ----------
  const pl = await pagina(1440, 900, 'Moon desktop');
  await pl.goto(`${baseUrl}/explorar/index.html?mundo=moon`);
  await pl.waitForFunction(() => window.__az?.vista?.listo === true, null, { timeout: 60000 });
  await pl.click('.sugerencia[data-id="shackleton_borde"]');
  await pl.click('#buscar');
  const S = sug('moon', 'shackleton_borde');
  const o2 = await abrirResultados(pl);
  if (o2.nombre !== 'Shackleton rim' || o2.lat !== S.lat || o2.lon !== S.lon) falla(`Shackleton header: ${JSON.stringify(o2)}`);
  const rS = nodo('moon', S.lat, S.lon);
  const lS = await leerLugares(pl);
  compararLugares('Shackleton rim places', lS, rS.resultados, 'moon', S.lat, S.lon);
  const conTerreno = lS.filter((d) => d.terreno);
  ok(`Shackleton rim: terrain buttons ${conTerreno.map((d) => `${d.num} → ${d.terreno}`).join(', ') || 'none'}`);
  await pl.screenshot({ path: join(SALIDA, '08-shackleton-lugares.png') });
  await verMetricas(pl);
  compararMetricas('Shackleton rim metrics place 1', await leerMetricas(pl), rS.resultados[0], rS, 'moon');
  await pl.screenshot({ path: join(SALIDA, '09-shackleton-metrics.png') });
  await pl.$eval('#metricas .no-repro', (e) => e.scrollIntoView({ block: 'center' }));
  await pl.waitForTimeout(150);
  await pl.screenshot({ path: join(SALIDA, '10-shackleton-no-reproducible.png') });
  // Un lugar parcial en Metrics: su grupo «No Earth data here».
  if (rS.parciales.length) {
    await verLugares(pl);
    await pl.click('#parciales summary');
    await pl.click('#lista-parciales > .tarjeta[data-k="0"] button.marca-boton');
    await pl.waitForTimeout(250);
    compararMetricas('Shackleton rim metrics partly compared 1', await leerMetricas(pl), rS.parciales[0], rS, 'moon');
  }
  if (conTerreno.length) {
    await verLugares(pl);
    const href = conTerreno[0].terreno;
    await pl.click(`#lista a.marca-boton[href="${href}"]`);
    await pl.waitForURL(/\/terreno\/index\.html\?/);
    await pl.waitForFunction(() => window.__az?.listo === true, null, { timeout: 120000 });
    ok(`"Open detailed terrain" opens the viewer at ${new URL(pl.url()).search}`);
  }
  await pl.context().close();

  // ---------- 6. Punto de clic libre en Marte ----------
  const pc = await pagina(1440, 900, 'Mars free click');
  await pc.goto(`${baseUrl}/explorar/index.html?mundo=mars`);
  await pc.waitForFunction(() => window.__az?.vista?.listo === true, null, { timeout: 60000 });
  await quieta(pc, 'vista');
  await pc.mouse.click(860, 380);
  await pc.waitForTimeout(150);
  const libre = await pc.evaluate(() => window.__az.explorar.punto);
  if (!libre) throw new Error('free click placed no pin');
  await pc.click('#buscar');
  const o3 = await abrirResultados(pc);
  if (o3.nombre !== null || /·.*·.*·/.test(o3.origen) || Math.abs(o3.lat - libre.lat) > 5e-5 || Math.abs(o3.lon - libre.lon) > 5e-5) falla(`free click header: ${JSON.stringify(o3)} for pin ${JSON.stringify(libre)}`);
  const rL = nodo('mars', o3.lat, o3.lon);
  compararLugares(`free click ${formatoLatLon(o3.lat, o3.lon).texto} places`, await leerLugares(pc), rL.resultados, 'mars', o3.lat, o3.lon);
  await verMetricas(pc);
  compararMetricas('free click metrics place 1', await leerMetricas(pc), rL.resultados[0], rL, 'mars');
  await pc.screenshot({ path: join(SALIDA, '11-clic-libre-metrics.png') });
  await pc.context().close();

  // ---------- 7. Móvil ----------
  const mv = await pagina(390, 844, 'mobile', { isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await mv.goto(`${baseUrl}/analogos/index.html?mundo=mars&lat=${J.lat.toFixed(4)}&lon=${J.lon.toFixed(4)}&nombre=${encodeURIComponent(J.nombre)}`);
  await listo(mv);
  await quieta(mv);
  const fuera = async () => mv.evaluate(() => {
    const malos = [];
    for (const e of document.querySelectorAll('.marca-barra a, #panel, #mandos > *, .pestanas button, #lista .tarjeta, #leyenda')) {
      if (e.closest('[hidden]') || !e.getClientRects().length) continue;
      const r = e.getBoundingClientRect();
      if (r.left < -0.5 || r.right > innerWidth + 0.5) malos.push(`${e.id || e.className} x ${r.left.toFixed(0)}–${r.right.toFixed(0)}`);
    }
    const m = document.getElementById('mandos').getBoundingClientRect(), p = document.getElementById('panel').getBoundingClientRect(), l = document.getElementById('leyenda');
    if (m.bottom > p.top) malos.push('controls under the panel');
    if (!l.hidden) { const lr = l.getBoundingClientRect(); if (lr.bottom > p.top + 0.5 || lr.top < m.bottom - 0.5) malos.push(`legend overlaps (${lr.top.toFixed(0)}–${lr.bottom.toFixed(0)}, controls end ${m.bottom.toFixed(0)}, panel ${p.top.toFixed(0)})`); }
    const tabs = [...document.querySelectorAll('.pestanas button')].map((b) => b.getBoundingClientRect());
    if (tabs.some((t) => t.height < 44 || t.top < p.top || t.bottom > innerHeight)) malos.push('tabs smaller than 44 px or off screen');
    if (document.documentElement.scrollWidth > innerWidth) malos.push(`page ${document.documentElement.scrollWidth} px wide`);
    return malos;
  });
  let malos = await fuera();
  const g1 = await mv.evaluate(([la, lo]) => window.__az.analogos.vista.aPantalla(la, lo), [rJ.resultados[0].lat, rJ.resultados[0].lon]);
  const pTop = await mv.evaluate(() => document.getElementById('panel').getBoundingClientRect().top);
  if (!g1.visible || g1.y > pTop) malos.push(`place 1 not visible above the panel (${g1.y.toFixed(0)} vs ${pTop.toFixed(0)})`);
  if (malos.length) falla(`mobile places: ${malos.join('; ')}`); else ok(`mobile 390×844: globe on top with place 1 at ${g1.x.toFixed(0)},${g1.y.toFixed(0)}, tabs ≥ 44 px, nothing past the edges`);
  await mv.screenshot({ path: join(SALIDA, '12-movil-lugares.png') });
  await mv.tap('#tab-metricas');
  await mv.waitForTimeout(250);
  compararMetricas('mobile Jezero metrics', await leerMetricas(mv), rJ.resultados[0], rJ, 'mars');
  malos = await fuera();
  const filasFuera = await mv.evaluate(() => [...document.querySelectorAll('#metricas .fila, #metricas .grupo, #metricas .bloque')].filter((e) => { const r = e.getBoundingClientRect(); return r.left < -0.5 || r.right > innerWidth + 0.5; }).length);
  if (malos.length || filasFuera) falla(`mobile metrics: ${malos.join('; ')} ${filasFuera} rows past the edge`); else ok('mobile Metrics tab: every row inside 390 px');
  await mv.screenshot({ path: join(SALIDA, '13-movil-metrics.png') });
  await mv.tap('label.interruptor');
  await mv.waitForTimeout(300);
  malos = await fuera();
  if (malos.length) falla(`mobile layer on: ${malos.join('; ')}`); else ok('mobile layer on: legend between the controls and the panel');
  await mv.screenshot({ path: join(SALIDA, '14-movil-capa.png') });
  await mv.context().close();

  // ---------- Punto sin parámetros válidos en la URL ----------
  const pv = await pagina(1200, 800, 'bad url');
  await pv.goto(`${baseUrl}/analogos/index.html?mundo=venus&lat=10&lon=10`);
  await listo(pv);
  const bad = await pv.evaluate(() => ({ origen: document.getElementById('origen').textContent, estado: document.getElementById('estado').textContent, tabs: document.getElementById('pestanas').hidden }));
  if (bad.origen !== 'No place picked yet.' || !bad.tabs) falla(`bad URL: ${JSON.stringify(bad)}`); else ok(`bad URL (mundo=venus): "${bad.origen} ${bad.estado}"`);
  await pv.context().close();
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA_ANALOGOS: ${fallos.length} failure(s)` : 'CAPTURA_ANALOGOS: ok');
process.exit(fallos.length ? 1 : 0);

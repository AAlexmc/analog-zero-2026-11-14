// Generador de base en Chromium con GPU (haughton + shackleton_borde): cancelar, generar = generarBase en node,
// piezas plantadas con hoja, quitar una pieza, caso sin solución y Rehearse on Earth. Uso: node scripts/captura_base.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { generarBase } from '../web/terreno/base.js';
import { vehiculos, pendientes, caminoMinimo, medirRuta } from '../web/terreno/rutas.js';
import { medirPunto, medirSeparacion, evaluarEquipo } from '../web/terreno/evaluar.js';
import { fmt, constante } from '../web/terreno/panel_obra.js';
import { medidasBase, separacionPistaDefecto, piezasBase, opcionesBase, aligerar, trasplantar, filasEnsayo, resumenEnsayo, IDS_BASE, EQUIPO_BASE } from '../web/terreno/panel_base.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'base');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
// Criterio de la prueba (propio): una separación pista–hábitat mayor que el terreno de 10 km, para el caso sin solución.
const SEP_IMPOSIBLE_M = 20000;

const fallos = [];
const falla = (m) => { fallos.push(m); console.error(`FAIL ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);
const igual = (a, b, que) => {
  if (a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(b), 1))) return true;
  falla(`${que}: screen ${a} ≠ node ${b}`);
  return false;
};

// ---------- Datos y referencia en node ----------
const leerJson = (f) => JSON.parse(readFileSync(join(WEB, 'data', f), 'utf8'));
const CAT = leerJson('equipo.json'), OBRA = leerJson('obra.json'), CONC = leerJson('conceptos.json');
function leerTerreno(id) {
  const dir = join(WEB, 'data/terreno', id);
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const n = meta.n;
  const capa = (c) => {
    const b = readFileSync(join(dir, c.fichero));
    if (c.tipo === 'uint8') return Float32Array.from(b, (v) => (v === 255 ? NaN : v));
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  const capas = {};
  for (const [k, c] of Object.entries(meta.capas)) if (k !== 'altura') capas[k] = capa(c);
  return { meta, t: { n, m: meta.m_por_px, alturas: capa(meta.capas.altura), capas } };
}
const LUNA = leerTerreno('shackleton_borde');
const M = medidasBase(CAT, CONC), SEP = separacionPistaDefecto(CAT).valor, HIELO = constante(OBRA, 'hielo_superficie_temp_max_k').valor;
const LTV = vehiculos(CAT).find((v) => v.equipo.id === 'ltv');
function baseNode(activas, sep) {
  const t0 = performance.now();
  const r = aligerar(generarBase(LUNA.t, piezasBase(CAT, M, HIELO, activas), LTV, opcionesBase(M, sep, activas)));
  console.log(`node generarBase (${[...activas].join(', ')}; standoff ${sep} m): ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  return r;
}

// Ensayo en node: trasplante a haughton, requisitos evaluados con medirPunto/medirSeparacion/evaluarEquipo, lecturas con filasEnsayo.
const TIERRA = leerTerreno('haughton');
const eqDe = (id) => CAT.equipos.find((q) => q.id === id);
function evaluarEn(T, lista, item) {
  const eq = eqDe(item.equipo), med = medirPunto({ n: T.t.n, m_por_px: T.t.m, alturas: T.t.alturas, capas: T.t.capas, original: false }, item.fila, item.col, {});
  med.separacion_m = {};
  for (const r of eq.requisitos ?? []) if (r.variable === 'separacion_m' && r.respecto_a) med.separacion_m[r.respecto_a] = medirSeparacion(lista, item, r.respecto_a, T.t.m, (x) => x);
  return evaluarEquipo(eq, med);
}
function ensayoNode(rLuna, hab) {
  const tras = trasplantar(rLuna.piezas, LUNA.t.m, { n: TIERRA.t.n, m: TIERRA.t.m, agua: TIERRA.t.capas.agua ?? null }, hab);
  const listaL = rLuna.piezas.map((x, k) => ({ uid: k + 1, id: x.id, equipo: EQUIPO_BASE[x.id], fila: x.fila, col: x.col }));
  const listaT = tras.filter((t) => t.dentro).map((t, k) => ({ uid: 100 + k, id: t.id, equipo: EQUIPO_BASE[t.id], fila: t.fila, col: t.col }));
  const filas = filasEnsayo(tras.map((t) => {
    const iL = listaL.find((x) => x.id === t.id), iT = listaT.find((x) => x.id === t.id);
    return { id: t.id, eq: eqDe(EQUIPO_BASE[t.id]), evsLuna: evaluarEn(LUNA, listaL, iL), evsTierra: iT ? evaluarEn(TIERRA, listaT, iT) : null, motivoTierra: 'outside' };
  }));
  return { tras, filas, resumen: resumenEnsayo(filas) };
}
const pendT = pendientes(TIERRA.t.alturas, TIERRA.t.n, TIERRA.t.m);
const rutaNode = (o, d) => {
  const t = { n: TIERRA.t.n, m: TIERRA.t.m, alturas: TIERRA.t.alturas, pend: pendT, sombra: null, agua: TIERRA.t.capas.agua ?? null };
  const r = caminoMinimo(t, o, d, { limite: LTV.limite, factorSombra: 1 });
  return r.camino ? medirRuta(t, r.camino).longitud_m : null;
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
const B = '.panel[data-lado=b]', A = '.panel[data-lado=a]';
const Bb = (k) => `${B} .rutas .base [data-b="${k}"]`;

async function abrir(url) {
  const pag = await nav.newPage({ viewport: { width: 1600, height: 900 } });
  pag.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') falla(`console ${m.type()}: ${m.text()}`); });
  pag.on('pageerror', (e) => falla(`page error: ${e.message}`));
  pag.on('worker', (w) => w.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') falla(`worker console ${m.type()}: ${m.text()}`); }));
  await pag.goto(url);
  await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: 60000 });
  const errores = await pag.evaluate(() => window.__az.errores);
  if (errores.length) falla(`panel errors: ${errores.join('; ')}`);
  return pag;
}
const vista = (pag, lado, centro, alto_km, celdas) => pag.evaluate(([lado, centro, alto, celdas]) => new Promise((ok) => {
  const e = window.__az.paneles[lado].escena;
  const w = e.mundoDePixel(centro.f, centro.c);
  e.controles.target.set(w.x, w.y, w.z);
  e.camara.position.set(w.x, w.y + alto, w.z + alto * 0.35);
  e.controles.update();
  e.sucio = true;
  requestAnimationFrame(() => requestAnimationFrame(() => ok(celdas.map(({ f, c }) => {
    const s = e.aPantalla(e.mundoDePixel(f, c));
    return { x: s?.x, y: s?.y, dentro: !!s?.dentro };
  }))));
}), [lado, centro, alto_km, celdas]);
const generar = async (pag) => {
  await pag.evaluate(() => { window.__serie = window.__az.paneles[1].base.B.serie; });
  await pag.click(Bb('generar'));
  await pag.waitForFunction(() => { const b = window.__az.paneles[1].base.B; return b.serie !== window.__serie && !b.trabajo; }, null, { timeout: 240000 });
};
const leerBase = (pag) => pag.evaluate(() => {
  const p = window.__az.paneles[1], b = p.base.B, r = b.res?.r;
  const txt = (k) => p.el.querySelector(`.rutas .base [data-b="${k}"]`)?.textContent.replace(/\s+/g, ' ').trim() ?? null;
  const plantados = [...b.uids].map(([id, uid]) => ({ id, item: p.plantados.buscar(uid) }));
  return { r, estado: txt('estado'), dom: { busqueda: txt('busqueda'), rutas: txt('t-rutas'), pads: txt('t-pads'), roads: txt('t-roads'), sin: txt('sin-base'), restriccion: txt('restriccion'), pos: Object.fromEntries((r?.piezas ?? []).map((x) => [x.id, txt(`pos-${x.id}`)])) }, plantados };
});
function compararBase(s, nodeR, que) {
  const r = s.r;
  if (r.factible !== nodeR.factible) { falla(`${que}: feasible screen ${r.factible} ≠ node ${nodeR.factible}`); return; }
  if (!r.factible) {
    igual(r.restriccion.tipo, nodeR.restriccion.tipo, `${que} constraint type`);
    igual(r.restriccion.limite, nodeR.restriccion.limite, `${que} constraint limit`);
    igual(r.motivo, nodeR.motivo, `${que} reason`);
    return;
  }
  igual(r.piezas.length, nodeR.piezas.length, `${que} pieces`);
  for (const x of nodeR.piezas) {
    const y = r.piezas.find((q) => q.id === x.id);
    if (!y) { falla(`${que}: ${x.id} missing on screen`); continue; }
    igual(y.fila, x.fila, `${que} ${x.id} row`); igual(y.col, x.col, `${que} ${x.id} col`);
    if (s.dom.pos[x.id] !== `cell ${x.fila},${x.col}`) falla(`${que}: ${x.id} position text "${s.dom.pos[x.id]}"`);
  }
  for (const [k, v] of Object.entries(nodeR.totales)) igual(r.totales[k], v, `${que} total ${k}`);
  igual(r.objetivo.total, nodeR.objetivo.total, `${que} objective`);
  igual(r.busqueda.optimo_probado, nodeR.busqueda.optimo_probado, `${que} optimo_probado`);
  igual(r.busqueda.metodo, nodeR.busqueda.metodo, `${que} search method`);
  igual(JSON.stringify(r.por_medir), JSON.stringify(nodeR.por_medir), `${que} por_medir`);
  if (s.dom.rutas !== fmt.km(nodeR.totales.rutas_m)) falla(`${que}: route length text "${s.dom.rutas}" ≠ ${fmt.km(nodeR.totales.rutas_m)}`);
  if (!/exact/.test(s.dom.busqueda ?? '') === nodeR.busqueda.optimo_probado) falla(`${que}: search text does not say exact/heuristic: ${s.dom.busqueda}`);
}

const resumen = {};
try {
  const pag = await abrir(`${baseUrl}/terreno/index.html?a=haughton&b=shackleton_borde&solo=shackleton_borde`);
  await pag.waitForFunction(() => window.__az.paneles[1].base?.B.listo, null, { timeout: 30000 });
  await pag.$eval(`${B} .rutas .base`, (el) => el.scrollIntoView({ block: 'start' }));

  // ---------- 0: cancelar ----------
  await pag.click(Bb('generar'));
  await pag.waitForTimeout(1200);
  const vivo = await pag.evaluate(() => new Promise((ok) => { const t = performance.now(); requestAnimationFrame(() => ok(performance.now() - t)); }));
  const enCurso = await pag.$eval(Bb('estado'), (d) => d.textContent);
  if (!/computing… \d+ s/.test(enCurso)) falla(`0: no computing text: ${enCurso}`);
  if (!(vivo < 1000)) falla(`0: page frozen while computing (${vivo.toFixed(0)} ms for one frame)`);
  await pag.screenshot({ path: join(SALIDA, '00-calculando.png') });
  await pag.click(Bb('cancelar'));
  await pag.waitForFunction(() => !window.__az.paneles[1].base.B.trabajo, null, { timeout: 10000 });
  const canc = await pag.$eval(Bb('estado'), (d) => d.textContent);
  if (!/cancelled/.test(canc)) falla(`0: cancel message: ${canc}`); else ok(`0: "${enCurso}" (one frame in ${vivo.toFixed(0)} ms), then "${canc}"`);

  // ---------- 1: generar con las 5 piezas ----------
  const todas = new Set(IDS_BASE);
  await generar(pag);
  let s = await leerBase(pag);
  const n1 = baseNode(todas, SEP);
  compararBase(s, n1, '1');
  resumen.base = { estado: s.estado, piezas: s.r.piezas?.map((x) => `${x.id} ${x.fila},${x.col}`), totales: s.r.totales, objetivo: s.r.objetivo?.total, optimo_probado: s.r.busqueda?.optimo_probado };
  ok(`1: ${s.estado}; ${JSON.stringify(resumen.base.piezas)}; routes ${s.dom.rutas}; pads ${s.dom.pads}; roads ${s.dom.roads}; ${s.dom.busqueda?.slice(0, 60)}…`);
  const hub = s.r.piezas.find((x) => x.hub);
  await vista(pag, 1, { f: hub.fila, c: hub.col }, 9, []);
  await pag.waitForTimeout(300);
  await pag.screenshot({ path: join(SALIDA, '01-base-generada.png') });
  await pag.$eval(Bb('busqueda'), (el) => el.scrollIntoView({ block: 'start' }));
  await pag.waitForTimeout(150);
  await pag.screenshot({ path: join(SALIDA, '01b-panel-base.png') });

  // ---------- 2: las 5 piezas plantadas, cada una con su hoja ----------
  if (s.plantados.length !== 5 || s.plantados.some((x) => !x.item)) falla(`2: planted ${JSON.stringify(s.plantados)}`);
  for (const { id, item } of s.plantados) {
    if (!item) continue;
    const x = s.r.piezas.find((q) => q.id === id);
    if (item.fila !== x.fila || item.col !== x.col || item.equipo !== EQUIPO_BASE[id]) falla(`2: ${id} planted at ${item.fila},${item.col} as ${item.equipo}`);
    const [pt] = await vista(pag, 1, { f: item.fila, c: item.col }, 0.5, [{ f: item.fila, c: item.col }]);
    const caja = await pag.$eval(`${B} .marca[data-uid="${item.uid}"] .pin`, (d) => { const r = d.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await pag.mouse.click(caja.x, caja.y);
    await pag.waitForTimeout(150);
    const h = await pag.evaluate(() => { const p = window.__az.paneles[1]; const hj = p.el.querySelector('.hoja'); return { visible: !hj.hidden, titulo: hj.querySelector('h3')?.textContent ?? null, sel: p.sel, reqs: hj.querySelectorAll('.req').length }; });
    const nom = CAT.equipos.find((q) => q.id === EQUIPO_BASE[id]).nombre;
    if (!h.visible || h.titulo !== nom || h.sel !== item.uid) falla(`2: ${id} sheet ${JSON.stringify(h)} (marker at ${pt.x?.toFixed(0)},${pt.y?.toFixed(0)})`);
    else ok(`2: ${id} marker → sheet "${h.titulo}" with ${h.reqs} requirement rows`);
    if (id === 'reactor') await pag.screenshot({ path: join(SALIDA, '02-hoja-reactor.png') });
  }
  await pag.evaluate(() => { const p = window.__az.paneles[1]; p.sel = null; });

  // ---------- 3: quitar la torre y regenerar ----------
  await pag.$eval(`${B} .rutas .base`, (el) => el.scrollIntoView({ block: 'start' }));
  await pag.uncheck(Bb('usa-torre'));
  await generar(pag);
  s = await leerBase(pag);
  const sinTorre = new Set(IDS_BASE.filter((x) => x !== 'torre'));
  compararBase(s, baseNode(sinTorre, SEP), '3');
  const plantTorre = await pag.evaluate(() => window.__az.paneles[1].plantados.lista.filter((x) => x.equipo === 'torre_solar').length);
  if (s.plantados.length !== 4 || plantTorre !== 0) falla(`3: planted ${s.plantados.length}, solar towers left ${plantTorre}`);
  else ok(`3: without the solar tower: ${JSON.stringify(s.r.piezas.map((x) => `${x.id} ${x.fila},${x.col}`))}; old markers removed`);
  await vista(pag, 1, { f: hub.fila, c: hub.col }, 9, []);
  await pag.$eval(`${B} .rutas .base`, (el) => el.scrollIntoView({ block: 'start' }));
  await pag.waitForTimeout(300);
  await pag.screenshot({ path: join(SALIDA, '03-sin-torre.png') });

  // ---------- 4: sin solución, con la restricción por su nombre ----------
  await pag.fill(Bb('sep'), String(SEP_IMPOSIBLE_M));
  await pag.$eval(Bb('sep'), (i) => i.dispatchEvent(new Event('change')));
  await generar(pag);
  s = await leerBase(pag);
  compararBase(s, baseNode(sinTorre, SEP_IMPOSIBLE_M), '4');
  if (s.r.factible || !/separation: pista >= 20000 m from the habitat_superficie \(assumed parameter\)/.test(s.dom.restriccion ?? '')) falla(`4: no-solution text: ${s.dom.sin} / ${s.dom.restriccion}`);
  else ok(`4: "${s.dom.sin}" · "${s.dom.restriccion}"`);
  const quedan = await pag.evaluate(() => window.__az.paneles[1].base.B.uids.size);
  if (quedan !== 0) falla(`4: ${quedan} base markers left after a base with no solution`);
  await pag.$eval(`${B} .rutas .base`, (el) => el.scrollIntoView({ block: 'start' }));
  await pag.waitForTimeout(200);
  await pag.screenshot({ path: join(SALIDA, '04-sin-solucion.png') });

  // Vuelve a la base completa para la parte B.
  await pag.fill(Bb('sep'), String(SEP));
  await pag.$eval(Bb('sep'), (i) => i.dispatchEvent(new Event('change')));
  await pag.check(Bb('usa-torre'));
  await generar(pag);
  s = await leerBase(pag);
  compararBase(s, n1, '1 again');
  globalThis.__pag = pag;
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
}

// ---------- 5: Rehearse on Earth ----------
const esperarEnsayo = (pag, antes) => pag.waitForFunction((antes) => { const E = window.__az.paneles[0].base?.B.ens; return E && E.listo && E.serieCalculo !== antes; }, antes, { timeout: 240000 });
const serieEnsayo = (pag) => pag.evaluate(() => window.__az.paneles[0].base?.B.ens?.serieCalculo ?? null);
const leerEnsayo = (pag) => pag.evaluate(() => {
  const p = window.__az.paneles[0], E = p.base.B.ens;
  const txt = (k) => p.el.querySelector(`.rutas .base [data-b="${k}"]`)?.textContent.replace(/\s+/g, ' ').trim() ?? null;
  return {
    hab: E.hab, tras: E.tras, resumen: E.resumen, lecturas: E.filas.map((f) => `${f.pieza}:${f.req.variable}:${f.lectura}`),
    accesos: E.accesos.map((a) => ({ id: a.id, camino: a.camino ? Array.from(a.camino) : null, longitud_m: a.longitud_m ?? null, umbral: a.umbral ?? null, motivo: a.motivo ?? null, diezmado: a.diezmado ?? null })),
    visita: E.visita?.medidas?.longitud_m ?? null,
    dom: { resumen: txt('resumen'), cuentas: Object.fromEntries([...p.el.querySelectorAll('.rutas .base [data-b="resumen"] [data-n]')].map((b) => [b.dataset.n, +b.textContent])), visita: txt('visita'), visitaH: txt('visita-h'), filas: p.el.querySelectorAll('.rutas .base [data-b="tabla"] tbody tr').length, campanas: p.el.querySelectorAll('.rutas .base [data-b="campana"]').length, noDice: p.el.querySelectorAll('.rutas .base [data-b="no-dice"] li').length, ampliado: p.ampliado },
    plantados: p.plantados.lista.map((x) => `${x.equipo}@${x.fila},${x.col}`),
  };
});
function compararEnsayo(t, que, rLuna) {
  const nd = ensayoNode(rLuna, t.hab);
  for (const x of nd.tras) {
    const y = t.tras.find((q) => q.id === x.id);
    if (!y || y.fila !== x.fila || y.col !== x.col || y.dentro !== x.dentro || y.enAgua !== x.enAgua) falla(`${que}: ${x.id} transplant screen ${JSON.stringify(y)} ≠ node ${JSON.stringify(x)}`);
  }
  igual(JSON.stringify(t.resumen), JSON.stringify(nd.resumen), `${que} summary`);
  igual(JSON.stringify(t.lecturas), JSON.stringify(nd.filas.map((f) => `${f.pieza}:${f.req.variable}:${f.lectura}`)), `${que} readings`);
  const N = TIERRA.t.n, hub = t.tras.find((q) => q.hub);
  for (const a of t.accesos) {
    const d = t.tras.find((q) => q.id === a.id);
    if (!a.camino || a.diezmado) continue;
    igual(a.longitud_m, rutaNode(hub.fila * N + hub.col, d.fila * N + d.col), `${que} Earth access length ${a.id}`);
  }
  return nd;
}
try {
  const pag = globalThis.__pag;
  if (!pag) throw new Error('no page left by part A');
  const rLuna = (await leerBase(pag)).r;
  await pag.$eval(`${B} .rutas .base`, (el) => el.scrollIntoView({ block: 'start' }));
  if (await pag.$eval(Bb('ensayar'), (b) => b.disabled)) falla('5: Rehearse on Earth is disabled with a base on the Moon');
  const s0 = await serieEnsayo(pag);
  await pag.click(Bb('ensayar'));
  await esperarEnsayo(pag, s0);
  let t = await leerEnsayo(pag);
  if (!t.dom.ampliado) falla('5: Earth panel not shown after Rehearse on Earth');
  if (t.hab.fila !== TIERRA.t.n / 2 || t.hab.col !== TIERRA.t.n / 2) falla(`5: habitat should start at the centre: ${JSON.stringify(t.hab)}`);
  if (!(t.dom.filas > 0) || t.dom.filas !== t.lecturas.length) falla(`5: table rows ${t.dom.filas} vs ${t.lecturas.length} readings`);
  compararEnsayo(t, '5', rLuna);
  const R = t.resumen;
  for (const k of ['reproducido', 'infra', 'sobre', 'no_medible']) if (t.dom.cuentas[k] !== R[k]) falla(`5: summary on screen ${k} ${t.dom.cuentas[k]} ≠ ${R[k]}`);
  resumen.ensayo = { hab: t.hab, resumen: t.resumen, lecturas: t.lecturas, accesos: t.accesos.map((a) => `${a.id}: ${a.camino ? `${(a.longitud_m / 1000).toFixed(2)} km` : a.motivo ?? `no route, opens at ${a.umbral?.toFixed(2)}°`}`), visita: t.dom.visita, visitaH: t.dom.visitaH, campanas: t.dom.campanas, noDice: t.dom.noDice, plantados: t.plantados };
  ok(`5: Earth summary ${t.dom.resumen}; ${JSON.stringify(resumen.ensayo.accesos)}; round trip ${t.dom.visita} ${t.dom.visitaH}; ${t.dom.campanas} campaigns; ${t.dom.noDice} items not told`);
  if (t.dom.campanas !== 2) falla(`5: haughton should show its 2 cited campaigns, got ${t.dom.campanas}`);
  const hubT = t.tras.find((q) => q.hub);
  await vista(pag, 0, { f: hubT.fila, c: hubT.col }, 9, []);
  await pag.$eval(`${A} .rutas .base`, (el) => el.scrollIntoView({ block: 'start' }));
  await pag.waitForTimeout(300);
  await pag.screenshot({ path: join(SALIDA, '05-ensayo-tierra.png') });
  await pag.$eval(`${A} .rutas .base [data-b="accesos"]`, (el) => el.scrollIntoView({ block: 'start' }));
  await pag.waitForTimeout(150);
  await pag.screenshot({ path: join(SALIDA, '05b-ensayo-accesos-campana.png') });

  // Recolocar el hábitat con un clic: una celda de tierra con todas las piezas dentro y en tierra (búsqueda en node).
  let destino = null;
  for (const [df, dc] of [[-150, 120], [150, -150], [-200, -200], [200, 200], [-100, 250], [80, -260]]) {
    const h = { fila: TIERRA.t.n / 2 + df, col: TIERRA.t.n / 2 + dc };
    const tr = trasplantar(rLuna.piezas, LUNA.t.m, { n: TIERRA.t.n, m: TIERRA.t.m, agua: TIERRA.t.capas.agua }, h);
    if (tr.every((x) => x.dentro && !x.enAgua)) { destino = h; break; }
  }
  if (!destino) throw new Error('no land cell found to move the habitat to');
  await pag.$eval(`${A} .rutas .base`, (el) => el.scrollIntoView({ block: 'start' }));
  await pag.click(`${A} .rutas .base [data-b="elegir"]`);
  const [pt] = await vista(pag, 0, { f: destino.fila, c: destino.col }, 6, [{ f: destino.fila, c: destino.col }]);
  if (!pt.dentro) throw new Error('target cell not on screen');
  const s1 = await serieEnsayo(pag);
  await pag.mouse.click(pt.x, pt.y);
  await esperarEnsayo(pag, s1);
  const t2 = await leerEnsayo(pag);
  if (Math.hypot(t2.hab.fila - destino.fila, t2.hab.col - destino.col) > 1.5) falla(`6: clicked ${JSON.stringify(destino)}, habitat at ${JSON.stringify(t2.hab)}`);
  compararEnsayo(t2, '6', rLuna);
  const cambia = JSON.stringify(t2.tras.map((x) => [x.fila, x.col])) !== JSON.stringify(t.tras.map((x) => [x.fila, x.col])) && (JSON.stringify(t2.lecturas) !== JSON.stringify(t.lecturas) || JSON.stringify(t2.accesos.map((a) => a.longitud_m)) !== JSON.stringify(t.accesos.map((a) => a.longitud_m)));
  if (!cambia) falla('6: moving the habitat did not change the rehearsal');
  resumen.recolocado = { hab: t2.hab, resumen: t2.resumen, lecturas: t2.lecturas, accesos: t2.accesos.map((a) => `${a.id}: ${a.camino ? `${(a.longitud_m / 1000).toFixed(2)} km` : a.motivo ?? `no route, opens at ${a.umbral?.toFixed(2)}°`}`), visita: t2.dom.visita, visitaH: t2.dom.visitaH };
  ok(`6: habitat moved by a click to ${t2.hab.fila},${t2.hab.col}: summary ${t2.dom.resumen}; ${JSON.stringify(resumen.recolocado.accesos)}; round trip ${t2.dom.visita} ${t2.dom.visitaH}`);
  await vista(pag, 0, { f: t2.hab.fila, c: t2.hab.col }, 9, []);
  await pag.$eval(`${A} .rutas .base`, (el) => el.scrollIntoView({ block: 'start' }));
  await pag.waitForTimeout(300);
  await pag.screenshot({ path: join(SALIDA, '06-recolocado.png') });
  await pag.close();
} catch (e) {
  falla(`script (rehearse): ${e.stack ?? e.message}`);
}

await nav.close();
servidor.close();
console.log(`summary: ${JSON.stringify(resumen)}`);
console.log(fallos.length ? `CAPTURA_BASE: ${fallos.length} failure(s)` : 'CAPTURA_BASE: ok');
process.exit(fallos.length ? 1 : 0);

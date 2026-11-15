// Obra en Chromium con GPU: carretera sobre una ruta, bajada diseñada en Shackleton (aplicar y deshacer) y plataforma en la hoja.
// Compara las cifras de pantalla con obra.js/panel_obra.js ejecutado aquí sobre el mismo terreno. Uso: node scripts/captura_obra.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { pendientes, caminoMinimo, umbralMinimo } from '../web/terreno/rutas.js';
import { latLonAPixel } from '../web/terreno/georef.js';
import { obraCarretera, obraPlataforma, defectosFlota, fmt } from '../web/terreno/panel_obra.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'obra');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
// Criterio de la prueba (propio): diámetro de la plataforma de la pista en shackleton_borde (≥ 3 celdas de 9,8 m).
const DIAMETRO_PISTA_M = 60;

const fallos = [];
const falla = (m) => { fallos.push(m); console.error(`FAIL ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);
const igual = (a, b, que) => {
  if (a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(b), 1))) return true;
  falla(`${que}: screen ${a} ≠ node ${b}`);
  return false;
};

// ---------- Datos y cifras de referencia en node ----------
const leerTerreno = (id) => {
  const dir = join(WEB, 'data/terreno', id);
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const f32 = (f) => { const b = readFileSync(join(dir, f)); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  return { meta, n: meta.n, m: meta.m_por_px, alturas: f32('altura.f32'), ilu: f32('iluminacion.f32') };
};
const OBRA = JSON.parse(readFileSync(join(WEB, 'data/obra.json'), 'utf8'));
const CAT = JSON.parse(readFileSync(join(WEB, 'data/equipo.json'), 'utf8'));
const F = defectosFlota(OBRA, CAT.equipos);
const flota = { n_robots: 1, kg_h: F.ritmo_kg_h.valor, mision_kg: F.mision_kg.valor };
const ltvLim = CAT.equipos.find((q) => q.id === 'ltv').requisitos.find((r) => r.variable === 'pendiente_deg').valor;
const ltvAncho = 2 * CAT.equipos.find((q) => q.id === 'ltv').cifras.find((c) => c.nombre === 'ancho_m').valor;

const S = leerTerreno('shackleton');
const N = S.n, M = S.m, pend = pendientes(S.alturas, N, M);
const crater = S.meta.rasgos.find((r) => r.nombre === 'Shackleton');
const cpx = latLonAPixel(S.meta, crater.lat, crater.lon), Rpx = (crater.diametro_km * 500) / M;
let P0 = -1, FONDO = -1;
for (let f = 0; f < N; f++) for (let c = 0; c < N; c++) {
  const i = f * N + c, d = Math.hypot(f - cpx.fila, c - cpx.col);
  if (d >= 0.9 * Rpx && d <= 1.1 * Rpx && pend[i] <= ltvLim && Number.isFinite(S.ilu[i]) && (P0 < 0 || S.ilu[i] > S.ilu[P0])) P0 = i;
  if (d <= 0.3 * Rpx && Number.isFinite(S.alturas[i]) && (FONDO < 0 || S.alturas[i] < S.alturas[FONDO])) FONDO = i;
}
const fc = (i) => ({ f: Math.floor(i / N), c: i % N });
const p0 = fc(P0), fondo = fc(FONDO);
const tS = { n: N, m: M, alturas: S.alturas, pend };
const carretera = (alturas, camino) => obraCarretera({ t: { n: N, m: M, alturas }, camino, luz: S.ilu, luna: true, pendiente_deg: ltvLim, ancho_m: ltvAncho, densidad: F.densidad.valor, flota });
const umbralNode = umbralMinimo(tS, P0, FONDO);
console.log(`Shackleton rim cell ${p0.f},${p0.c} → floor ${fondo.f},${fondo.c}; node: no LTV route = ${!caminoMinimo(tS, P0, FONDO, { limite: ltvLim }).camino}, minimum slope ${umbralNode.toFixed(3)}°`);

// Caso A: destino con ruta a ≤ 20° cuya rasante a 20° mueve tierra (algún paso de la ruta pasa del límite).
let destA = null;
for (let r = 40; r <= 160 && !destA; r += 8) for (let a = 0; a < 16 && !destA; a++) {
  const f = Math.round(p0.f + r * Math.sin((a * Math.PI) / 8)), c = Math.round(p0.c + r * Math.cos((a * Math.PI) / 8));
  if (f < 0 || c < 0 || f >= N || c >= N) continue;
  const b = f * N + c, q = caminoMinimo(tS, P0, b, { limite: ltvLim });
  if (!q.camino) continue;
  const x = carretera(S.alturas, q.camino);
  if (x.factible && x.corte_m3 > 0 && x.relleno_m3 > 0) destA = { b, ...fc(b), x };
}
if (!destA) { console.error('FAIL no destination near the rim with an LTV route that needs earthworks'); process.exit(1); }
console.log(`case A destination: cell ${destA.f},${destA.c}; node road: cut ${fmt.m3(destA.x.corte_m3)}, fill ${fmt.m3(destA.x.relleno_m3)} along ${fmt.km(destA.x.longitud_m)}`);

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
const B = '.panel[data-lado=b]';
const R = (k) => `${B} .rutas [data-r="${k}"]`;
const O = (k) => `${B} .rutas .obra [data-o="${k}"]`;

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
const vista = (pag, centro, alto_km, celdas) => pag.evaluate(([centro, alto, celdas]) => new Promise((ok) => {
  const e = window.__az.paneles[1].escena;
  const w = e.mundoDePixel(centro.f, centro.c);
  e.controles.target.set(w.x, w.y, w.z);
  e.camara.position.set(w.x, w.y + alto, w.z + alto * 0.35);
  e.controles.update();
  e.sucio = true;
  requestAnimationFrame(() => requestAnimationFrame(() => ok(celdas.map(({ f, c }) => {
    const s = e.aPantalla(e.mundoDePixel(f, c));
    const g = s?.dentro && e.rayo(s.x, s.y);
    return { x: s?.x, y: s?.y, ok: !!g && Math.hypot(g.fila - f, g.col - c) < 1.5 };
  }))));
}), [centro, alto_km, celdas]);
const marcarRuta = (pag) => pag.evaluate(() => { window.__resPrevio = window.__az.paneles[1].rutas.R.res; });
const esperarRuta = (pag) => pag.waitForFunction(() => { const r = window.__az.paneles[1].rutas.R.res; return r && r !== window.__resPrevio && r.ms !== undefined && !window.__az.paneles[1].obra.O.ocupado; }, null, { timeout: 120000 });
const leerObra = (pag) => pag.evaluate(() => {
  const p = window.__az.paneles[1], x = p.obra.O.res, r = p.rutas.R.res;
  const txt = (k) => p.el.querySelector(`.rutas .obra [data-o="${k}"]`)?.textContent.replace(/\s+/g, ' ').trim() ?? null;
  return {
    x: x && { factible: x.factible, corte: x.corte_m3, relleno: x.relleno_m3, cmax: x.corte_max_m, rmax: x.relleno_max_m, L: x.longitud_m, masa: x.masa_kg, horas: x.flota?.horas ?? null, cal: x.flota?.calendario_dias ?? null },
    dom: { corte: txt('corte'), relleno: txt('relleno'), cmax: txt('corte-max'), rmax: txt('relleno-max'), L: txt('longitud'), masa: txt('masa'), nota: txt('nota-alineacion'), noMedido: txt('no-medido'), pide: txt('pide') },
    aplicar: p.el.querySelector('.rutas .obra [data-o="aplicar"]')?.disabled ?? null,
    primera: [...(p.el.querySelector('.rutas .obra')?.querySelectorAll('[data-o]') ?? [])].map((d) => d.dataset.o).filter((k) => ['corte-max', 'relleno-max', 'corte', 'relleno'].includes(k)),
    ruta: r && { camino: r.camino ? Array.from(r.camino) : null, umbral: r.umbral ?? null, medidas: r.medidas ?? null },
    carreteras: p.obra.carreteras().map((c) => c.length),
  };
});
const comparar = (pag, que, s, nodeX) => {
  igual(s.x.corte, nodeX.corte_m3, `${que} cut`); igual(s.x.relleno, nodeX.relleno_m3, `${que} fill`);
  igual(s.x.cmax, nodeX.corte_max_m, `${que} max cut`); igual(s.x.rmax, nodeX.relleno_max_m, `${que} max fill`);
  igual(s.x.L, nodeX.longitud_m, `${que} length`); igual(s.x.masa, nodeX.masa_kg, `${que} mass`);
  const textos = { corte: fmt.m3(nodeX.corte_m3), relleno: fmt.m3(nodeX.relleno_m3), cmax: fmt.m(nodeX.corte_max_m), rmax: fmt.m(nodeX.relleno_max_m), L: fmt.km(nodeX.longitud_m), masa: fmt.masa(nodeX.masa_kg) };
  for (const [k, v] of Object.entries(textos)) if (s.dom[k] !== v) falla(`${que} on screen ${k} "${s.dom[k]}" ≠ node "${v}"`);
};
const verObra = (pag) => pag.$eval(`${B} .rutas .obra`, (el) => el.scrollIntoView({ block: 'start' }));
const deshacer = async (pag) => { await pag.click(`${B} .retoque [data-a=deshacer]`); await pag.waitForTimeout(150); };

const cifrasB = {};
try {
  const pag = await abrir(`${baseUrl}/terreno/index.html?a=haughton&b=shackleton`);
  await pag.click(`${B} .ampliar`);
  await pag.waitForTimeout(400);
  await pag.selectOption(R('veh'), 'ltv');
  await pag.waitForFunction(() => window.__az.paneles[1].obra.O.F, null, { timeout: 30000 });

  // ---------- A: carretera sobre una ruta ya calculada ----------
  await pag.evaluate(([a, b]) => { const r = window.__az.paneles[1].rutas; r.R.desde = { tipo: 'libre', fila: a.f, col: a.c }; r.R.hasta = { tipo: 'libre', fila: b.f, col: b.c }; }, [p0, destA]);
  await marcarRuta(pag);
  await pag.click(R('calcular'));
  await esperarRuta(pag);
  let s = await leerObra(pag);
  const titA = await pag.$eval(`${B} .rutas .obra .et.sub`, (d) => d.textContent);
  if (!s.ruta.camino || !/BUILD ROAD ALONG THIS ROUTE/.test(titA)) falla(`A: route or road section missing (${titA})`);
  else {
    const xA = carretera(S.alturas, Int32Array.from(s.ruta.camino));
    comparar(pag, 'A', s, xA);
    ok(`A: road along the LTV route (${s.ruta.camino.length} cells): cut ${s.dom.corte}, fill ${s.dom.relleno}, max cut ${s.dom.cmax}, max fill ${s.dom.rmax}, ${s.dom.L}; equal to node`);
  }
  if (s.aplicar !== false) falla('A: Apply should be enabled');
  await vista(pag, { f: Math.round((p0.f + destA.f) / 2), c: Math.round((p0.c + destA.c) / 2) }, 5, []);
  await verObra(pag);
  await pag.waitForTimeout(200);
  await pag.screenshot({ path: join(SALIDA, '01-carretera-sobre-ruta.png') });
  await marcarRuta(pag);
  await pag.click(O('aplicar'));
  await esperarRuta(pag);
  s = await leerObra(pag);
  const apA = await pag.$eval(O('pasos-antes-despues'), (d) => d.textContent);
  if (!/→ 0$/.test(apA.trim()) || !s.ruta.camino || s.carreteras.length !== 1) falla(`A applied: steps over ${apA}, route ${!!s.ruta.camino}, roads ${JSON.stringify(s.carreteras)}`);
  else ok(`A applied: steps over ${ltvLim}° ${apA.trim()}, route recomputed (${s.ruta.camino.length} cells), 1 road counted for routes`);
  await deshacer(pag);
  s = await leerObra(pag);
  if (s.carreteras.length) falla(`A undo should remove the road from routing: ${JSON.stringify(s.carreteras)}`); else ok('A undo: no road left for routing');

  // ---------- B: bajada diseñada borde → fondo ----------
  await pag.evaluate(([a, b]) => { const r = window.__az.paneles[1].rutas; r.R.desde = { tipo: 'libre', fila: a.f, col: a.c }; r.R.hasta = { tipo: 'libre', fila: b.f, col: b.c }; }, [p0, fondo]);
  await marcarRuta(pag);
  await pag.click(R('calcular'));
  await esperarRuta(pag);
  s = await leerObra(pag);
  if (s.ruta.camino) falla('B: there should be no LTV route rim → floor before the road');
  else { igual(s.ruta.umbral, umbralNode, 'B minimum slope before'); cifrasB.umbralAntes = s.ruta.umbral; ok(`B before: no route, minimum slope ${s.ruta.umbral.toFixed(3)}° (node ${umbralNode.toFixed(3)}°)`); }
  await vista(pag, { f: Math.round((p0.f + fondo.f) / 2), c: Math.round((p0.c + fondo.c) / 2) }, 30, []);
  await verObra(pag);
  await pag.waitForTimeout(200);
  await pag.screenshot({ path: join(SALIDA, '02-sin-ruta.png') });
  await pag.click(O('disenar'));
  await pag.waitForFunction(() => { const O = window.__az.paneles[1].obra.O; return O.diseno?.camino && O.res && !O.ocupado; }, null, { timeout: 120000 });
  s = await leerObra(pag);
  const trazaPag = await pag.evaluate(() => { const d = window.__az.paneles[1].obra.O.diseno; return { camino: Array.from(d.camino), diezmado: d.diezmado }; });
  const trazaNode = caminoMinimo(tS, P0, FONDO, { limite: umbralNode });
  const mismaTraza = trazaNode.camino && trazaNode.camino.length === trazaPag.camino.length && trazaNode.camino.every((v, k) => v === trazaPag.camino[k]);
  console.log(`B trace: ${trazaPag.camino.length} cells${trazaPag.diezmado ? ' (decimated ×2)' : ''}; same cells as node at ${umbralNode.toFixed(3)}°: ${mismaTraza}`);
  if (!mismaTraza) falla('B: page trace differs from node trace at the minimum slope');
  const xB = carretera(S.alturas, Int32Array.from(trazaPag.camino));
  comparar(pag, 'B', s, xB);
  Object.assign(cifrasB, { corte: xB.corte_m3, relleno: xB.relleno_m3, cmax: xB.corte_max_m, rmax: xB.relleno_max_m, L: xB.longitud_m, masa: xB.masa_kg, horas: xB.flota.horas, cal: xB.flota.calendario_dias, diseno: xB.diseno_deg });
  if (s.primera.slice(0, 2).join() !== 'corte-max,relleno-max') falla(`B: max cut and max fill should be the first figures of the result: ${s.primera.join()}`);
  if (!/own criterion/.test(s.dom.nota ?? '') || !/Straight grade along the traced line; a longer alignment with switchbacks is not computed\. No published limit for cut depth: judge the figure\./.test(s.dom.nota ?? '')) falla(`B: alignment note missing: ${s.dom.nota}`);
  if (!/cross slope.*NOT MEASURED/.test(s.dom.noMedido ?? '')) falla(`B: cross slope not labelled NOT MEASURED: ${s.dom.noMedido}`);
  ok(`B designed road: ${s.dom.pide}`);
  ok(`B first line: MAX CUT ${s.dom.cmax} · MAX FILL ${s.dom.rmax} · "${s.dom.nota}"`);
  await verObra(pag);
  await pag.waitForTimeout(200);
  await pag.screenshot({ path: join(SALIDA, '03-bajada-disenada.png') });
  await pag.locator(`${B} .rutas .obra`).screenshot({ path: join(SALIDA, '03b-bajada-disenada-panel.png') });

  await marcarRuta(pag);
  await pag.click(O('aplicar'));
  await esperarRuta(pag);
  s = await leerObra(pag);
  const enRoad = new Set(trazaPag.camino);
  const resTxt = await pag.$eval(R('res'), (d) => d.textContent.replace(/\s+/g, ' ').trim());
  const ap = await pag.$eval(O('aplicada'), (d) => d.textContent.replace(/\s+/g, ' ').trim());
  if (!s.ruta.camino) falla(`B applied: route still not found: ${ap}`);
  else {
    const sobre = s.ruta.camino.filter((i) => enRoad.has(i)).length;
    cifrasB.rutaTras = { celdas: s.ruta.camino.length, enCarretera: sobre, km: s.ruta.medidas.longitud_m / 1000, pasosCarretera: s.ruta.medidas.carretera?.pasos, pendCarretera: s.ruta.medidas.carretera?.pendMax, pendFuera: s.ruta.medidas.pendMax };
    if (!(s.ruta.medidas.carretera?.pendMax <= ltvLim)) falla(`B applied: steepest step on the road ${s.ruta.medidas.carretera?.pendMax} > ${ltvLim}`);
    if (!/ON APPLIED ROAD/.test(resTxt) || !/cross slope of the road: NOT MEASURED/.test(resTxt)) falla(`B applied: route result does not label the road: ${resTxt.slice(0, 400)}`);
    ok(`B applied: LTV route found, ${s.ruta.camino.length} cells, ${sobre} on the road, ${(s.ruta.medidas.longitud_m / 1000).toFixed(2)} km, steepest road step ${s.ruta.medidas.carretera.pendMax.toFixed(4)}°`);
  }
  ok(`B applied block: ${ap}`);
  await vista(pag, { f: Math.round((p0.f + fondo.f) / 2), c: Math.round((p0.c + fondo.c) / 2) }, 30, []);
  await pag.$eval(R('res'), (el) => el.scrollIntoView({ block: 'start' }));
  await pag.waitForTimeout(250);
  await pag.screenshot({ path: join(SALIDA, '04-ruta-por-la-carretera.png') });

  await deshacer(pag);
  const obsTxt = await pag.$eval(O('aplicada-obs'), (d) => d.textContent).catch(() => null);
  if (!/undone/.test(obsTxt ?? '')) falla(`B undo: applied block should say undone: ${obsTxt}`);
  await marcarRuta(pag);
  await pag.click(R('calcular'));
  await esperarRuta(pag);
  s = await leerObra(pag);
  if (s.ruta.camino || s.carreteras.length) falla(`B undo: route should not exist again (route ${!!s.ruta.camino}, roads ${JSON.stringify(s.carreteras)})`);
  else { igual(s.ruta.umbral, umbralNode, 'B minimum slope after undo'); cifrasB.umbralDeshacer = s.ruta.umbral; ok(`B undo + compute: no route again, minimum slope ${s.ruta.umbral.toFixed(3)}°`); }
  await pag.$eval(R('res'), (el) => el.scrollIntoView({ block: 'start' }));
  await pag.waitForTimeout(200);
  await pag.screenshot({ path: join(SALIDA, '05-deshacer.png') });

  // ---------- C (shackleton): torre solar de 6 m, menor que 3 celdas: solo estimación ----------
  await pag.click(R('borrar'));
  const sitio = destA;
  const [sT] = await vista(pag, sitio, 4, [sitio]);
  await pag.click(`${B} .ver-paleta`);
  await pag.click(`${B} .paleta [data-eq=torre_solar]`);
  await pag.mouse.click(sT.x, sT.y);
  await pag.waitForTimeout(200);
  await pag.click(`${B} .hoja .obra-pad [data-o=pad]`);
  await pag.waitForTimeout(150);
  const padS = await pag.evaluate(() => {
    const h = window.__az.paneles[1].el.querySelector('.hoja .obra-pad');
    return { sub: h.querySelector('[data-o=sub-celda]')?.textContent ?? null, apagado: h.querySelector('[data-o=pad-aplicar]')?.disabled, corte: h.querySelector('[data-o=corte]')?.textContent ?? null, pend: h.querySelector('[data-o=pad-pend]')?.textContent ?? null };
  });
  if (!/narrower than 3 DEM cells/.test(padS.sub ?? '') || padS.apagado !== true) falla(`C shackleton: 6 m pad should be an estimate with Apply off: ${JSON.stringify(padS)}`);
  else ok(`C shackleton solar tower pad: "${padS.sub}", plane ${padS.pend}, cut ${padS.corte}, Apply disabled`);
  await pag.$eval(`${B} .hoja .obra-pad`, (el) => el.scrollIntoView({ block: 'center' }));
  await pag.waitForTimeout(200);
  await pag.screenshot({ path: join(SALIDA, '06-plataforma-estimada.png') });
  await pag.close();
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
}

// ---------- C (shackleton_borde, 9,8 m/px): pista de aterrizaje de 60 m, aplicada ----------
try {
  const T = leerTerreno('shackleton_borde');
  const pb = pendientes(T.alturas, T.n, T.m);
  const lim = OBRA.constantes.find((c) => c.id === 'pista_pendiente_max_deg').valor;
  // Celda con pendiente de celda entre el límite y 3 veces el límite, cerca del centro (que la plataforma tenga que nivelar).
  let sitio = null;
  for (let r = 0; r < T.n / 4 && !sitio; r++) for (let k = 0; k < 8 * Math.max(r, 1) && !sitio; k++) {
    const a = (k / (8 * Math.max(r, 1))) * 2 * Math.PI, f = Math.round(T.n / 2 + r * Math.sin(a)), c = Math.round(T.n / 2 + r * Math.cos(a));
    if (pb[f * T.n + c] > lim + 1 && pb[f * T.n + c] < 3 * lim) sitio = { f, c };
  }
  const pag = await abrir(`${baseUrl}/terreno/index.html?a=haughton&b=shackleton_borde&solo=shackleton_borde`);
  await pag.waitForFunction(() => window.__az.paneles[1].obra?.O.F, null, { timeout: 30000 });
  const [sP] = await vista(pag, sitio, 1.2, [sitio]);
  await pag.click(`${B} .ver-paleta`);
  await pag.click(`${B} .paleta [data-eq=pista_aterrizaje]`);
  await pag.mouse.click(sP.x, sP.y);
  await pag.waitForTimeout(200);
  const item = await pag.evaluate(() => window.__az.paneles[1].plantados.lista.find((x) => x.equipo === 'pista_aterrizaje'));
  if (!item) throw new Error('landing pad not planted');
  await pag.click(`${B} .hoja .obra-pad [data-o=pad]`);
  await pag.fill(`${B} .hoja .obra-pad [data-o=diam]`, String(DIAMETRO_PISTA_M));
  await pag.press(`${B} .hoja .obra-pad [data-o=diam]`, 'Enter');
  await pag.$eval(`${B} .hoja .obra-pad [data-o=diam]`, (i) => i.dispatchEvent(new Event('change')));
  await pag.waitForTimeout(150);
  const xN = obraPlataforma({ t: { n: T.n, m: T.m, alturas: T.alturas }, fila: item.fila, col: item.col, diametro_m: DIAMETRO_PISTA_M, limite_deg: lim, luz: T.ilu, luna: true, densidad: F.densidad.valor, flota });
  const antes = await pag.evaluate(() => {
    const h = window.__az.paneles[1].el.querySelector('.hoja .obra-pad');
    return { corte: h.querySelector('[data-o=corte]')?.textContent, relleno: h.querySelector('[data-o=relleno]')?.textContent, pend: h.querySelector('[data-o=pad-pend]')?.textContent, apagado: h.querySelector('[data-o=pad-aplicar]')?.disabled, sub: !!h.querySelector('[data-o=sub-celda]') };
  });
  if (antes.sub || antes.apagado !== false) falla(`C borde: 60 m pad should be gradeable with Apply on: ${JSON.stringify(antes)}`);
  if (antes.corte !== fmt.m3(xN.corte_m3) || antes.relleno !== fmt.m3(xN.relleno_m3) || antes.pend !== `${fmt.grados(xN.pend_antes_deg, 2)} → ${fmt.grados(xN.pend_despues_deg, 2)}`) falla(`C borde: screen ${JSON.stringify(antes)} ≠ node cut ${fmt.m3(xN.corte_m3)} fill ${fmt.m3(xN.relleno_m3)} plane ${fmt.grados(xN.pend_antes_deg, 2)} → ${fmt.grados(xN.pend_despues_deg, 2)}`);
  else ok(`C borde landing pad ${DIAMETRO_PISTA_M} m at ${item.fila},${item.col}: plane ${antes.pend}, cut ${antes.corte}, fill ${antes.relleno} (equal to node)`);
  await pag.click(`${B} .hoja .obra-pad [data-o=pad-aplicar]`);
  await pag.waitForTimeout(250);
  const tras = await pag.evaluate(() => {
    const p = window.__az.paneles[1], h = p.el.querySelector('.hoja .obra-pad');
    return { aplicada: h.querySelector('[data-o=pad-aplicada]')?.textContent.replace(/\s+/g, ' ').trim() ?? null, celda: h.querySelector('[data-o=pad-celda]')?.textContent ?? null, req: p.el.querySelector('.hoja .req[data-var=pendiente_deg]')?.className ?? null, roads: p.obra.carreteras().length };
  });
  const [ca, cd] = (tras.celda ?? '').split('→').map((x) => parseFloat(x));
  if (!tras.aplicada || !(cd <= lim) || tras.roads !== 0) falla(`C borde applied: ${JSON.stringify(tras)}`);
  else ok(`C borde applied: "${tras.aplicada}" · requirement row class "${tras.req}" · a pad is not a road (0 roads)`);
  if (!(ca > cd)) falla(`C borde: cell slope did not drop (${tras.celda})`);
  await pag.$eval(`${B} .hoja .obra-pad`, (el) => el.scrollIntoView({ block: 'center' }));
  await pag.waitForTimeout(250);
  await pag.screenshot({ path: join(SALIDA, '07-plataforma-aplicada.png') });
  await pag.close();
} catch (e) {
  falla(`script (shackleton_borde): ${e.stack ?? e.message}`);
} finally {
  await nav.close();
  servidor.close();
}
if (cifrasB.corte !== undefined) console.log(`case B figures (node = screen): ${JSON.stringify(cifrasB)}`);
console.log(fallos.length ? `CAPTURA_OBRA: ${fallos.length} failure(s)` : 'CAPTURA_OBRA: ok');
process.exit(fallos.length ? 1 : 0);

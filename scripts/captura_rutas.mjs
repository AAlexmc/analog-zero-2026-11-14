// Herramienta Route y Sites en Chromium con GPU: comprueba el flujo con el ratón, lee el estado y guarda capturas.
// Uso: node scripts/captura_rutas.mjs   (necesita web/data/terreno real: shackleton, haughton, mistastin y polo_sur)
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { pendientes, caminoMinimo } from '../web/terreno/rutas.js';
import { aplicarToque } from '../web/terreno/pincel.js';
import { alturaBilineal } from '../web/terreno/calculo.js';
import { latLonAPixel } from '../web/terreno/georef.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'rutas');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
// Criterio de la prueba (propio): radio del pincel de la «carretera».
const RADIO_CARRETERA_M = 300;

const fallos = [];
const falla = (m) => { fallos.push(m); console.error(`FAIL ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);

// ---------- Puntos de la prueba, fijados con los datos antes de abrir el navegador ----------
const dir = join(WEB, 'data/terreno/shackleton');
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const f32 = (f) => { const b = readFileSync(join(dir, f)); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const N = meta.n, M = meta.m_por_px;
const base = f32('altura.f32'), ilu = f32('iluminacion.f32');
const pend = pendientes(base, N, M);
const ltvLim = JSON.parse(readFileSync(join(WEB, 'data/equipo.json'), 'utf8')).equipos.find((q) => q.id === 'ltv').requisitos.find((r) => r.variable === 'pendiente_deg').valor;
const crater = meta.rasgos.find((r) => r.nombre === 'Shackleton');
const cpx = latLonAPixel(meta, crater.lat, crater.lon), Rpx = (crater.diametro_km * 500) / M;
let P0 = -1, FONDO = -1;
for (let f = 0; f < N; f++) for (let c = 0; c < N; c++) {
  const i = f * N + c, d = Math.hypot(f - cpx.fila, c - cpx.col);
  if (d >= 0.9 * Rpx && d <= 1.1 * Rpx && pend[i] <= ltvLim && Number.isFinite(ilu[i]) && (P0 < 0 || ilu[i] > ilu[P0])) P0 = i;
  if (d <= 0.3 * Rpx && Number.isFinite(base[i]) && (FONDO < 0 || base[i] < base[FONDO])) FONDO = i;
}
const fc = (i) => ({ f: Math.floor(i / N), c: i % N });
const p0 = fc(P0), fondo = fc(FONDO);
console.log(`rim point (max illumination ${ilu[P0].toFixed(3)} within 0.9-1.1 R of Shackleton, slope ≤ ${ltvLim}°): cell ${p0.f},${p0.c}; floor (lowest within 0.3 R): cell ${fondo.f},${fondo.c} at ${base[FONDO].toFixed(0)} m`);

// Destino para la carretera: rodeo grande respecto a la recta, tramo bloqueado corto; se simula el allanado con el mismo pincel.
function tramoBloqueado(b) {
  const B = fc(b), recta = Math.hypot(B.f - p0.f, B.c - p0.c) * M, K = Math.ceil((recta / M) * 2);
  let k0 = -1, k1 = -1;
  for (let k = 0; k <= K; k++) {
    const i = Math.round(p0.f + ((B.f - p0.f) * k) / K) * N + Math.round(p0.c + ((B.c - p0.c) * k) / K);
    if (!(pend[i] <= ltvLim)) { if (k0 < 0) k0 = k; k1 = k; }
  }
  return k0 < 0 ? null : { recta, a0: Math.max(0, k0 / K - 400 / recta), a1: Math.min(1, k1 / K + 400 / recta), largo: ((k1 - k0) / K) * recta };
}
const t0 = { n: N, m: M, alturas: base, pend };
const cands = [];
for (let f = 0; f < N; f += 12) for (let c = 0; c < N; c += 12) {
  const b = f * N + c, tb = pend[b] <= ltvLim && tramoBloqueado(b);
  if (!tb || tb.recta < 2500 || tb.recta > 9000 || tb.largo > 900) continue;
  const r = caminoMinimo(t0, P0, b, { limite: ltvLim });
  if (r.camino) cands.push({ b, ratio: r.coste / tb.recta, coste: r.coste, ...tb });
}
cands.sort((x, y) => y.ratio - x.ratio);
let destino = null;
for (const x of cands.slice(0, 8)) {
  const delta = new Float32Array(N * N), B = fc(x.b);
  const P = (s) => ({ fila: p0.f + (B.f - p0.f) * s, col: p0.c + (B.c - p0.c) * s });
  const ini = P(x.a0), obj = alturaBilineal(base, N, ini.fila, ini.col);
  const K = Math.ceil(Math.hypot(P(x.a1).fila - ini.fila, P(x.a1).col - ini.col) / Math.max(RADIO_CARRETERA_M / M / 4, 0.5));
  for (let rep = 0; rep < 2; rep++) for (let k = 0; k <= K; k++) aplicarToque({ n: N, m_por_px: M, base, delta }, { ...P(x.a0 + ((x.a1 - x.a0) * k) / K), radio_m: RADIO_CARRETERA_M, intensidad: 1, herramienta: 'allanar', cota_objetivo: obj });
  const alt = base.map((h, i) => h + delta[i]);
  const r2 = caminoMinimo({ n: N, m: M, alturas: alt, pend: pendientes(alt, N, M) }, P0, x.b, { limite: ltvLim });
  const gana = r2.camino ? x.coste - r2.coste : -Infinity;
  if (!destino || gana > destino.gana) destino = { ...x, gana };
}
if (!destino || destino.gana <= 0) { console.error('FAIL no destination where a flattened stretch shortens the LTV route (simulated)'); process.exit(1); }
const dst = fc(destino.b);
console.log(`road test destination: cell ${dst.f},${dst.c}; straight ${(destino.recta / 1000).toFixed(2)} km, route ${(destino.coste / 1000).toFixed(2)} km, blocked stretch on the straight line ${destino.largo.toFixed(0)} m; simulated gain ${(destino.gana / 1000).toFixed(2)} km`);

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
const pag = await nav.newPage({ viewport: { width: 1600, height: 900 } });
pag.on('console', (m) => { if (m.type() === 'error') falla(`console: ${m.text()}`); });
pag.on('pageerror', (e) => falla(`page error: ${e.message}`));
pag.on('worker', (w) => w.on('console', (m) => { if (m.type() === 'error') falla(`worker console: ${m.text()}`); }));

const B = '.panel[data-lado=b]';
const R = (k) => `${B} .rutas [data-r="${k}"]`;
// Cámara cenital sobre una celda; devuelve la posición de pantalla de las celdas pedidas (comprobando que el rayo vuelve a ellas).
const vista = (lado, centro, alto_km, celdas) => pag.evaluate(([lado, centro, alto, celdas]) => new Promise((ok) => {
  const e = window.__az.paneles[lado].escena;
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
}), [lado, centro, alto_km, celdas]);
// Guarda en la página el resultado anterior para esperar a uno nuevo (un objeto serializado nunca es idéntico).
const marcarRuta = () => pag.evaluate(() => { window.__resPrevio = window.__az.paneles[1].rutas.R.res; });
const esperarRuta = () => pag.waitForFunction(() => { const r = window.__az.paneles[1].rutas.R.res; return r && r !== window.__resPrevio && r.ms !== undefined; }, null, { timeout: 120000 });
const leerR = () => pag.evaluate(() => {
  const r = window.__az.paneles[1].rutas.R.res;
  return r && { coste: r.coste, camino: r.camino ? Array.from(r.camino) : null, medidas: r.medidas ?? null, umbral: r.umbral ?? null, ms: r.ms, diezmado: r.diezmado };
});
const filaHoja = (variable) => pag.evaluate((v) => {
  const r = window.__az.paneles[1].el.querySelector(`.hoja .req[data-var=${v}]`);
  return r ? { clase: r.className, texto: r.textContent.replace(/\s+/g, ' ').trim() } : null;
}, variable);

try {
  await pag.goto(`${baseUrl}/terreno/index.html?a=haughton&b=shackleton`);
  await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: 60000 });
  const errores = await pag.evaluate(() => window.__az.errores);
  if (errores.length) falla(`panel errors: ${errores.join('; ')}`);
  await pag.click(`${B} .ampliar`);
  await pag.waitForTimeout(400);

  // ---------- 01: LTV del borde más iluminado al fondo del cráter ----------
  const medio = { f: Math.round((p0.f + fondo.f) / 2), c: Math.round((p0.c + fondo.c) / 2) };
  const [sP0, sFondo] = await vista(1, medio, 26, [p0, fondo]);
  if (!sP0.ok || !sFondo.ok) falla(`rim or floor cell not clickable from the camera (${JSON.stringify([sP0, sFondo])})`);
  await pag.click(`${B} .ver-paleta`);
  await pag.click(`${B} .paleta [data-eq=ltv]`);
  await pag.mouse.click(sP0.x, sP0.y);
  await pag.waitForTimeout(150);
  const ltv = await pag.evaluate(() => window.__az.paneles[1].plantados.lista.find((x) => x.equipo === 'ltv'));
  if (!ltv || Math.hypot(ltv.fila - p0.f, ltv.col - p0.c) > 1.5) falla(`LTV not planted on the rim cell (${JSON.stringify(ltv)})`); else ok(`LTV planted on the rim at ${ltv.fila},${ltv.col}`);
  const antesHoja = { d: await filaHoja('distancia_recorrido_km'), h: await filaHoja('horas_en_sombra') };
  if (!/needs a route/.test(antesHoja.d?.texto ?? '') || !/needs a route/.test(antesHoja.h?.texto ?? '')) falla(`LTV sheet should say "needs a route" before any route: ${JSON.stringify(antesHoja)}`); else ok('LTV sheet before routing: distance and hours in shadow say "needs a route"');

  const cerrarHoja = async () => { if (await pag.isVisible(`${B} .hoja [data-a=cerrar]`)) await pag.click(`${B} .hoja [data-a=cerrar]`); };
  const abrirHojaLTV = async () => { await pag.click(`${B} .marca[data-uid="${ltv.uid}"] .pin`); await pag.waitForTimeout(150); };
  await cerrarHoja();
  await pag.selectOption(R('veh'), 'ltv');
  await pag.selectOption(R('desde'), `eq:${ltv.uid}`);
  await pag.click(R('clic-hasta'));
  await pag.mouse.click(sFondo.x, sFondo.y);
  await pag.waitForTimeout(100);
  const hasta = await pag.evaluate(() => window.__az.paneles[1].rutas.R.hasta);
  if (hasta?.tipo !== 'libre' || Math.hypot(hasta.fila - fondo.f, hasta.col - fondo.c) > 1.5) falla(`TO not set by clicking the floor (${JSON.stringify(hasta)})`); else ok(`TO set by a click on the floor at ${hasta.fila},${hasta.col}`);
  await marcarRuta();
  await pag.click(R('calcular'));
  await esperarRuta();
  const r1 = await leerR();
  const txt1 = await pag.$eval(R('res'), (d) => d.textContent.replace(/\s+/g, ' ').trim());
  if (r1.camino) ok(`LTV rim → floor: route ${(r1.medidas.longitud_m / 1000).toFixed(2)} km, max slope ${r1.medidas.pendMax.toFixed(1)}°, shadow ${(r1.medidas.sombra_m / 1000).toFixed(2)} km`);
  else {
    if (!/no route within Lunar Terrain Vehicle's slope limit \(≤ 20°\)/.test(txt1)) falla(`no-route message missing: ${txt1}`);
    ok(`LTV rim → floor: ${txt1.slice(0, 200)}`);
  }
  console.log(`time 1024² (${r1.camino ? 'route' : 'no route + minimum-slope search'}): ${r1.ms.toFixed(0)} ms`);
  await pag.waitForTimeout(200);
  await pag.screenshot({ path: join(SALIDA, '01-ruta.png') });
  await abrirHojaLTV();
  const hojaSinRuta = await filaHoja('distancia_recorrido_km');
  await cerrarHoja();
  console.log(`LTV sheet, distance row with no route: ${hojaSinRuta?.texto}`);

  // ---------- 02: LTV del borde a un destino con rodeo; allanar el tramo bloqueado ----------
  const ent = { f: Math.round((p0.f + dst.f) / 2), c: Math.round((p0.c + dst.c) / 2) };
  // El clic del destino se hace con el destino en el centro de la vista: fuera de las tarjetas y mandos superpuestos.
  const [sDst] = await vista(1, dst, 9, [dst]);
  await pag.click(R('clic-hasta'));
  await pag.mouse.click(sDst.x, sDst.y);
  await vista(1, ent, 9, [dst]);
  await marcarRuta();
  await pag.click(R('calcular'));
  await esperarRuta();
  const r2a = await leerR();
  if (!r2a.camino) falla('route to the road-test destination not found before flattening');
  else ok(`before flattening: rim → cell ${dst.f},${dst.c}: ${(r2a.medidas.longitud_m / 1000).toFixed(2)} km, max slope ${r2a.medidas.pendMax.toFixed(2)}°`);
  await abrirHojaLTV();
  const hD = await filaHoja('distancia_recorrido_km'), hH = await filaHoja('horas_en_sombra');
  // Las horas en sombra salen de la velocidad máxima: cota inferior, nunca OK bajo un tope salvo que la ruta no pise sombra.
  const hOk = /\b(rompe|cota_inferior)\b/.test(hH?.clase ?? '') || (/\bok\b/.test(hH?.clase ?? '') && /crosses no cell/.test(hH.texto));
  if (!/\b(ok|rompe)\b/.test(hD?.clase ?? '') || !hOk) falla(`LTV sheet should give verdicts once routed (hours in shadow: BREAKS or LOWER BOUND ONLY): ${JSON.stringify([hD, hH])}`);
  else ok(`LTV sheet with the route: "${hD.texto.slice(0, 120)}" | "${hH.texto.slice(0, 140)}"`);

  // Trazo de allanar sobre el tramo bloqueado de la recta.
  await cerrarHoja();
  await pag.click(`${B} [data-herr=allanar]`);
  await pag.$eval(`${B} [data-i=int]`, (i) => { i.value = 100; i.dispatchEvent(new Event('input')); });
  const radioOk = await pag.evaluate((r) => {
    const p = window.__az.paneles[1], el = p.el.querySelector('[data-i=radio]');
    let mejor = 0;
    for (let v = 0; v <= 1000; v++) { el.value = v; el.dispatchEvent(new Event('input')); if (Math.abs(p.radio_m - r) < Math.abs(mejor - r)) mejor = p.radio_m; }
    for (let v = 0; v <= 1000; v++) { el.value = v; el.dispatchEvent(new Event('input')); if (p.radio_m === mejor) break; }
    return p.radio_m;
  }, RADIO_CARRETERA_M);
  const Pt = (s) => ({ f: p0.f + (dst.f - p0.f) * s, c: p0.c + (dst.c - p0.c) * s });
  const puntos = await pag.evaluate(([a, b, K]) => {
    const e = window.__az.paneles[1].escena, out = [];
    for (let k = 0; k <= K; k++) { const f = a.f + (b.f - a.f) * k / K, c = a.c + (b.c - a.c) * k / K; const s = e.aPantalla(e.mundoDePixel(f, c)); out.push([s.x, s.y]); }
    return out;
  }, [Pt(destino.a0), Pt(destino.a1), 24]);
  for (let rep = 0; rep < 2; rep++) {
    await pag.mouse.move(...puntos[0]);
    await pag.mouse.down();
    for (const q of puntos.slice(1)) await pag.mouse.move(q[0], q[1], { steps: 3 });
    await pag.mouse.up();
    await pag.waitForTimeout(200);
  }
  await pag.click(`${B} [data-herr=navegar]`);
  const celdasRet = await pag.evaluate(() => window.__az.paneles[1].escena.delta.reduce((a, d) => a + (d !== 0 ? 1 : 0), 0));
  console.log(`flattened road: brush ${Math.round(radioOk)} m, ${celdasRet} cells retouched`);
  const obsoleta = await pag.$eval(R('res'), (d) => d.textContent);
  if (!/terrain or endpoints changed/.test(obsoleta)) falla('route not marked as stale after retouching'); else ok('route marked stale after retouching');
  await abrirHojaLTV();
  const hStale = await filaHoja('distancia_recorrido_km');
  if (!/needs a route/.test(hStale?.texto ?? '')) falla(`stale route should not feed the sheet: ${hStale?.texto}`); else ok('stale route no longer feeds the LTV sheet ("needs a route")');
  await cerrarHoja();
  await marcarRuta();
  await pag.click(R('calcular'));
  await esperarRuta();
  const r2b = await leerR();
  if (!r2b.camino) falla('route lost after flattening');
  else {
    const cambia = r2b.camino.length !== r2a.camino.length || r2b.camino.some((v, k) => v !== r2a.camino[k]);
    const dl = (r2b.medidas.longitud_m - r2a.medidas.longitud_m) / 1000;
    if (!cambia) falla('route did not change after flattening a stretch');
    else ok(`after flattening: ${(r2b.medidas.longitud_m / 1000).toFixed(2)} km (${dl >= 0 ? '+' : ''}${dl.toFixed(2)} km), max slope ${r2b.medidas.pendMax.toFixed(2)}°, path changed`);
    if (!(dl < 0)) falla('the flattened road should make the route shorter');
  }
  await pag.waitForTimeout(200);
  await pag.screenshot({ path: join(SALIDA, '02-ruta-tras-carretera.png') });

  // ---------- 03: zona apta de la torre solar ----------
  await pag.evaluate(() => { const e = window.__az.paneles[1].escena; const D = e.ladoKm * 1.2; e.controles.target.set(0, 0, 0); e.camara.position.set(0, D * Math.sin(60 * Math.PI / 180), D * Math.cos(60 * Math.PI / 180)); e.controles.update(); e.sucio = true; });
  await pag.selectOption(R('eq'), 'torre_solar');
  await pag.click(R('zona'));
  await pag.waitForFunction(() => window.__az.paneles[1].rutas.R.zonaVisible === true, null, { timeout: 60000 });
  const z = await pag.evaluate(() => { const z = window.__az.paneles[1].rutas.R.zona; return { frac: z.frac, celdas: z.celdas, apl: z.aplicados.map((a) => `${a.req.variable} ${a.req.op} ${a.req.valor}`), omi: z.omitidos.map((a) => `${a.req.variable}: ${a.motivo}`), ms: z.ms }; });
  const txtZ = await pag.$eval(R('res-zona'), (d) => d.textContent.replace(/\s+/g, ' ').trim());
  if (!(z.celdas > 0) || !/% of this terrain/.test(txtZ)) falla(`solar tower zone empty or unlabelled: ${txtZ}`); else ok(`solar tower zone: ${(100 * z.frac).toFixed(1)} % (${z.celdas} cells) in ${z.ms.toFixed(0)} ms · applied ${z.apl.join(', ')} · omitted ${z.omi.join(', ') || 'none'}`);
  await pag.waitForTimeout(250);
  await pag.screenshot({ path: join(SALIDA, '03-zona-apta.png') });

  // ---------- 04: sugerencias TOPSIS y plantar la primera ----------
  await pag.click(R('sugerir'));
  await pag.waitForFunction(() => window.__az.paneles[1].rutas.R.sug, null, { timeout: 60000 });
  const sug = await pag.evaluate(() => window.__az.paneles[1].rutas.R.sug.lista.map((x) => ({ f: x.fila, c: x.col, s: x.puntuacion, v: x.valores })));
  const sep = Math.min(...sug.flatMap((a, i) => sug.slice(i + 1).map((b) => Math.hypot(a.f - b.f, a.c - b.c) * M)));
  if (sug.length !== 5 || !(sep >= 1000)) falla(`expected 5 suggestions ≥ 1 km apart: ${sug.length}, min ${sep.toFixed(0)} m`); else ok(`5 suggestions, min spacing ${(sep / 1000).toFixed(2)} km; best: score ${sug[0].s.toFixed(3)} ${JSON.stringify(sug[0].v)}`);
  const antesSug = await pag.evaluate(() => window.__az.paneles[1].plantados.lista.length);
  await pag.click(`${B} .rutas [data-plantar-sug="0"]`);
  await pag.waitForTimeout(150);
  const torre = await pag.evaluate(() => window.__az.paneles[1].plantados.lista.at(-1));
  if (antesSug + 1 !== await pag.evaluate(() => window.__az.paneles[1].plantados.lista.length) || torre.equipo !== 'torre_solar' || torre.fila !== sug[0].f || torre.col !== sug[0].c) falla(`clicking suggestion 1 did not plant the tower there (${JSON.stringify(torre)})`);
  else ok(`suggestion 1 planted: solar tower at ${torre.fila},${torre.col}`);
  const hojaTorre = await filaHoja('pendiente_deg');
  if (!/\bok\b/.test(hojaTorre?.clase ?? '')) falla(`tower planted at a suggestion should pass its slope limit: ${hojaTorre?.texto}`);
  await cerrarHoja();
  await pag.waitForTimeout(200);
  await pag.screenshot({ path: join(SALIDA, '04-sugerencias.png') });

  // Separación: el reactor respeta ≥ 1 km del hábitat si está plantado; el hábitat no tiene requisito medible.
  await pag.selectOption(R('eq'), 'habitat_superficie');
  await pag.click(R('zona'));
  await pag.waitForFunction(() => window.__az.paneles[1].rutas.R.zona?.equipo === 'habitat_superficie', null, { timeout: 60000 });
  const txtHab = await pag.$eval(R('res-zona'), (d) => d.textContent);
  if (!/no measurable requirement in the catalogue/.test(txtHab)) falla(`habitat should have no measurable requirement: ${txtHab}`); else ok('habitat: "no measurable requirement in the catalogue", no overlay');
  // Hábitat en la sugerencia más alejada de lo ya plantado (para no hacer clic sobre otro marcador).
  const yaPlantado = await pag.evaluate(() => window.__az.paneles[1].plantados.lista.map((x) => ({ f: x.fila, c: x.col })));
  const lejos = sug.slice(1).map((s) => ({ s, d: Math.min(...yaPlantado.map((q) => Math.hypot(q.f - s.f, q.c - s.c))) })).sort((a, b) => b.d - a.d)[0].s;
  const [sHab] = await vista(1, lejos, 12, [lejos]);
  await cerrarHoja();
  await pag.click(`${B} .ver-paleta`);
  await pag.click(`${B} .paleta [data-eq=habitat_superficie]`);
  await pag.mouse.click(sHab.x, sHab.y);
  await pag.waitForTimeout(150);
  const hab = await pag.evaluate(() => window.__az.paneles[1].plantados.lista.find((x) => x.equipo === 'habitat_superficie'));
  if (!hab) falla(`habitat not planted (${JSON.stringify(sHab)} → ${await pag.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return `${el?.tagName}.${el?.className?.baseVal ?? el?.className}`; }, [sHab.x, sHab.y])}, plant mode ${await pag.evaluate(() => window.__az.paneles[1].plantar)})`);
  await pag.selectOption(R('eq'), 'reactor_fision');
  await pag.click(R('zona'));
  await pag.waitForFunction(() => window.__az.paneles[1].rutas.R.zona?.equipo === 'reactor_fision', null, { timeout: 60000 });
  const zr = await pag.evaluate(([f, c]) => {
    const z = window.__az.paneles[1].rutas.R.zona, n = window.__az.paneles[1].escena.n, m = window.__az.paneles[1].escena.m;
    let dentro = 0, fuera = 0;
    for (let i = 0; i < n * n; i++) { const d = Math.hypot(Math.floor(i / n) - f, (i % n) - c) * m; if (z.mascara?.[i] && d < 1000) dentro++; if (z.mascara?.[i]) fuera++; }
    return { dentro, apt: fuera, apl: z.aplicados.map((a) => a.req.variable) };
  }, [hab.fila, hab.col]);
  if (!zr.apl.includes('separacion_m') || zr.dentro !== 0 || !zr.apt) falla(`reactor zone should apply ≥ 1 km from the habitat: ${JSON.stringify(zr)}`); else ok(`reactor zone applies the 1 km separation from the planted habitat (${zr.apt} cells, none closer than 1 km)`);
  await pag.click(R('zona'));

  // ---------- 05: visitar todos ----------
  await pag.selectOption(R('eq'), 'viper');
  await pag.click(R('sugerir'));
  await pag.waitForFunction(() => window.__az.paneles[1].rutas.R.sug?.equipo === 'viper', null, { timeout: 60000 });
  // Primera sugerencia de VIPER que no cae a menos de 1 km de algo ya plantado.
  const libreVip = await pag.evaluate(() => {
    const p = window.__az.paneles[1], m = p.escena.m;
    return p.rutas.R.sug.lista.findIndex((x) => p.plantados.lista.every((q) => Math.hypot(q.fila - x.fila, q.col - x.col) * m >= 1000));
  });
  await pag.click(`${B} .rutas [data-plantar-sug="${Math.max(0, libreVip)}"]`);
  await pag.waitForTimeout(150);
  await cerrarHoja();
  const paradas = await pag.$$eval(`${B} .rutas [data-parada]`, (xs) => xs.map((x) => +x.dataset.parada));
  for (const uid of paradas.slice(0, 8)) await pag.check(`${B} .rutas [data-parada="${uid}"]`);
  await pag.selectOption(R('veh'), 'ltv');
  await pag.click(R('visitar'));
  await pag.waitForFunction(() => window.__az.paneles[1].rutas.R.visita?.ms !== undefined, null, { timeout: 120000 });
  const vis = await pag.evaluate(() => { const v = window.__az.paneles[1].rutas.R.visita; return { orden: v.orden, coste: v.coste, km: v.medidas ? v.medidas.longitud_m / 1000 : null, ms: v.ms, n: v.puntos.length }; });
  const txtV = await pag.$eval(R('res-visita'), (d) => d.textContent.replace(/\s+/g, ' ').trim());
  if (vis.orden) ok(`visit all ${vis.n} stops with LTV: order ${vis.orden.join('→')}→0, ${vis.km.toFixed(2)} km, ${vis.ms.toFixed(0)} ms`);
  else if (/no round trip within/.test(txtV)) ok(`visit all ${vis.n} stops: ${txtV.slice(0, 200)}`);
  else falla(`visit all gave neither an order nor a message: ${txtV}`);
  // Encuadre de las paradas.
  const caja = await pag.evaluate(() => { const l = window.__az.paneles[1].plantados.lista; const fs = l.map((x) => x.fila), cs = l.map((x) => x.col); return { f: (Math.min(...fs) + Math.max(...fs)) / 2, c: (Math.min(...cs) + Math.max(...cs)) / 2, ext: Math.max(Math.max(...fs) - Math.min(...fs), Math.max(...cs) - Math.min(...cs)) }; });
  await vista(1, { f: Math.round(caja.f), c: Math.round(caja.c) }, Math.max(8, (caja.ext * M) / 1000 * 2.4), []);
  await pag.waitForTimeout(250);
  await pag.screenshot({ path: join(SALIDA, '05-visita-todas.png') });

  // ---------- Tierra: sin capa de sombra ----------
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(200);
  await pag.click('.panel[data-lado=a] .ampliar');
  await pag.waitForTimeout(300);
  const tierra = await pag.evaluate(async () => {
    const p = window.__az.paneles[0], r = p.rutas, n = p.escena.n;
    r.R.desde = { tipo: 'libre', fila: Math.round(n * 0.3), col: Math.round(n * 0.3) };
    r.R.hasta = { tipo: 'libre', fila: Math.round(n * 0.7), col: Math.round(n * 0.65) };
    await r.calcular();
    return { txt: p.el.querySelector('.rutas [data-r="res"]').textContent.replace(/\s+/g, ' ').trim(), ms: r.R.res?.ms, camino: !!r.R.res?.camino };
  });
  if (tierra.camino && !/PERM\. SHADOW\s*not measured on this terrain/.test(tierra.txt)) falla(`Earth route should say shadow is not measured: ${tierra.txt}`);
  else ok(`Earth panel route: ${tierra.txt.slice(0, 160)}`);
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
}

// ---------- Agua: pistas sugeridas en Haughton y ruta que bordea el lago de Mistastin ----------
try {
  const pag3 = await nav.newPage({ viewport: { width: 1600, height: 900 } });
  pag3.on('pageerror', (e) => falla(`page error (water): ${e.message}`));
  pag3.on('worker', (w) => w.on('console', (m) => { if (m.type() === 'error') falla(`worker console (water): ${m.text()}`); }));
  const A = '.panel[data-lado=a] .rutas';
  await pag3.goto(`${baseUrl}/terreno/index.html?a=haughton&b=shackleton&solo=haughton`);
  await pag3.waitForFunction(() => window.__az?.listo === true, null, { timeout: 60000 });
  await pag3.selectOption(`${A} [data-r="eq"]`, 'pista_aterrizaje');
  await pag3.click(`${A} [data-r="sugerir"]`);
  await pag3.waitForFunction(() => window.__az.paneles[0].rutas.R.sug, null, { timeout: 60000 });
  const pistas = await pag3.evaluate((A) => {
    const p = window.__az.paneles[0], e = p.escena;
    return { sug: p.rutas.R.sug.lista.map((x) => ({ f: x.fila, c: x.col, agua: e.capas.agua[x.i], cota: e.actual[x.i] })), zona: document.querySelector(`${A} [data-r="agua-zona"]`)?.textContent.replace(/\s+/g, ' ').trim() ?? null };
  }, A);
  const mojadas = pistas.sug.filter((s) => s.agua >= 1);
  if (pistas.sug.length !== 5 || mojadas.length || !/water excluded/.test(pistas.zona ?? '')) falla(`Haughton landing pads: ${pistas.sug.length} suggested, ${mojadas.length} on water (${JSON.stringify(mojadas)}); zone line ${JSON.stringify(pistas.zona)}`);
  else ok(`Haughton landing pads: 5 suggestions, none on water (${pistas.sug.map((s) => `${s.f},${s.c} ${s.cota.toFixed(1)} m`).join(' · ')}); "${pistas.zona}"`);
  await pag3.waitForTimeout(200);
  await pag3.screenshot({ path: join(SALIDA, '06-pistas-haughton-sin-mar.png') });

  // Mistastin: fila con el tramo de lago más largo; de una orilla a la otra con el LTV.
  await pag3.goto(`${baseUrl}/terreno/index.html?a=mistastin&b=shackleton&solo=mistastin`);
  await pag3.waitForFunction(() => window.__az?.listo === true, null, { timeout: 60000 });
  const lago = await pag3.evaluate(async (A) => {
    const p = window.__az.paneles[0], e = p.escena, n = e.n, a = e.capas.agua;
    let mejor = null;
    for (let f = 0; f < n; f++) {
      let c0 = -1;
      for (let c = 0; c <= n; c++) {
        const w = c < n && a[f * n + c] >= 1;
        if (w && c0 < 0) c0 = c;
        if (!w && c0 >= 0) { if (!mejor || c - c0 > mejor.L) mejor = { f, c0, c1: c - 1, L: c - c0 }; c0 = -1; }
      }
    }
    document.querySelector(`${A} [data-r="veh"]`).value = 'ltv';
    p.rutas.R.desde = { tipo: 'libre', fila: mejor.f, col: mejor.c0 - 15 };
    p.rutas.R.hasta = { tipo: 'libre', fila: mejor.f, col: mejor.c1 + 15 };
    await p.rutas.calcular();
    const r = p.rutas.R.res, cam = r.camino ? Array.from(r.camino) : [];
    const res = { mejor, ruta: !!r.camino, km: r.medidas ? r.medidas.longitud_m / 1000 : null, enAgua: cam.filter((i) => a[i] >= 1).length, recta_km: (mejor.L + 30) * e.m / 1000,
      resumen: /water cells of the Copernicus DEM water body mask treated as impassable/.test(document.querySelector(`${A} [data-r="res"]`).textContent) };
    p.rutas.R.hasta = { tipo: 'libre', fila: mejor.f, col: Math.round((mejor.c0 + mejor.c1) / 2) };
    await p.rutas.calcular();
    res.alLago = document.querySelector(`${A} [data-r="sin-ruta"]`)?.textContent ?? null;
    return res;
  }, A);
  if (!lago.ruta || lago.enAgua || !lago.resumen) falla(`Mistastin route across the lake: ${JSON.stringify(lago)}`);
  else ok(`Mistastin LTV route from shore to shore of the lake (row ${lago.mejor.f}, ${lago.mejor.L} lake cells on the straight line): ${lago.km.toFixed(2)} km vs ${lago.recta_km.toFixed(2)} km straight, 0 cells on water, summary says water is impassable`);
  if (!/TO is on water \(lake\)/.test(lago.alLago ?? '') || /slope/.test(lago.alLago ?? '')) falla(`route to a point in the lake should say "TO is on water", not slope: ${JSON.stringify(lago.alLago)}`);
  else ok(`route to the middle of the lake: "${lago.alLago}"`);
  await pag3.close();
} catch (e) {
  falla(`script (water): ${e.stack ?? e.message}`);
}

// ---------- 2048²: polo_sur ----------
try {
  const pag2 = await nav.newPage({ viewport: { width: 1600, height: 900 } });
  pag2.on('console', (m) => { if (m.type() === 'error') falla(`console (polo_sur): ${m.text()}`); });
  pag2.on('pageerror', (e) => falla(`page error (polo_sur): ${e.message}`));
  await pag2.goto(`${baseUrl}/terreno/index.html?a=haughton&b=polo_sur&solo=polo_sur`);
  await pag2.waitForFunction(() => window.__az?.listo === true, null, { timeout: 120000 });
  const t2048 = await pag2.evaluate(async () => {
    const p = window.__az.paneles[1], r = p.rutas, n = p.escena.n, out = [];
    // Peor caso: sin ruta (explora todo el componente y luego busca la pendiente mínima). Celda más iluminada → la más baja del cuarto central.
    const e = p.escena, ilu = e.capas.iluminacion;
    let iMax = 0, iMin = -1;
    for (let i = 0; i < n * n; i++) if (ilu[i] > ilu[iMax]) iMax = i;
    for (let f = n / 4; f < (3 * n) / 4; f++) for (let c = n / 4; c < (3 * n) / 4; c++) { const i = f * n + c; if (iMin < 0 || e.actual[i] < e.actual[iMin]) iMin = i; }
    const pares = [[[0.1, 0.1], [0.9, 0.9]], [[0.5, 0.5], [0.1, 0.9]], [[Math.floor(iMax / n) / n, (iMax % n) / n], [Math.floor(iMin / n) / n, (iMin % n) / n]]];
    for (const [a, b] of pares) {
      r.R.desde = { tipo: 'libre', fila: Math.round(n * a[0]), col: Math.round(n * a[1]) };
      r.R.hasta = { tipo: 'libre', fila: Math.round(n * b[0]), col: Math.round(n * b[1]) };
      await r.calcular();
      const x = r.R.res;
      out.push({ n, ms: x.ms, ruta: !!x.camino, km: x.medidas ? x.medidas.longitud_m / 1000 : null, diezmado: x.diezmado, umbral: x.umbral ?? null });
    }
    return out;
  });
  for (const x of t2048) console.log(`time ${x.n}²: ${x.ms.toFixed(0)} ms (${x.ruta ? `route ${x.km.toFixed(1)} km` : `no route, minimum slope ${x.umbral?.toFixed(1)}°`}${x.diezmado ? ', decimated ×2' : ''})`);
  await pag2.close();
} catch (e) {
  falla(`script (polo_sur): ${e.stack ?? e.message}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA_RUTAS: ${fallos.length} failure(s)` : 'CAPTURA_RUTAS: ok');
process.exit(fallos.length ? 1 : 0);

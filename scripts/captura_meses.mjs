// Lugar + mes en la pantalla de resultados, en Chromium: selector «When», descargas solo de los ficheros mensuales usados,
// lista, Metrics, Compare, Portfolio y capa iguales a motor.js en node con `mes`; tiras de 12 meses = perfilMensual;
// pestaña Calendar = calendario y plan de repetición = planRepetir; URL, ida y vuelta a la pantalla del mundo; fallo de descarga; móvil; contraste.
// Uso: node scripts/captura_meses.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { cargar } from '../web/buscar/motor.js';
import { formatoLatLon, vectorALatLon } from '../web/explorar/geo.js';
import { fmtPct, formatoValor as formatoValorSup, planoSup, minMax, colorRampa, SIN_COMPARAR, titularCartera, nombreCorto } from '../web/analogos/metricas.js';
import { activaDeCatalogo, opcionesBusqueda } from '../web/analogos/misiones.js';
import { MESES_LARGO, idsMensuales, planRepetir, moverEnMes, fraseRepetir, lineaMejorPeor, lineaMesActivo, etiquetaMes, escalaTiras } from '../web/analogos/meses.js';
import { paisDe } from '../web/analogos/paises.js';
import { contraste } from '../web/marca/contraste.js';

const formatoValor = (v, u, p) => planoSup(formatoValorSup(v, u, p));
const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'meses');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

const fallos = [];
const falla = (m) => { fallos.push(m); console.error(`FAIL ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);

// ---------- Referencia en node ----------
const M = await cargar(join(WEB, 'data/cuerpos') + '/', async (ruta, tipo) => {
  const b = await readFile(ruta);
  return tipo === 'json' ? JSON.parse(b.toString('utf8')) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});
await M.cargarMeses();
const P = Object.fromEntries([...M.indice.parametros, ...M.indice.parametros_tierra].map((p) => [p.id, p]));
const corto = (id) => nombreCorto(id, P);
const SITIOS = JSON.parse(readFileSync(join(WEB, 'data/sitios_ensayo.json'), 'utf8')).sitios;
const CATALOGO = JSON.parse(readFileSync(join(WEB, 'data/misiones.json'), 'utf8')).misiones;
const PAISES = JSON.parse(readFileSync(join(WEB, 'data/paises_110m.json'), 'utf8')).paises;
const pais = (x) => paisDe(x.lat, x.lon, PAISES);
const donde = (x) => `${formatoLatLon(x.lat, x.lon).texto}${pais(x) ? ` (${pais(x)})` : ''}`;
const J = { lat: 18.38, lon: 77.58 };
const URL_J = `/analogos/index.html?mundo=mars&lat=${J.lat}&lon=${J.lon}&nombre=Jezero`;
const oJ = M.leerPunto('mars', J.lat, J.lon);
const ficheros = (opc) => idsMensuales(opc, M.indice).map((id) => `/data/cuerpos/${P[id].meses.earth}`).sort();
const r0 = M.buscar(oJ);
const r7 = M.buscar(oJ, { mes: 7 });
const c7 = M.cartera(oJ, { mes: 7 });
const aB = activaDeCatalogo(CATALOGO.find((m) => m.id === 'biomarcadores'), M.indice, SITIOS);
const rB7 = M.buscar(oJ, { ...opcionesBusqueda(aB), mes: 7 });

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

// pedidos: rutas de earth/mes/ pedidas por la página. ignorar404: el fallo simulado deja su línea en la consola.
async function pagina(ancho, alto, etiqueta, opciones = {}, ignorar404 = false) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: alto }, ...opciones });
  const pag = await ctx.newPage();
  pag.pedidos = [];
  pag.on('request', (q) => { const u = new URL(q.url()); if (u.pathname.includes('/earth/mes/')) pag.pedidos.push(u.pathname); });
  pag.on('console', (m) => {
    if (ignorar404 && /404/.test(m.text())) return;
    if (m.type() === 'error' || m.type() === 'warning') falla(`console ${m.type()} (${etiqueta}): ${m.text()}`);
  });
  pag.on('pageerror', (e) => falla(`page error (${etiqueta}): ${e.message}`));
  return pag;
}
async function esperarQue(pag, f, que, ms = 30000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await pag.evaluate(f, arg)) return; await pag.waitForTimeout(80); }
  throw new Error(`timeout waiting for ${que}`);
}
const abrir = async (pag, url) => {
  await pag.goto(`${baseUrl}${url}`);
  await pag.waitForFunction(() => window.__az?.analogos?.listo === true, null, { timeout: 120000 });
  await pag.evaluate(() => { window.__az.analogos.autoTerreno = false; });
  const e = await pag.evaluate(() => window.__az.analogos.errores);
  if (e.length) falla(`analogs page errors: ${e.join('; ')}`);
};
const quieta = (pag) => esperarQue(pag, () => new Promise((ok) => {
  const v = window.__az.analogos.vista, a = v.camara.position.clone();
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => ok(!v.animando() && v.camara.position.distanceTo(a) < 1e-12))));
}), 'the camera to stop');
const ver = async (pag, tab) => { await pag.click(`#tab-${tab}`); await pag.waitForTimeout(250); };
const elegirMes = async (pag, m) => {
  await pag.selectOption('#mes', m === null ? '' : String(m));
  await esperarQue(pag, (m) => window.__az.analogos.mes === m && (m === null || window.__az.analogos.r.mes === m) && window.__az.analogos.mesEstado !== 'cargando', `month ${m} applied`, 60000, m);
};

const leerLugares = (pag, sel = '#lista') => pag.evaluate((sel) => [...document.querySelectorAll(`${sel} > .tarjeta`)].map((t) => ({
  pct: t.querySelector('.pct span').textContent, coords: t.querySelector('.coords').textContent,
})), sel);
function compararLugares(que, dom, esperado) {
  if (dom.length !== esperado.length) { falla(`${que}: ${dom.length} cards on screen, node has ${esperado.length}`); return; }
  esperado.forEach((x, k) => {
    const quiero = { pct: fmtPct(x.similitud_pct), coords: formatoLatLon(x.lat, x.lon).texto };
    for (const [kk, v] of Object.entries(quiero)) if (dom[k][kk] !== v) falla(`${que} card ${k + 1} ${kk}: screen "${dom[k][kk]}" ≠ node "${v}"`);
  });
  ok(`${que}: ${dom.map((d, k) => `${k + 1}. ${d.pct} ${d.coords}`).join(' | ')} = node`);
}
const leerMetricas = (pag) => pag.evaluate(() => [...document.querySelectorAll('#metricas .grupo .fila')].map((f) => ({
  id: f.dataset.id, rotulo: f.querySelectorAll('.valores dt')[0].textContent, rotuloTierra: f.querySelectorAll('.valores dt')[1].textContent,
  objetivo: f.querySelector('[data-v=objetivo]').textContent, tierra: f.querySelector('[data-v=tierra]').textContent, desv: f.querySelector('[data-v=desv]').textContent,
})));
function compararMetricas(que, dom, x, r, mes, rotuloRef = 'NASA test site') {
  const comparables = x.parametros.filter((p) => p.estado === 'ok' || p.estado === 'sin_dato_tierra');
  if (dom.length !== comparables.length) falla(`${que}: ${dom.length} rows, node has ${comparables.length}`);
  const n = MESES_LARGO[mes - 1];
  for (const p of comparables) {
    const f = dom.find((z) => z.id === p.id);
    if (!f) { falla(`${que}: row ${p.id} missing`); continue; }
    const mensual = r.mensuales.includes(p.id);
    const quiero = { rotulo: p.origen_objetivo === 'referencia' ? `${rotuloRef}${mensual ? `, ${n}` : ''}` : 'Mars (year average)', rotuloTierra: mensual ? `Earth, ${n}` : 'Earth',
      objetivo: formatoValor(p.valor_objetivo, P[p.id].unidad, P[p.id]), tierra: formatoValor(p.valor_tierra, P[p.id].unidad, P[p.id]), desv: p.desviacion_pct === null ? 'no data' : `${fmtPct(p.desviacion_pct)} off` };
    for (const [k, v] of Object.entries(quiero)) if (f[k] !== v) falla(`${que} ${p.id} ${k}: screen "${f[k]}" ≠ node "${v}"`);
  }
  ok(`${que}: ${dom.map((f) => `${f.id} [${f.rotulo} ${f.objetivo} / ${f.rotuloTierra} ${f.tierra}] ${f.desv}`).join(' · ')} = node`);
}
// Tiras: por tarjeta, 12 casillas con su etiqueta, color, mes activo y líneas.
const leerTiras = (pag, sel) => pag.evaluate((sel) => [...document.querySelectorAll(`${sel} > .tarjeta`)].map((t) => ({
  coords: t.querySelector('.coords').textContent,
  meses: [...t.querySelectorAll('.tira .mes')].map((li) => ({ mes: Number(li.dataset.mes), etiqueta: li.getAttribute('aria-label'), title: li.title, actual: li.getAttribute('aria-current'), fondo: getComputedStyle(li.querySelector('.casilla')).backgroundColor })),
  lineas: [...t.querySelectorAll('.tira-linea')].map((p) => p.textContent),
})), sel);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function compararTiras(que, dom, lugares, mes, esc) {
  if (dom.length !== lugares.length) { falla(`${que}: ${dom.length} cards, node ${lugares.length}`); return; }
  const errores = [];
  lugares.forEach((x, k) => {
    const per = M.perfilMensual(oJ, { lat: x.lat, lon: x.lon }, x.opc ?? {});
    const d = dom[k];
    if (d.meses.length !== 12) { errores.push(`card ${k + 1}: ${d.meses.length} boxes`); return; }
    const den = esc.max > esc.min ? esc.max - esc.min : 1;
    per.forEach((p, i) => {
      const q = d.meses[i];
      const rgb = p.similitud_pct === null ? hex(SIN_COMPARAR) : colorRampa((p.similitud_pct - esc.min) / den);
      if (q.mes !== p.mes || q.etiqueta !== etiquetaMes(p) || q.title !== etiquetaMes(p) || q.fondo !== `rgb(${rgb.join(', ')})`) errores.push(`card ${k + 1} ${p.mes}: ${JSON.stringify(q)} ≠ ${etiquetaMes(p)} rgb(${rgb})`);
      if ((q.actual === 'true') !== (p.mes === mes)) errores.push(`card ${k + 1} month ${p.mes} active ${q.actual}`);
    });
    const lineas = [lineaMejorPeor(per), ...(mes ? [lineaMesActivo(per, mes)] : [])];
    if (JSON.stringify(d.lineas) !== JSON.stringify(lineas)) errores.push(`card ${k + 1} lines ${JSON.stringify(d.lineas)} ≠ ${JSON.stringify(lineas)}`);
  });
  if (errores.length) falla(`${que}: ${errores.slice(0, 6).join('; ')}`);
  else ok(`${que}: ${dom.length} cards × 12 boxes = perfilMensual (labels, ramp colours, active month ${mes ?? 'none'}); e.g. «${dom[0].meses[6].etiqueta}», «${dom[0].lineas.join(' / ')}»`);
}
const perfilesDe = (lugares, opc = {}) => lugares.map((x) => M.perfilMensual(oJ, { lat: x.lat, lon: x.lon }, opc));

// Contraste (mismo criterio que captura_misiones: panel translúcido sobre blanco como peor caso).
const leerContraste = (pag, selector) => pag.evaluate((selector) => {
  const rgba = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(',').map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; };
  const vistos = new Map();
  for (const raiz of document.querySelectorAll(selector)) {
    const nodos = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    for (let n = nodos.nextNode(); n; n = nodos.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest('[hidden], option, details:not([open]) > :not(summary)')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || el.closest('button:disabled')) continue;
      const color = rgba(cs.color);
      const capas = [];
      for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
        const b = rgba(getComputedStyle(a).backgroundColor);
        if (b && b[3] > 0) capas.push(b);
        if (b && b[3] >= 1) break;
      }
      let fondo = [255, 255, 255];
      for (const c of capas.reverse()) fondo = fondo.map((v, i) => c[3] * c[i] + (1 - c[3]) * v);
      const texto = color.slice(0, 3).map((v, i) => color[3] * v + (1 - color[3]) * fondo[i]);
      const clave = `${texto.map(Math.round)}|${fondo.map(Math.round)}`;
      if (!vistos.has(clave)) vistos.set(clave, { texto, fondo, muestra: n.textContent.trim().slice(0, 40), rojo: (color[0] === 228 && color[1] === 55 && color[2] === 0) || (color[0] === 142 && color[1] === 17 && color[2] === 0) });
    }
  }
  return [...vistos.values()];
}, selector);
async function revisarContraste(pag, que, selector) {
  const t = await leerContraste(pag, selector);
  const malas = t.filter((x) => x.rojo || contraste(x.texto, x.fondo) < 4.5);
  if (!t.length) falla(`${que}: no text found for ${selector}`);
  else if (malas.length) falla(`${que}: contrast < 4.5 or red text → ${malas.map((x) => `"${x.muestra}" ${contraste(x.texto, x.fondo).toFixed(2)}`).join('; ')}`);
  else ok(`${que}: ${t.length} text/background pairs, all ≥ 4.5:1 (worst case: panel over white)`);
}
// Nada se sale de la pantalla ni del panel (las tablas no deben necesitar barra horizontal).
const fuera = (pag, selector) => pag.evaluate((selector) => {
  const malos = [];
  const p = document.getElementById('panel').getBoundingClientRect();
  for (const e of document.querySelectorAll(selector)) {
    if (e.closest('[hidden]') || !e.getClientRects().length) continue;
    const r = e.getBoundingClientRect();
    if (r.width && (r.left < Math.max(0, p.left) - 0.5 || r.right > Math.min(innerWidth, p.right) + 0.5)) malos.push(`${e.id || e.className || e.tagName} x ${r.left.toFixed(0)}–${r.right.toFixed(0)} (panel ${p.left.toFixed(0)}–${p.right.toFixed(0)})`);
  }
  for (const t of document.querySelectorAll('#calendario .tabla-scroll')) if (!t.closest('[hidden]') && t.scrollWidth > t.clientWidth + 1) malos.push(`calendar table scrolls (${t.scrollWidth} > ${t.clientWidth})`);
  if (document.documentElement.scrollWidth > innerWidth) malos.push(`page ${document.documentElement.scrollWidth} px wide`);
  const tabs = [...document.querySelectorAll('.pestanas button')].map((b) => b.getBoundingClientRect());
  if (tabs.some((t) => t.height < 44 || t.right > p.right + 0.5 || t.left < p.left - 0.5)) malos.push(`tabs: ${tabs.map((t) => `${t.left.toFixed(0)}–${t.right.toFixed(0)}×${t.height.toFixed(0)}`).join(' ')}`);
  return malos;
}, selector);

try {
  // ---------- a. Sin mes: no se pide ningún fichero mensual ----------
  const pag = await pagina(1440, 900, 'Mars desktop');
  await abrir(pag, URL_J);
  await quieta(pag);
  await pag.waitForTimeout(500);
  const a0 = await pag.evaluate(() => ({ valor: document.getElementById('mes').value, opciones: [...document.getElementById('mes').options].map((o) => o.textContent), rotulo: document.querySelector('label[for=mes]').textContent,
    boton: !document.getElementById('ver-meses').hidden, tiras: document.querySelectorAll('.tira-caja').length, chip: document.getElementById('mes-activo').hidden, h1: document.querySelector('#lugares h1').textContent, tabs: [...document.querySelectorAll('.pestanas button')].map((b) => b.textContent), avanzado: document.getElementById('avanzado').hidden }));
  const quieroOpc = ['Whole year (average)', ...MESES_LARGO];
  if (pag.pedidos.length || a0.valor !== '' || JSON.stringify(a0.opciones) !== JSON.stringify(quieroOpc) || a0.rotulo !== 'When' || !a0.boton || a0.tiras || !a0.chip || a0.h1 !== 'Most similar places on Earth' || a0.tabs.join() !== 'Places,Metrics,Portfolio,Calendar' || a0.avanzado) falla(`no month: ${JSON.stringify({ ...a0, pedidos: pag.pedidos })}`);
  else ok(`no month (Jezero 18.38 N 77.58 E): 0 requests to earth/mes/; "When" = ${a0.opciones[0]} + 12 months; no strips, button "Show how…" shown; tabs ${a0.tabs.join(' | ')}`);
  compararLugares('no month places', await leerLugares(pag), r0.resultados);
  await pag.screenshot({ path: join(SALIDA, '00-sin-mes.png') });

  // ---------- b. July ----------
  await pag.click('label.interruptor:has(#capa)');
  await pag.waitForTimeout(300);
  await elegirMes(pag, 7);
  await quieta(pag);
  const pedidosB = [...pag.pedidos].sort();
  if (JSON.stringify(pedidosB) !== JSON.stringify(ficheros({}))) falla(`July requests: ${JSON.stringify(pedidosB)} ≠ ${JSON.stringify(ficheros({}))}`);
  else ok(`July: requested only the ${pedidosB.length} monthly files the search uses, once each: ${pedidosB.map((p) => p.split('/').pop()).join(', ')}`);
  const l7 = await leerLugares(pag);
  compararLugares('July places = M.buscar({ mes: 7 })', l7, r7.resultados);
  const distinta = JSON.stringify(r7.resultados.map((x) => [x.lat, x.lon])) !== JSON.stringify(r0.resultados.map((x) => [x.lat, x.lon]));
  if (!distinta) falla('July list is the same as the whole-year list'); else ok(`July list differs from the whole-year one (year: ${r0.resultados.map((x) => formatoLatLon(x.lat, x.lon).texto).join(' | ')})`);
  const b7 = await pag.evaluate(() => ({ url: location.search, chip: document.getElementById('mes-activo').hidden ? null : document.getElementById('mes-activo').textContent, h1: document.querySelector('#lugares h1').textContent, avanzado: document.getElementById('avanzado').hidden, volver: document.getElementById('volver').getAttribute('href'), estado: document.getElementById('mes-estado').hidden, ley: [document.getElementById('ley-min').textContent, document.getElementById('ley-max').textContent], cart: document.getElementById('cartera-titular').textContent }));
  const mm7 = minMax(r7.mapa);
  if (!b7.url.endsWith('&mes=7') || b7.chip !== 'Earth in July' || b7.h1 !== 'Most similar places on Earth in July' || !b7.avanzado || !b7.volver.endsWith('&mes=7') || !b7.estado || b7.ley.join() !== [fmtPct(mm7.min), fmtPct(mm7.max)].join() || b7.cart !== titularCartera(c7)) falla(`July state: ${JSON.stringify(b7)}`);
  else ok(`July: URL ${b7.url}; chip "${b7.chip}"; title "${b7.h1}"; "Advanced" hidden; similarity legend ${b7.ley.join(' – ')} = node; Portfolio "${b7.cart}"; back link ${b7.volver}`);
  await pag.click('label.interruptor:has(#capa)');
  await ver(pag, 'metricas');
  compararMetricas('July Metrics place 1', await leerMetricas(pag), r7.resultados[0], r7, 7);
  const nota = await pag.evaluate(() => document.querySelector('#metricas .mes-nota')?.textContent);
  if (!nota?.startsWith('Earth in July: ') || !r7.mensuales.every((id) => nota.includes(corto(id)))) falla(`Metrics month note: ${nota}`); else ok(`Metrics: "${nota}"`);
  await pag.click('#metricas .comparar summary');
  await pag.waitForTimeout(150);
  const tabla = await pag.evaluate(() => [...document.querySelectorAll('#metricas .tabla-comparar tbody tr')].map((tr) => ({ id: tr.dataset.id, mes: tr.querySelector('th small')?.textContent ?? null, obj: tr.querySelector('td.objetivo small')?.textContent ?? null })));
  const malT = tabla.filter((t) => t.mes !== (r7.mensuales.includes(t.id) ? 'Earth: July' : null) || t.obj !== 'year average');
  if (malT.length || !tabla.length) falla(`Compare with month: ${JSON.stringify(malT)}`); else ok(`Compare: monthly rows marked "Earth: July" (${tabla.filter((t) => t.mes).map((t) => t.id).join(', ')}), your point "year average"`);
  await pag.screenshot({ path: join(SALIDA, '01-julio-metrics.png') });
  await revisarContraste(pag, 'Metrics with a month', '#metricas');
  await ver(pag, 'lugares');

  // ---------- c. Tiras ----------
  const lugares7 = [...r7.resultados, ...r7.parciales, ...c7.lugares];
  const esc7 = escalaTiras(perfilesDe(lugares7));
  compararTiras('July strips, places', await leerTiras(pag, '#lista'), r7.resultados, 7, esc7);
  compararTiras('July strips, portfolio', await leerTiras(pag, '#lista-cartera'), c7.lugares, 7, esc7);
  const escala = await pag.evaluate(() => document.getElementById('tiras-escala').textContent);
  if (!escala.includes(fmtPct(esc7.min)) || !escala.includes(fmtPct(esc7.max))) falla(`strip scale line: ${escala}`); else ok(`strip scale: "${escala}"`);
  await pag.$eval('#lista', (e) => e.scrollIntoView({ block: 'start' }));
  await pag.screenshot({ path: join(SALIDA, '02-julio-tiras.png') });
  await revisarContraste(pag, 'strips and month lines', '#lista .tira-caja, #tiras-escala, #mes-activo, .mes-caja');
  let malos = await fuera(pag, '#panel .tira-caja, #panel .tira-caja *, #lista .tarjeta');
  if (malos.length) falla(`desktop strips: ${malos.join('; ')}`); else ok('desktop 440 px panel: strips inside the cards and the panel');

  // ---------- e. Calendar ----------
  await ver(pag, 'calendario');
  await esperarQue(pag, () => !!document.querySelector('#calendario .tabla-calendario'), 'the calendar table');
  const x1 = r7.resultados[0];
  const cal1 = M.calendario(oJ, { lugar: { lat: x1.lat, lon: x1.lon } });
  const leerCal = () => pag.evaluate(() => ({
    filas: [...document.querySelectorAll('#calendario tbody tr')].map((tr) => ({ mes: Number(tr.dataset.mes), aqui: tr.querySelector('td.aqui').textContent, mejor: tr.querySelector('[data-v=mejor]').textContent, mover: tr.querySelector('td.mover').textContent, actual: tr.classList.contains('actual') })),
    frase: document.getElementById('plan-frase')?.textContent, ir: !!document.getElementById('plan-ir'), limites: [...document.querySelectorAll('#calendario .limites p')].map((p) => p.textContent), cab: [...document.querySelectorAll('#calendario thead th')].map((t) => t.textContent),
  }));
  const quieroFila = (f) => ({ mes: f.mes, aqui: fmtPct(f.en_lugar_pct), mejor: f.similitud_pct === null ? 'none comparable' : f.relevo === false ? `This place${fmtPct(f.similitud_pct)}` : `${pais(f) ?? ''}${formatoLatLon(f.lat, f.lon).texto}${fmtPct(f.similitud_pct)}`, mover: moverEnMes(f) === null ? '—' : moverEnMes(f) ? 'Yes' : 'No', actual: f.mes === 7 });
  let c = await leerCal();
  if (JSON.stringify(c.filas) !== JSON.stringify(cal1.map(quieroFila))) falla(`Calendar rows: ${JSON.stringify(c.filas)} ≠ ${JSON.stringify(cal1.map(quieroFila))}`);
  else ok(`Calendar place 1: 12 rows = M.calendario (${c.filas.map((f) => `${f.mes}:${f.aqui}/${f.mover}`).join(' ')}); header ${c.cab.join(' | ')}`);
  if (c.limites.length !== 3) falla(`Calendar limits: ${JSON.stringify(c.limites)}`); else ok(`Calendar limits: ${c.limites.join(' / ')}`);
  await pag.selectOption('#plan-inicio', '1');
  await pag.selectOption('#plan-despues', '6');
  await pag.waitForTimeout(150);
  c = await leerCal();
  const p16 = planRepetir(cal1, 1, 6);
  const frase16 = fraseRepetir(p16, p16.repeticion.mejor ? donde(p16.repeticion.mejor) : '');
  const estP = await pag.evaluate(() => window.__az.analogos.plan);
  if (c.frase !== frase16 || estP.mover !== p16.mover || c.ir !== (p16.mover && !!p16.repeticion.mejor)) falla(`plan January + 6: screen "${c.frase}" (${estP.mover}) ≠ node "${frase16}" (${p16.mover})`);
  else ok(`plan January + 6 months, place 1: «${c.frase}» = planRepetir (move ${p16.mover})`);
  console.log(`PLAN_FRASE ${c.frase}`);
  await pag.screenshot({ path: join(SALIDA, '03-calendar-plan.png') });
  await revisarContraste(pag, 'Calendar tab', '#calendario');
  malos = await fuera(pag, '#calendario, #calendario *');
  if (malos.length) falla(`desktop Calendar: ${malos.join('; ')}`); else ok('desktop Calendar: table and plan inside the 440 px panel, no horizontal scroll');
  // Un plan que proponga mover, para pulsar el lugar propuesto: se busca entre los lugares de la lista y los meses de inicio.
  let movido = null;
  for (let k = 0; k < r7.resultados.length && !movido; k++) {
    const x = r7.resultados[k], cal = k ? M.calendario(oJ, { lugar: { lat: x.lat, lon: x.lon } }) : cal1;
    for (let m = 1; m <= 12 && !movido; m++) if (planRepetir(cal, m, 6).mover) movido = { k, m, cal };
  }
  if (!movido) falla('no place and start month in the list gives "Move the test": cannot check the proposed place button');
  else {
    if (movido.k) {
      await ver(pag, 'lugares');
      await pag.click(`#lista > .tarjeta[data-k="${movido.k}"] .coords`);
      await pag.evaluate(() => { window.__az.analogos.autoTerreno = false; });
      await ver(pag, 'calendario');
      await esperarQue(pag, () => !!document.querySelector('#calendario .tabla-calendario'), 'the calendar table');
    }
    await pag.selectOption('#plan-inicio', String(movido.m));
    await pag.waitForTimeout(150);
    await quieta(pag);
    const p = planRepetir(movido.cal, movido.m, 6);
    c = await leerCal();
    const f = fraseRepetir(p, donde(p.repeticion.mejor));
    if (c.frase !== f || !c.ir || JSON.stringify(c.filas) !== JSON.stringify(movido.cal.map(quieroFila))) falla(`plan place ${movido.k + 1} from ${MESES_LARGO[movido.m - 1]}: "${c.frase}" ≠ "${f}"`);
    else ok(`plan place ${movido.k + 1}, ${MESES_LARGO[movido.m - 1]} + 6: «${c.frase}»`);
    console.log(`PLAN_FRASE_MOVER ${c.frase}`);
    await pag.click('#plan-ir');
    await pag.waitForTimeout(200);
    await quieta(pag);
    // La cámara mira al centro de la Tierra desde la dirección del lugar propuesto.
    const g = await pag.evaluate(([la, lo]) => { const c = window.__az.analogos.vista.camara.position; return { s: window.__az.analogos.vista.aPantalla(la, lo), c: { x: c.x, y: c.y, z: c.z }, ir: window.__az.analogos.planIr }; }, [p.repeticion.mejor.lat, p.repeticion.mejor.lon]);
    const vc = vectorALatLon(g.c), dg = Math.hypot(vc.lat - p.repeticion.mejor.lat, vc.lon - p.repeticion.mejor.lon);
    if (!g.s.visible || dg > 0.1 || g.ir?.lat !== p.repeticion.mejor.lat) falla(`proposed place on the globe: ${JSON.stringify(g)} camera over ${vc.lat.toFixed(2)}, ${vc.lon.toFixed(2)}`);
    else ok(`"Show the best place in ${MESES_LARGO[p.repeticion.mes - 1]} on the globe": the camera turns to ${donde(p.repeticion.mejor)} (camera over ${vc.lat.toFixed(2)}, ${vc.lon.toFixed(2)}; place on screen at ${g.s.x.toFixed(0)}, ${g.s.y.toFixed(0)})`);
    await pag.screenshot({ path: join(SALIDA, '04-calendar-mover.png') });
  }

  // Volver a «Whole year»: lista anual otra vez, las tiras se quedan (meses ya cargados).
  await ver(pag, 'lugares');
  const nPed = pag.pedidos.length;
  await elegirMes(pag, null);
  compararLugares('back to Whole year places', await leerLugares(pag), r0.resultados);
  const w = await pag.evaluate(() => ({ url: location.search, tiras: document.querySelectorAll('#lista .tira-caja').length, chip: document.getElementById('mes-activo').hidden, avanzado: document.getElementById('avanzado').hidden }));
  if (w.url.includes('mes=') || w.tiras !== r0.resultados.length || !w.chip || w.avanzado || pag.pedidos.length !== nPed) falla(`back to Whole year: ${JSON.stringify(w)}`);
  else ok(`back to "Whole year": URL ${w.url}, strips kept with no active month, chip gone, "Advanced" back, no new downloads`);
  compararTiras('Whole year strips after July', await leerTiras(pag, '#lista'), r0.resultados, null, escalaTiras(perfilesDe([...r0.resultados, ...r0.parciales, ...M.cartera(oJ).lugares])));
  await pag.context().close();

  // ---------- d. Año entero + botón ----------
  const pd = await pagina(1440, 900, 'whole year button');
  await abrir(pd, URL_J);
  await quieta(pd);
  await pd.click('#ver-meses');
  await esperarQue(pd, () => window.__az.analogos.tiras === true, 'the strips', 60000);
  compararLugares('after "Show how these places change…": same ranking', await leerLugares(pd), r0.resultados);
  const ped = [...pd.pedidos].sort();
  const d0 = await pd.evaluate(() => ({ boton: document.getElementById('ver-meses').hidden, mes: window.__az.analogos.mes, sel: window.__az.analogos.sel, url: location.search }));
  if (JSON.stringify(ped) !== JSON.stringify(ficheros({})) || !d0.boton || d0.mes !== null || d0.url.includes('mes=') || d0.sel?.k !== 0) falla(`whole-year button: ${JSON.stringify({ ped, d0 })}`);
  else ok(`whole-year button: downloaded ${ped.length} files, button gone, month still "Whole year", place 1 still selected`);
  const esc0 = escalaTiras(perfilesDe([...r0.resultados, ...r0.parciales, ...M.cartera(oJ).lugares]));
  compararTiras('whole-year strips', await leerTiras(pd, '#lista'), r0.resultados, null, esc0);
  await pd.$eval('#lista', (e) => e.scrollIntoView({ block: 'start' }));
  await pd.screenshot({ path: join(SALIDA, '05-ano-tiras.png') });
  await pd.context().close();

  // ---------- f. Misión + mes ----------
  const pf = await pagina(1440, 900, 'mission + month');
  await abrir(pf, `${URL_J}&mision=biomarcadores&mes=7`);
  await quieta(pf);
  const pedF = [...pf.pedidos].sort();
  const f0 = await pf.evaluate(() => ({ mes: document.getElementById('mes').value, mision: document.getElementById('mision').value, usados: window.__az.analogos.r.usados, mensuales: window.__az.analogos.r.mensuales, rmes: window.__az.analogos.r.mes }));
  if (JSON.stringify(pedF) !== JSON.stringify(ficheros(opcionesBusqueda(aB))) || f0.mes !== '7' || f0.mision !== 'biomarcadores' || JSON.stringify(f0.usados) !== JSON.stringify(rB7.usados) || JSON.stringify(f0.mensuales) !== JSON.stringify(rB7.mensuales) || f0.rmes !== 7) falla(`biomarcadores + July: ${JSON.stringify({ pedF, f0 })}`);
  else ok(`biomarcadores + July: files ${pedF.map((p) => p.split('/').pop()).join(', ')}; used ${f0.usados.join(', ')}; monthly ${f0.mensuales.join(', ')} = node`);
  compararLugares('biomarcadores + July places = M.buscar({ parametros, referencia, mes: 7 })', await leerLugares(pf), rB7.resultados);
  await ver(pf, 'metricas');
  compararMetricas('biomarcadores + July Metrics place 1', await leerMetricas(pf), rB7.resultados[0], rB7, 7);
  await ver(pf, 'lugares');
  compararTiras('biomarcadores + July strips', await leerTiras(pf, '#lista'), rB7.resultados.map((x) => ({ ...x, opc: opcionesBusqueda(aB) })), 7,
    escalaTiras(perfilesDe([...rB7.resultados, ...rB7.parciales, ...M.cartera(oJ, { ...opcionesBusqueda(aB), mes: 7 }).lugares], opcionesBusqueda(aB))));
  await pf.screenshot({ path: join(SALIDA, '06-biomarcadores-julio.png') });
  await pf.context().close();

  // ---------- g. Recarga y vuelta por la pantalla del mundo ----------
  const pg = await pagina(1440, 900, 'reload and world view');
  await abrir(pg, `${URL_J}&mes=7`);
  await quieta(pg);
  compararLugares('reload &mes=7', await leerLugares(pg), r7.resultados);
  const g0 = await pg.evaluate(() => ({ mes: document.getElementById('mes').value, volver: document.getElementById('volver').getAttribute('href') }));
  if (g0.mes !== '7' || g0.volver !== `../explorar/index.html?mundo=mars&lat=${J.lat}&lon=${J.lon}&mes=7`) falla(`reload &mes=7: ${JSON.stringify(g0)}`); else ok(`reload &mes=7: "When" = July, "Back to the globe" → ${g0.volver}`);
  await pg.click('#volver');
  await pg.waitForURL(/\/explorar\/index\.html\?/);
  await pg.waitForFunction(() => window.__az?.vista?.listo === true, null, { timeout: 120000 });
  const wv = await pg.evaluate(() => ({ mes: document.getElementById('mes').value, az: window.__az.explorar.mes, buscar: document.getElementById('buscar').getAttribute('href'), opciones: document.getElementById('mes').options.length, pedidos: 0 }));
  if (wv.mes !== '7' || wv.az !== 7 || !wv.buscar.endsWith('&mes=7') || wv.opciones !== 13) falla(`world view with &mes=7: ${JSON.stringify(wv)}`); else ok(`world view keeps July: "When" = July, "Find Earth analogs" → ${wv.buscar}`);
  await pg.screenshot({ path: join(SALIDA, '07-mundo-julio.png') });
  await pg.selectOption('#mes', '1');
  const wv1 = await pg.evaluate(() => ({ buscar: document.getElementById('buscar').getAttribute('href'), url: location.search }));
  if (!wv1.buscar.endsWith('&mes=1') || !wv1.url.endsWith('mes=1')) falla(`world view pick January: ${JSON.stringify(wv1)}`); else ok(`world view: picking January → link ${wv1.buscar}, URL ${wv1.url}`);
  await pg.click('#buscar');
  await pg.waitForURL(/\/analogos\/index\.html\?/);
  await pg.waitForFunction(() => window.__az?.analogos?.listo === true, null, { timeout: 120000 });
  await pg.evaluate(() => { window.__az.analogos.autoTerreno = false; });
  compararLugares('results from the world view with January = M.buscar({ mes: 1 })', await leerLugares(pg), M.buscar(oJ, { mes: 1 }).resultados);
  await pg.context().close();

  // ---------- h. Fallo de descarga ----------
  const ph = await pagina(1440, 900, 'download fails', {}, true);
  await ph.route('**/earth/mes/precip_mm_ano.i16', (q) => q.fulfill({ status: 404, body: '' }));
  await abrir(ph, URL_J);
  await quieta(ph);
  await ph.selectOption('#mes', '7');
  await esperarQue(ph, () => window.__az.analogos.mesEstado === 'fallo' && window.__az.analogos.mes === null, 'the failed download', 60000);
  await ph.waitForTimeout(200);
  const h0 = await ph.evaluate(() => ({ mes: document.getElementById('mes').value, disabled: document.getElementById('mes').disabled, aviso: document.getElementById('mes-estado').hidden ? null : document.getElementById('mes-estado').textContent, url: location.search, tiras: document.querySelectorAll('.tira-caja').length, boton: !document.getElementById('ver-meses').hidden, chip: document.getElementById('mes-activo').hidden }));
  if (h0.mes !== '' || h0.disabled || !h0.aviso || h0.url.includes('mes=') || h0.tiras || !h0.boton || !h0.chip) falla(`failed download: ${JSON.stringify(h0)}`);
  else ok(`404 on precip_mm_ano.i16: "${h0.aviso}"; "When" back to Whole year, URL ${h0.url}, button back, no strips`);
  compararLugares('after the failed download = whole year', await leerLugares(ph), r0.resultados);
  await ph.screenshot({ path: join(SALIDA, '08-fallo-descarga.png') });
  await revisarContraste(ph, 'failed-download notice', '#mes-estado');
  await abrir(ph, `${URL_J}&mes=7`);
  const h1 = await ph.evaluate(() => ({ mes: document.getElementById('mes').value, aviso: document.getElementById('mes-estado').textContent, url: location.search, a: window.__az.analogos.mes }));
  if (h1.mes !== '' || h1.a !== null || !h1.aviso || h1.url.includes('mes=')) falla(`failed download on load: ${JSON.stringify(h1)}`); else ok(`opening &mes=7 with the file missing: "${h1.aviso}", whole year shown`);
  compararLugares('failed download on load = whole year', await leerLugares(ph), r0.resultados);
  await ph.context().close();

  // ---------- i. Móvil ----------
  const mv = await pagina(390, 844, 'mobile', { isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await abrir(mv, `${URL_J}&mes=7`);
  await quieta(mv);
  await mv.$eval('#lista', (e) => e.scrollIntoView({ block: 'start' }));
  malos = await fuera(mv, '#panel, #panel .mision *, #lista .tarjeta, #lista .tarjeta *, .pestanas button');
  if (malos.length) falla(`mobile places with July: ${malos.join('; ')}`); else ok('mobile 390×844 with July: "When", 4 tabs (≥ 44 px), cards and strips inside the screen');
  await mv.screenshot({ path: join(SALIDA, '09-movil-tiras.png') });
  await mv.tap('#tab-calendario');
  await esperarQue(mv, () => !!document.querySelector('#calendario .tabla-calendario'), 'the calendar table');
  malos = await fuera(mv, '#calendario, #calendario *');
  if (malos.length) falla(`mobile Calendar: ${malos.join('; ')}`); else ok('mobile 390×844 Calendar: plan, table and limits inside the screen, no horizontal scroll');
  await mv.screenshot({ path: join(SALIDA, '10-movil-calendar.png') });
  await mv.$eval('#calendario .tabla-calendario', (e) => e.scrollIntoView({ block: 'start' }));
  await mv.screenshot({ path: join(SALIDA, '11-movil-calendar-tabla.png') });
  await mv.context().close();
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA_MESES: ${fallos.length} failure(s)` : 'CAPTURA_MESES: ok');
process.exit(fallos.length ? 1 : 0);

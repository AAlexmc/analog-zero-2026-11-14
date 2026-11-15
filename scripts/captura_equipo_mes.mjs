// Equipo de la misión en el lugar, mes a mes (pestaña Calendar), en Chromium: tiras = calendarioEquipo en node con M.perfilMensual,
// «NASA ran this here» = campañas del catálogo a menos de 300 km, valor anual del viento, equipos sin límites, sin misión, fallo del catálogo, móvil, contraste.
// Uso: node scripts/captura_equipo_mes.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { cargar } from '../web/buscar/motor.js';
import { formatoLatLon } from '../web/explorar/geo.js';
import { activaDeCatalogo, opcionesBusqueda } from '../web/analogos/misiones.js';
import { MESES_CORTO, planRepetir, fraseRepetir } from '../web/analogos/meses.js';
import { paisDe } from '../web/analogos/paises.js';
import { equiposDe, calendarioEquipo, idsMensualesEquipo, campanasCerca, fraseNasaAqui, fraseRepeticion } from '../web/analogos/equipo_mes.js';
import { contraste } from '../web/marca/contraste.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'equipo_mes');
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
const SITIOS = JSON.parse(readFileSync(join(WEB, 'data/sitios_ensayo.json'), 'utf8')).sitios;
const CATALOGO = JSON.parse(readFileSync(join(WEB, 'data/misiones.json'), 'utf8')).misiones;
const EQUIPO = JSON.parse(readFileSync(join(WEB, 'data/equipo_mision.json'), 'utf8'));
const PAISES = JSON.parse(readFileSync(join(WEB, 'data/paises_110m.json'), 'utf8')).paises;
const pais = (x) => paisDe(x.lat, x.lon, PAISES);
const donde = (x) => `${formatoLatLon(x.lat, x.lon).texto}${pais(x) ? ` (${pais(x)})` : ''}`;
const activa = (id) => activaDeCatalogo(CATALOGO.find((m) => m.id === id), M.indice, SITIOS);
// Lo mismo que la página: la Tierra del lugar como objetivo, referencia = el lugar.
function calendariosNode(idMision, x) {
  const eq = equiposDe(EQUIPO, idMision), ids = idsMensualesEquipo(eq, M.conMeses);
  const lugar = { lat: x.lat, lon: x.lon }, anuales = M.leerPunto('earth', x.lat, x.lon).valores;
  const per = ids.length ? M.perfilMensual({ cuerpo: 'earth', lat: x.lat, lon: x.lon, valores: anuales }, lugar, { parametros: ids, referencia: lugar }) : null;
  return { eq, per, anuales, cals: eq.map((e) => calendarioEquipo(e, per, anuales)) };
}
const celsius = (k) => (k === null || k === undefined ? 'n/a' : (k - 273.15).toFixed(1));

const SUR = { lat: -89.45, lon: -137.15 };
const oSur = M.leerPunto('moon', SUR.lat, SUR.lon);
const aLidar = activa('lidar_estereo');
const rSur = M.buscar(oSur, opcionesBusqueda(aLidar));
const kArtico = rSur.resultados.findIndex((x) => x.lat > 66.5);
// Lugar cerca de Haughton: Luna (−85, 90), lugar 2 con la misión del lidar (buscado antes en node; aquí se comprueba).
const CERCA = { lat: -85, lon: 90 };
const oCerca = M.leerPunto('moon', CERCA.lat, CERCA.lon);
const rCerca = M.buscar(oCerca, opcionesBusqueda(aLidar));
const kCerca = rCerca.resultados.findIndex((x) => campanasCerca(aLidar.mision, x.lat, x.lon));
const J = { lat: 18.38, lon: 77.58 };
const oJ = M.leerPunto('mars', J.lat, J.lon);

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

async function pagina(ancho, alto, etiqueta, opciones = {}, ignorar404 = false) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: alto }, ...opciones });
  const pag = await ctx.newPage();
  pag.pedidos = [];
  pag.on('request', (q) => { const u = new URL(q.url()); if (u.pathname.includes('/earth/mes/')) pag.pedidos.push(u.pathname.split('/').pop()); });
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
const abrir = async (pag, url, errorEsperado = null) => {
  await pag.goto(`${baseUrl}${url}`);
  await pag.waitForFunction(() => window.__az?.analogos?.listo === true, null, { timeout: 120000 });
  await pag.evaluate(() => { window.__az.analogos.autoTerreno = false; });
  const e = (await pag.evaluate(() => window.__az.analogos.errores)).filter((t) => !(errorEsperado && errorEsperado.test(t)));
  if (e.length) falla(`analogs page errors: ${e.join('; ')}`);
};
const quieta = (pag) => esperarQue(pag, () => new Promise((ok) => {
  const v = window.__az.analogos.vista, a = v.camara.position.clone();
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => ok(!v.animando() && v.camara.position.distanceTo(a) < 1e-12))));
}), 'the camera to stop');
// Lugar k de la lista y pestaña Calendar, hasta que la tabla (y el bloque, si se espera) están pintados.
async function calendarDe(pag, k, conBloque = true) {
  await pag.click(`#lista > .tarjeta[data-k="${k}"] .coords`);
  await pag.evaluate(() => { window.__az.analogos.autoTerreno = false; });
  await pag.click('#tab-calendario');
  await esperarQue(pag, (b) => !!document.querySelector('#calendario .tabla-calendario') && (!b || !!document.getElementById('equipo-mes')), 'the calendar', 60000, conBloque);
  await pag.waitForTimeout(200);
}
const leerBloque = (pag) => pag.evaluate(() => {
  const b = document.getElementById('equipo-mes');
  if (!b) return null;
  return {
    titulo: b.querySelector('h3').textContent,
    leyenda: b.querySelector('.leyenda-equipo')?.textContent ?? null,
    vacio: b.querySelector('.vacio')?.textContent ?? null,
    aviso: b.querySelector('.aviso-mes')?.textContent ?? null,
    sinLimites: b.querySelector('.sin-limites')?.textContent ?? null,
    equipos: [...b.querySelectorAll('li.equipo')].map((li) => ({
      id: li.dataset.id, nombre: li.querySelector('.equipo-nombre').textContent, tipo: li.querySelector('.equipo-tipo').textContent,
      casillas: [...li.querySelectorAll('.tira-equipo > li')].map((c) => ({ mes: Number(c.dataset.mes), estado: c.dataset.estado, signo: c.querySelector('.casilla').textContent, actual: c.getAttribute('aria-current'), etiqueta: c.getAttribute('aria-label') })),
      frase: li.querySelector('.equipo-frase')?.textContent ?? null,
      limites: [...li.querySelectorAll('.equipo-limites > li')].map((x) => x.textContent),
      nasa: li.querySelector('.equipo-nasa')?.textContent ?? null,
      nota: li.querySelector('.equipo-nota')?.textContent ?? null,
      noMedido: [...li.querySelectorAll(':scope > .no-medido')].map((p) => ({ texto: p.textContent, href: p.querySelector('a')?.getAttribute('href') ?? null })),
      fuentes: [...li.querySelectorAll('.equipo-fuentes > ul > li')].map((x) => ({ cita: x.querySelector('blockquote').textContent, href: x.querySelector('a').href, chips: [...x.querySelectorAll('.marca-chip')].map((c) => c.textContent), texto: x.textContent })),
    })),
  };
});
const SIGNO = { ok: '✓', rompe: '✕', sin_dato: '–' };
// Pantalla = node: estados, signos, mes activo, frases, línea de NASA y fuentes.
function compararEquipo(que, d, c, mes, nasa) {
  const errores = [];
  if (!d) { falla(`${que}: equipment ${c.id} not on screen`); return; }
  const quiero = c.resumen.veredictos;
  if (d.casillas.length !== 12) errores.push(`${d.casillas.length} boxes`);
  quiero.forEach((v, i) => {
    const q = d.casillas[i];
    if (!q || q.mes !== v.mes || q.estado !== v.estado || q.signo !== SIGNO[v.estado]) errores.push(`month ${v.mes}: screen ${JSON.stringify(q)} ≠ node ${v.estado}`);
    if (q && (q.actual === 'true') !== (v.mes === mes)) errores.push(`month ${v.mes} active ${q.actual}`);
  });
  if (d.frase?.replace(/\s*year value$/i, '') !== c.resumen.frase) errores.push(`phrase "${d.frase}" ≠ "${c.resumen.frase}"`);
  const med = c.limites.filter((l) => l.medible);
  const lims = med.length > 1 ? med.map((l) => l.frase) : [];
  if (JSON.stringify(d.limites.map((t) => t.replace(/\s*year value$/i, ''))) !== JSON.stringify(lims)) errores.push(`limit lines ${JSON.stringify(d.limites)} ≠ ${JSON.stringify(lims)}`);
  if (d.nasa !== nasa) errores.push(`NASA line "${d.nasa}" ≠ "${nasa}"`);
  if ((d.nota === 'Surface temperature, not air (own comparison).') !== c.superficie) errores.push(`surface note ${d.nota}`);
  c.limites.forEach((l, i) => {
    const f = d.fuentes[i];
    if (!f || f.cita !== l.limite.cita || f.href !== l.limite.fuente || f.chips.includes('source not verified') !== (l.limite.verificado === false) || (l.limite.nota && !f.texto.includes(l.limite.nota))) errores.push(`source ${i}: ${JSON.stringify(f)}`);
  });
  if (errores.length) falla(`${que}: ${errores.slice(0, 6).join('; ')}`);
  else ok(`${que}: ${d.nombre} — strip ${d.casillas.map((q) => `${MESES_CORTO[q.mes - 1]}${q.signo}`).join(' ')} = calendarioEquipo in node; «${d.frase}»${d.limites.length ? ` / ${d.limites.map((t) => `«${t}»`).join(' / ')}` : ''}${d.nasa ? ` / «${d.nasa}»` : ' / no NASA line'}; ${d.fuentes.length} sourced limits`);
}

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
      if (cs.visibility === 'hidden') continue;
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
      const rojoFondo = capas.some((c) => (c[0] === 228 && c[1] === 55 && c[2] === 0) || (c[0] === 142 && c[1] === 17 && c[2] === 0));
      const clave = `${texto.map(Math.round)}|${fondo.map(Math.round)}`;
      if (!vistos.has(clave)) vistos.set(clave, { texto, fondo, muestra: n.textContent.trim().slice(0, 40), rojo: rojoFondo || (color[0] === 228 && color[1] === 55 && color[2] === 0) || (color[0] === 142 && color[1] === 17 && color[2] === 0) });
    }
  }
  return [...vistos.values()];
}, selector);
async function revisarContraste(pag, que, selector) {
  const t = await leerContraste(pag, selector);
  const malas = t.filter((x) => x.rojo || contraste(x.texto, x.fondo) < 4.5);
  if (!t.length) falla(`${que}: no text found for ${selector}`);
  else if (malas.length) falla(`${que}: contrast < 4.5 or red text/background → ${malas.map((x) => `"${x.muestra}" ${contraste(x.texto, x.fondo).toFixed(2)}`).join('; ')}`);
  else ok(`${que}: ${t.length} text/background pairs, all ≥ 4.5:1, no red behind or as text (worst case: panel over white): ${t.map((x) => `«${x.muestra.slice(0, 18)}» ${contraste(x.texto, x.fondo).toFixed(1)}`).join(', ')}`);
}
const fuera = (pag, selector) => pag.evaluate((selector) => {
  const malos = [];
  const p = document.getElementById('panel').getBoundingClientRect();
  for (const e of document.querySelectorAll(selector)) {
    if (e.closest('[hidden]') || e.closest('details:not([open]) > :not(summary)') || !e.getClientRects().length) continue;
    const r = e.getBoundingClientRect();
    if (r.width && (r.left < Math.max(0, p.left) - 0.5 || r.right > Math.min(innerWidth, p.right) + 0.5)) malos.push(`${e.id || e.className || e.tagName} x ${r.left.toFixed(0)}–${r.right.toFixed(0)} (panel ${p.left.toFixed(0)}–${p.right.toFixed(0)})`);
  }
  for (const t of document.querySelectorAll('#calendario .tabla-scroll')) if (!t.closest('[hidden]') && t.scrollWidth > t.clientWidth + 1) malos.push(`calendar table scrolls (${t.scrollWidth} > ${t.clientWidth})`);
  if (document.documentElement.scrollWidth > innerWidth) malos.push(`page ${document.documentElement.scrollWidth} px wide`);
  return malos;
}, selector);
// Bajo las pestañas fijas: se deja ver el título del bloque.
const alBloque = (pag, sel = '#equipo-mes') => pag.$eval(sel, (e) => { e.scrollIntoView({ block: 'start' }); document.getElementById('panel').scrollBy(0, -70); });
const abrirFuentes = (pag) => pag.$$eval('#equipo-mes details.equipo-fuentes', (ds) => ds.forEach((d) => { d.open = true; }));

try {
  // ---------- a. Luna, polo sur, lidar: lugar del Ártico más parecido ----------
  if (kArtico < 0) throw new Error('no Arctic place in the lidar results for the lunar south pole');
  const xA = rSur.resultados[kArtico];
  const pa = await pagina(1440, 900, 'lidar Arctic');
  await abrir(pa, `/analogos/index.html?mundo=moon&lat=${SUR.lat}&lon=${SUR.lon}&nombre=South%20pole&mision=lidar_estereo&mes=7`);
  await quieta(pa);
  const ped0 = [...pa.pedidos];
  await calendarDe(pa, kArtico);
  const nA = calendariosNode('lidar_estereo', xA);
  const lidarA = nA.cals.find((c) => c.id === 'lidar_ilris3d');
  const bA = await leerBloque(pa);
  if (bA?.titulo !== 'Mission equipment at this place, month by month' || !bA.leyenda) falla(`block header: ${JSON.stringify(bA && { t: bA.titulo, l: bA.leyenda })}`);
  else ok(`block under "Repeat a test later": «${bA.titulo}»; legend «${bA.leyenda}»`);
  const orden = await pa.evaluate(() => { const p = document.getElementById('plan'), e = document.getElementById('equipo-mes'); return p && e && p.nextElementSibling === e; });
  if (!orden) falla('equipment block is not right after the repeat plan'); else ok('equipment block sits right after «Repeat a test later»');
  const nuevos = pa.pedidos.filter((p) => !ped0.includes(p)).sort();
  if (JSON.stringify(nuevos) !== JSON.stringify(['t_max_k.i16', 't_min_k.i16'])) falla(`monthly files for the lidar limits: ${JSON.stringify(nuevos)} (before Calendar: ${JSON.stringify(ped0)})`);
  else ok(`Calendar downloaded only the lidar limits' monthly files: ${nuevos.join(', ')} (none before)`);
  compararEquipo(`(a) Moon south pole, place ${kArtico + 1} ${donde(xA)}, lidar`, bA.equipos.find((e) => e.id === 'lidar_ilris3d'), lidarA, 7, fraseNasaAqui(campanasCerca(aLidar.mision, xA.lat, xA.lon)));
  const sinLim = nA.cals.filter((c) => !c.limites.length).map((c) => c.nombre);
  if (bA.sinLimites !== `No published limits — NOT MEASURED: ${sinLim.join(', ')}.` || bA.equipos.length !== nA.cals.length - sinLim.length) falla(`(a) no-limit line: ${bA.sinLimites}`);
  else ok(`(a) «${bA.sinLimites}»`);
  const tmin = nA.per.map((f) => celsius(f.parametros.find((p) => p.id === 't_min_k')?.valor_tierra));
  const tmax = nA.per.map((f) => celsius(f.parametros.find((p) => p.id === 't_max_k')?.valor_tierra));
  const aguanta = lidarA.resumen.veredictos.filter((v) => v.estado === 'ok').map((v) => MESES_CORTO[v.mes - 1]);
  const nasaMeses = (aLidar.mision.campanas ?? []).filter((c) => c.meses?.length).map((c) => `${c.nombre} (${c.sitio_texto ?? c.sitio}) ${c.meses.map((m) => MESES_CORTO[m - 1]).join(', ')}`);
  console.log(`LIDAR_LUGAR ${donde(xA)} · surface low °C by month: ${tmin.join(' ')} · surface high °C: ${tmax.join(' ')}`);
  console.log(`LIDAR_AGUANTA ${aguanta.join(', ') || 'none'} · NASA ran the lidar campaign: ${nasaMeses.join('; ')}`);
  // Plan: repetición en un mes que rompe → frase; en uno que aguanta → nada; el veredicto Stay/Move no cambia.
  const calA = M.calendario(oSur, { ...opcionesBusqueda(aLidar), lugar: { lat: xA.lat, lon: xA.lon } });
  for (const [ini, des] of [[7, 6], [1, 6]]) {
    await pa.selectOption('#plan-inicio', String(ini));
    await pa.selectOption('#plan-despues', String(des));
    await pa.waitForTimeout(200);
    const p = planRepetir(calA, ini, des);
    const quiero = { frase: fraseRepetir(p, p.repeticion.mejor ? donde(p.repeticion.mejor) : ''), eq: fraseRepeticion(nA.cals, p.repeticion.mes) };
    const hay = await pa.evaluate(() => ({ frase: document.getElementById('plan-frase').textContent, eq: document.getElementById('plan-equipo')?.textContent ?? null }));
    if (hay.frase !== quiero.frase || hay.eq !== quiero.eq) falla(`(a) plan ${ini}+${des}: ${JSON.stringify(hay)} ≠ ${JSON.stringify(quiero)}`);
    else ok(`(a) plan ${MESES_CORTO[ini - 1]} + ${des}: verdict «${hay.frase}» unchanged; equipment line ${hay.eq ? `«${hay.eq}»` : 'none (lidar works that month)'}`);
  }
  await pa.selectOption('#plan-inicio', '7');
  await pa.waitForTimeout(200);
  await alBloque(pa, '#plan');
  await pa.screenshot({ path: join(SALIDA, '00-plan-equipo.png') });
  await alBloque(pa);
  await pa.screenshot({ path: join(SALIDA, '01-lidar-artico.png') });
  await revisarContraste(pa, '(h) equipment block, lidar', '#equipo-mes, #plan-equipo');
  await abrirFuentes(pa);
  await pa.waitForTimeout(100);
  await alBloque(pa, '#equipo-mes .equipo-fuentes');
  await pa.screenshot({ path: join(SALIDA, '02-lidar-fuentes.png') });
  await revisarContraste(pa, '(h) "Limits and sources" open', '#equipo-mes');
  let malos = await fuera(pa, '#equipo-mes, #equipo-mes *');
  if (malos.length) falla(`desktop block: ${malos.join('; ')}`); else ok('desktop 440 px panel: block, strip and sources inside the panel');
  await pa.context().close();

  // ---------- b. Lugar cerca de Haughton: «NASA ran this here in …» ----------
  if (kCerca < 0) throw new Error('no place near a lidar campaign site in the results for Moon (−85, 90)');
  const xB = rCerca.resultados[kCerca];
  const pb = await pagina(1440, 900, 'near Haughton');
  await abrir(pb, `/analogos/index.html?mundo=moon&lat=${CERCA.lat}&lon=${CERCA.lon}&mision=lidar_estereo`);
  await quieta(pb);
  await calendarDe(pb, kCerca);
  const nB = calendariosNode('lidar_estereo', xB);
  const cB = campanasCerca(aLidar.mision, xB.lat, xB.lon);
  const bB = await leerBloque(pb);
  compararEquipo(`(b) Moon (−85, 90), place ${kCerca + 1} ${donde(xB)}, ${Math.round(cB.campanas[0].km)} km from ${cB.campanas[0].nombre}`, bB.equipos.find((e) => e.id === 'lidar_ilris3d'), nB.cals.find((c) => c.id === 'lidar_ilris3d'), null, fraseNasaAqui(cB));
  const camp = aLidar.mision.campanas.find((c) => c.nombre === cB.campanas[0].nombre);
  if (JSON.stringify(cB.meses) !== JSON.stringify(camp.meses)) falla(`(b) months ${cB.meses} ≠ catalogue ${camp.meses}`);
  else ok(`(b) months on screen = misiones.json (${camp.meses.map((m) => MESES_CORTO[m - 1]).join(', ')}; «${camp.meses_fuente?.cita}»)`);
  const okB = nB.cals.find((c) => c.id === 'lidar_ilris3d').resumen.veredictos.filter((v) => v.estado === 'ok').map((v) => MESES_CORTO[v.mes - 1]);
  console.log(`CERCA_HAUGHTON ${donde(xB)} · lidar works: ${okB.join(', ') || 'none'} · ${fraseNasaAqui(cB)}`);
  await alBloque(pb);
  await pb.screenshot({ path: join(SALIDA, '03-cerca-haughton.png') });
  await revisarContraste(pb, '(h) block with the NASA line', '#equipo-mes');
  await pb.context().close();

  // ---------- c. Simulación larga: domo, viento anual («year value») ----------
  const aSim = activa('simulacion_larga');
  const rSim = M.buscar(oJ, opcionesBusqueda(aSim));
  const pc = await pagina(1440, 900, 'long simulation');
  await abrir(pc, `/analogos/index.html?mundo=mars&lat=${J.lat}&lon=${J.lon}&nombre=Jezero&mision=simulacion_larga`);
  await quieta(pc);
  await calendarDe(pc, 0);
  const nC = calendariosNode('simulacion_larga', rSim.resultados[0]);
  const domo = nC.cals.find((c) => c.id === 'domo_hi_seas');
  const bC = await leerBloque(pc);
  const dC = bC.equipos.find((e) => e.id === 'domo_hi_seas');
  compararEquipo(`(c) Jezero, place 1 ${donde(rSim.resultados[0])}, dome`, dC, domo, null, fraseNasaAqui(campanasCerca(aSim.mision, rSim.resultados[0].lat, rSim.resultados[0].lon)));
  const iguales = new Set(dC.casillas.map((q) => q.estado)).size === 1;
  if (domo.limites[0].origen !== 'anual' || !/year value$/i.test(dC.frase) || !iguales || !dC.fuentes[0].chips.includes('year value')) falla(`(c) year value: ${JSON.stringify({ origen: domo.limites[0].origen, frase: dC.frase, chips: dC.fuentes[0].chips })}`);
  else ok(`(c) 95th-percentile wind has no monthly layer: «${dC.frase}», chip "year value", 12 boxes the same (P95 here ${M.leerPunto('earth', rSim.resultados[0].lat, rSim.resultados[0].lon).valores.viento_p95_m_s?.toFixed(1)} m/s)`);
  await alBloque(pc);
  await abrirFuentes(pc);
  await pc.screenshot({ path: join(SALIDA, '04-domo-viento-anual.png') });
  await revisarContraste(pc, '(h) dome block with sources open', '#equipo-mes');
  // Otra misión sin recargar: el bloque cambia con la misión.
  await pc.selectOption('#mision', 'ruedas_en_arena');
  await esperarQue(pc, () => window.__az.analogos.mision?.id === 'ruedas_en_arena', 'the mission change', 60000);
  await pc.evaluate(() => { window.__az.analogos.autoTerreno = false; });
  await esperarQue(pc, () => !!document.querySelector('#equipo-mes li.equipo[data-id="scarecrow"]'), 'the Scarecrow block', 60000);
  const bS = await leerBloque(pc);
  const s = bS.equipos.find((e) => e.id === 'scarecrow');
  if (s.casillas.length || s.noMedido.length !== 1 || !s.noMedido[0].texto.startsWith('Slope: max. 15°. NOT MEASURED here (no slope layer at this scale; see the simulation)') || !s.noMedido[0].href?.includes('terreno/') || !s.fuentes[0]?.chips.includes('source not verified')) falla(`(d) Scarecrow: ${JSON.stringify(s)}`);
  else ok(`(d) Scarecrow (mission switched on the page): no strip; «${s.noMedido[0].texto}» → ${s.noMedido[0].href}; sources: chip "source not verified"`);
  await alBloque(pc);
  await abrirFuentes(pc);
  await pc.screenshot({ path: join(SALIDA, '05-scarecrow-pendiente.png') });
  await revisarContraste(pc, '(h) Scarecrow block', '#equipo-mes');
  await pc.context().close();

  // ---------- d. Misiones sin límites o sin equipo ----------
  const pd = await pagina(1440, 900, 'no limits');
  await abrir(pd, `/analogos/index.html?mundo=moon&lat=${SUR.lat}&lon=${SUR.lon}&mision=georradar_hielo`);
  await quieta(pd);
  await calendarDe(pd, 0);
  const bD = await leerBloque(pd);
  const nombresD = equiposDe(EQUIPO, 'georradar_hielo').map((e) => e.nombre);
  if (bD.sinLimites !== `No published limits — NOT MEASURED: ${nombresD.join(', ')}.` || bD.equipos.length || bD.leyenda || (await pd.$('#equipo-mes .tira-equipo'))) falla(`(d) no limits: ${JSON.stringify(bD)}`);
  else ok(`(d) georradar_hielo: one grouped line «${bD.sinLimites}», no strip, no legend`);
  await alBloque(pd);
  await pd.screenshot({ path: join(SALIDA, '06-sin-limites.png') });
  const vacia = CATALOGO.find((m) => equiposDe(EQUIPO, m.id).length === 0 && m.respaldo !== 'no_encontrado' && activa(m.id).parametros.length);
  if (vacia) {
    await pd.selectOption('#mision', vacia.id);
    await esperarQue(pd, (id) => window.__az.analogos.mision?.id === id, 'the mission change', 60000, vacia.id);
    await pd.evaluate(() => { window.__az.analogos.autoTerreno = false; });
    await esperarQue(pd, () => !!document.querySelector('#equipo-mes .vacio'), 'the empty block', 60000);
    const bV = await leerBloque(pd);
    if (bV.vacio !== 'No equipment listed for this mission.' || bV.equipos.length || bV.sinLimites) falla(`(d) ${vacia.id}: ${JSON.stringify(bV)}`);
    else ok(`(d) ${vacia.id} (no equipment in the catalogue): «${bV.vacio}»`);
  } else falla('(d) no mission with an empty equipment list to check');
  await pd.context().close();

  // ---------- e. Sin misión: no hay bloque ----------
  const pe = await pagina(1440, 900, 'no mission');
  await abrir(pe, `/analogos/index.html?mundo=moon&lat=${SUR.lat}&lon=${SUR.lon}`);
  await quieta(pe);
  await calendarDe(pe, 0, false);
  const e0 = await pe.evaluate(() => ({ bloque: !!document.getElementById('equipo-mes'), plan: !!document.getElementById('plan-frase'), extra: !!document.getElementById('plan-equipo'), est: window.__az.analogos.equipoMes }));
  if (e0.bloque || !e0.plan || e0.extra || e0.est) falla(`(e) no mission: ${JSON.stringify(e0)}`); else ok('(e) no mission: Calendar has its plan and table, no equipment block, no equipment line under the plan');
  await pe.context().close();

  // ---------- f. Catálogo de equipo con 404 ----------
  const pf = await pagina(1440, 900, 'catalogue 404', {}, true);
  await pf.route('**/data/equipo_mision.json', (q) => q.fulfill({ status: 404, body: '' }));
  await abrir(pf, `/analogos/index.html?mundo=moon&lat=${SUR.lat}&lon=${SUR.lon}&mision=lidar_estereo`, /equipo_mision\.json/);
  await quieta(pf);
  await calendarDe(pf, kArtico, false);
  const f0 = await pf.evaluate(() => ({ bloque: !!document.getElementById('equipo-mes'), filas: document.querySelectorAll('#calendario tbody tr').length, frase: document.getElementById('plan-frase')?.textContent, errores: window.__az.analogos.errores, lista: document.querySelectorAll('#lista > .tarjeta').length, ficha: !document.getElementById('mision-ficha').hidden }));
  const pF = planRepetir(M.calendario(oSur, { ...opcionesBusqueda(aLidar), lugar: { lat: xA.lat, lon: xA.lon } }), 1, 6);
  if (f0.bloque || f0.filas !== 12 || f0.frase !== fraseRepetir(pF, pF.repeticion.mejor ? donde(pF.repeticion.mejor) : '') || f0.lista !== rSur.resultados.length || !f0.ficha || f0.errores.length !== 1) falla(`(f) catalogue 404: ${JSON.stringify(f0)}`);
  else ok(`(f) equipo_mision.json 404: no equipment block; Calendar 12 rows, plan «${f0.frase}»; list of ${f0.lista}, mission card shown; only error logged: ${f0.errores[0]}`);
  await pf.screenshot({ path: join(SALIDA, '07-fallo-catalogo.png') });
  await pf.context().close();

  // ---------- g. Móvil 390×844 ----------
  const mv = await pagina(390, 844, 'mobile', { isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await abrir(mv, `/analogos/index.html?mundo=moon&lat=${SUR.lat}&lon=${SUR.lon}&mision=lidar_estereo&mes=7`);
  await quieta(mv);
  await mv.$eval(`#lista > .tarjeta[data-k="${kArtico}"]`, (e) => e.scrollIntoView({ block: 'center' }));
  await mv.tap(`#lista > .tarjeta[data-k="${kArtico}"] .coords`);
  await mv.evaluate(() => { window.__az.analogos.autoTerreno = false; });
  await mv.tap('#tab-calendario');
  await esperarQue(mv, () => !!document.querySelector('#equipo-mes .tira-equipo'), 'the equipment strip', 60000);
  await alBloque(mv);
  malos = await fuera(mv, '#calendario, #calendario *');
  if (malos.length) falla(`(g) mobile: ${malos.join('; ')}`); else ok('(g) mobile 390×844: strip, phrases and the plan inside the screen, no horizontal scroll');
  const tam = await mv.$$eval('#equipo-mes .tira-equipo .casilla', (cs) => cs.map((c) => c.getBoundingClientRect().width));
  if (Math.min(...tam) < 14) falla(`(g) mobile boxes too narrow: ${tam.map((w) => w.toFixed(0)).join(' ')}`); else ok(`(g) mobile boxes ${Math.min(...tam).toFixed(0)} px wide or more`);
  await mv.screenshot({ path: join(SALIDA, '08-movil.png') });
  await abrirFuentes(mv);
  malos = await fuera(mv, '#equipo-mes, #equipo-mes *');
  if (malos.length) falla(`(g) mobile sources open: ${malos.join('; ')}`); else ok('(g) mobile with "Limits and sources" open: inside the screen');
  await revisarContraste(mv, '(h) mobile block', '#equipo-mes');
  await mv.context().close();
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA_EQUIPO_MES: ${fallos.length} failure(s)` : 'CAPTURA_EQUIPO_MES: ok');
process.exit(fallos.length ? 1 : 0);

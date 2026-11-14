// Portfolio, tipo de entorno, «unlisted», tabla Compare y país en Chromium con GPU, para Jezero y el borde de Shackleton:
// lo que sale en pantalla = motor.js + metricas.js + paises.js en node; letras A/B en el globo; móvil 390 px; consola limpia.
// Uso: node scripts/captura_cartera.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { cargar } from '../web/buscar/motor.js';
import { formatoLatLon } from '../web/explorar/geo.js';
import {
  fmtPct, formatoValor as formatoValorSup, planoSup, masCercano, lineaContexto, fraseParcial, sitiosConCoordenadas, fraseUnlisted,
  letra, nombreCorto, titularCartera, fraseSinCubrir, reglaCartera, lineaEntorno, comoSabemos, tablaComparar, lineaDistancia, textoComponentes, enlaceWorldview,
} from '../web/analogos/metricas.js';
import { paisDe } from '../web/analogos/paises.js';

const formatoValor = (v, u) => planoSup(formatoValorSup(v, u));
const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'cartera');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const EXTERNOS = ['https://elevation-tiles-prod.s3.amazonaws.com', 'https://gibs.earthdata.nasa.gov'];

const fallos = [];
const falla = (m) => { fallos.push(m); console.error(`FAIL ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);

// ---------- Referencia en node ----------
const M = await cargar(join(WEB, 'data/cuerpos') + '/', async (ruta, tipo) => {
  const b = await readFile(ruta);
  return tipo === 'json' ? JSON.parse(b.toString('utf8')) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});
const P = Object.fromEntries(M.indice.parametros.map((p) => [p.id, p]));
const REPRO = M.indice.parametros.filter((p) => p.reproducible_en_tierra).map((p) => p.id);
const NOMBRES = { moon: 'Moon', mars: 'Mars' };
const SITIOS = JSON.parse(readFileSync(join(WEB, 'data/sitios_ensayo.json'), 'utf8')).sitios;
const N_SITIOS = sitiosConCoordenadas(SITIOS);
const PAISES = JSON.parse(readFileSync(join(WEB, 'data/paises_110m.json'), 'utf8')).paises;
const MUNDOS = JSON.parse(readFileSync(join(WEB, 'data/cuerpos/mundos.json'), 'utf8')).mundos;
const sug = (m, id) => MUNDOS.find((x) => x.id === m).sugerencias.find((s) => s.id === id);
const donde = (s) => `${formatoLatLon(s.lat, s.lon).texto}${paisDe(s.lat, s.lon, PAISES) ? ` (${paisDe(s.lat, s.lon, PAISES)})` : ''}`;

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

// La vista de terreno se prueba sin red: los fallos de red de esas dos webs se toleran y se espera el aviso.
async function pagina(ancho, alto, etiqueta, opciones = {}) {
  const ctx = await nav.newContext({ viewport: { width: ancho, height: alto }, ...opciones });
  const pag = await ctx.newPage();
  pag.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (/Failed to load resource|net::ERR_INTERNET_DISCONNECTED/.test(m.text())) return;
    falla(`console ${m.type()} (${etiqueta}): ${m.text()}`);
  });
  pag.on('pageerror', (e) => falla(`page error (${etiqueta}): ${e.message}`));
  for (const o of EXTERNOS) await pag.route(`${o}/**`, (r) => r.abort('internetdisconnected'));
  return pag;
}
async function esperarQue(pag, f, que, ms = 20000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await pag.evaluate(f, arg)) return; await pag.waitForTimeout(80); }
  throw new Error(`timeout waiting for ${que}`);
}
const quieta = (pag) => esperarQue(pag, () => new Promise((ok) => {
  const v = window.__az.analogos.vista, a = v.camara.position.clone();
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => ok(!v.animando() && v.camara.position.distanceTo(a) < 1e-12))));
}), 'the camera to stop');
async function abrir(pag, mundo, s) {
  await pag.goto(`${baseUrl}/analogos/index.html?mundo=${mundo}&lat=${s.lat}&lon=${s.lon}&nombre=${encodeURIComponent(s.nombre)}`);
  await pag.waitForFunction(() => window.__az?.analogos?.listo === true, null, { timeout: 120000 });
  // El terreno que se abre solo al pulsar un lugar se comprueba en captura_relieve.
  await pag.evaluate(() => { window.__az.analogos.autoTerreno = false; });
  const e = await pag.evaluate(() => window.__az.analogos.errores);
  if (e.length) falla(`analogs page errors: ${e.join('; ')}`);
  await quieta(pag);
}
const pestana = async (pag, id) => { await pag.click(`#tab-${id}`); await pag.waitForTimeout(150); await quieta(pag); };
const igual = (que, pantalla, nodo) => { if (JSON.stringify(pantalla) !== JSON.stringify(nodo)) { falla(`${que}: screen ${JSON.stringify(pantalla)} ≠ node ${JSON.stringify(nodo)}`); return false; } return true; };

// Marcadores visibles del globo: texto, posición, aria-current.
const marcadores = (pag) => pag.evaluate(() => [...document.querySelectorAll('#numeros button')].filter((b) => !b.hidden).map((b) => {
  const r = b.getBoundingClientRect();
  return { t: b.textContent, letra: b.classList.contains('letra'), x: r.left + r.width / 2, y: r.top + r.height / 2, sel: b.getAttribute('aria-current') === 'true' };
}));

async function comprobarEntorno(pag, que, o) {
  const k = M.claseDe(o);
  const dom = await pag.evaluate(() => ({
    oculto: document.getElementById('entorno').hidden,
    linea: document.getElementById('entorno-linea').textContent,
    texto: [...document.querySelectorAll('#entorno-texto p')].map((p) => p.textContent),
    leyenda: [...document.querySelectorAll('#leyenda-clases li')].map((li) => ({ id: li.dataset.id ?? null, txt: li.textContent, cerca: li.classList.contains('cercano') })),
    abierto: document.getElementById('entorno-como').open,
  }));
  if (dom.oculto) { falla(`${que}: environment line hidden`); return; }
  igual(`${que} environment line`, dom.linea, lineaEntorno(k, M.clases.clases.length));
  igual(`${que} "How we know"`, dom.texto, comoSabemos(M.clases, k));
  const ley = M.clases.clases.map((c) => ({ id: String(c.id), txt: `${c.rotulo} ${c.pct_area.toFixed(1)} % of grouped land${c.id === k.id ? ' · closest to your point' : ''}`, cerca: c.id === k.id }));
  igual(`${que} type legend`, dom.leyenda.slice(0, -1), ley);
  if (dom.leyenda.at(-1)?.txt !== 'not grouped (ice cap or missing data)') falla(`${que}: last legend row ${JSON.stringify(dom.leyenda.at(-1))}`);
  if (dom.abierto) falla(`${que}: "How we know" should start folded`);
  ok(`${que} environment: "${dom.linea}" (dentro ${k.dentro}, d ${k.distancia.toFixed(2)} vs r ${k.radio.toFixed(2)}); How we know ${dom.texto.length} lines = clases.json`);
}

async function comprobarLugares(pag, que, r) {
  const dom = await pag.evaluate(() => ({
    resumen: document.getElementById('unlisted').hidden ? null : document.getElementById('unlisted').textContent,
    tarjetas: [...document.querySelectorAll('#lista > .tarjeta')].map((t) => ({ pais: t.querySelector('.pais')?.textContent ?? null, coords: t.querySelector('.coords').textContent, contexto: t.querySelector('.contexto').textContent, unlisted: !!t.querySelector('.marca-chip.unlisted') })),
  }));
  const sin = r.resultados.filter((x) => !masCercano(x.lat, x.lon, SITIOS)).length;
  igual(`${que} unlisted sentence`, dom.resumen, fraseUnlisted(sin, r.resultados.length, N_SITIOS));
  igual(`${que} place cards`, dom.tarjetas, r.resultados.map((x) => { const c = masCercano(x.lat, x.lon, SITIOS); return { pais: paisDe(x.lat, x.lon, PAISES), coords: formatoLatLon(x.lat, x.lon).texto, contexto: lineaContexto(c, N_SITIOS), unlisted: !c }; }));
  if (dom.tarjetas.some((t) => /\bnew\b|unknown to science|undiscovered/i.test(t.contexto + (dom.resumen ?? '')))) falla(`${que}: "new"/"unknown" wording`);
  ok(`${que} places: "${dom.resumen}"; ${dom.tarjetas.map((t, k) => `${k + 1} ${t.pais ?? '(no country)'}${t.unlisted ? ' [unlisted]' : ''}`).join(', ')} = node`);
}

async function comprobarCartera(pag, que, o) {
  const c = M.cartera(o);
  await pestana(pag, 'cartera');
  const dom = await pag.evaluate(() => ({
    titular: document.getElementById('cartera-titular').textContent,
    como: [...document.querySelectorAll('#cartera-como p')].map((p) => p.textContent),
    tarjetas: [...document.querySelectorAll('#lista-cartera > .tarjeta')].map((t) => ({
      letra: t.querySelector('.num').textContent, pct: t.querySelector('.pct span').textContent, pais: t.querySelector('.pais')?.textContent ?? null, coords: t.querySelector('.coords').textContent,
      parcial: t.querySelector('.parcial')?.textContent ?? null, contexto: t.querySelector('.contexto').textContent, unlisted: !!t.querySelector('.marca-chip.unlisted'),
      chips: [...t.querySelectorAll('.chips li')].map((li) => ({ id: li.dataset.id, t: li.textContent, title: li.title })),
      worldview: ((a) => a && `${a.textContent} ${a.getAttribute('href')} ${a.target} ${a.rel}`)(t.querySelector('a.worldview')),
    })),
    sinCubrir: [...document.querySelectorAll('#sin-cubrir li')].map((li) => ({ id: li.dataset.id, txt: li.textContent })),
    sinCubrirVacio: document.querySelector('#sin-cubrir > p')?.textContent ?? null,
    sel: window.__az.analogos.sel,
  }));
  igual(`${que} portfolio headline`, dom.titular, titularCartera(c));
  igual(`${que} "How this works"`, dom.como, reglaCartera(c));
  igual(`${que} portfolio cards`, dom.tarjetas, c.lugares.map((x, k) => {
    const s = masCercano(x.lat, x.lon, SITIOS);
    return {
      letra: letra(k), pct: fmtPct(x.similitud_pct), pais: paisDe(x.lat, x.lon, PAISES), coords: formatoLatLon(x.lat, x.lon).texto,
      parcial: x.comparados < x.de ? fraseParcial(x) : null, contexto: lineaContexto(s, N_SITIOS), unlisted: !s,
      chips: x.cubre.map((id) => ({ id, t: nombreCorto(id, P), title: `${P[id].nombre}: ${fmtPct(x.parametros.find((p) => p.id === id).desviacion_pct)} off` })),
      worldview: `Open in NASA Worldview ${enlaceWorldview(x.lat, x.lon)} _blank noopener`,
    };
  }));
  igual(`${que} "What no place on Earth covers"`, dom.sinCubrir, c.sin_cubrir.map((s) => ({ id: s.id, txt: `${P[s.id].nombre}. ${fraseSinCubrir(s, donde(s))} Test this in a lab or a chamber.` })));
  if (!c.sin_cubrir.length && dom.sinCubrirVacio !== 'Every parameter is covered by at least one place above.') falla(`${que}: empty uncovered block ${dom.sinCubrirVacio}`);
  if (dom.sel?.lista !== 'cartera' || dom.sel.k !== 0) falla(`${que}: opening Portfolio should select place A, sel ${JSON.stringify(dom.sel)}`);
  ok(`${que} portfolio: "${dom.titular}" | ${dom.tarjetas.map((t) => `${t.letra} ${t.pct} ${t.pais ?? '(no country)'} ${t.coords} covers ${t.chips.map((x) => x.t).join('/')}`).join(' | ')} | uncovered: ${dom.sinCubrir.map((s) => s.txt).join(' / ')} = node`);

  // Letras en el globo: A elegida y donde dice node; ningún número a la vista.
  let mk = await marcadores(pag);
  const sA = await pag.evaluate(([la, lo]) => window.__az.analogos.vista.aPantalla(la, lo), [c.lugares[0].lat, c.lugares[0].lon]);
  const a = mk.find((m) => m.t === 'A');
  if (mk.some((m) => !m.letra)) falla(`${que}: numbers on the globe in Portfolio ${JSON.stringify(mk)}`);
  if (!a || !a.sel || Math.hypot(a.x - sA.x, a.y - sA.y) > 1.5) falla(`${que}: marker A ${JSON.stringify(a)} vs node position ${JSON.stringify(sA)}`);
  else ok(`${que}: globe shows letter A (selected) at ${a.x.toFixed(0)},${a.y.toFixed(0)}; no number markers`);
  return c;
}

async function elegirB(pag, que, c, etiqueta) {
  if (c.lugares.length < 2) return;
  await pag.click('#lista-cartera > .tarjeta[data-k="1"]');
  await pag.waitForTimeout(100);
  await quieta(pag);
  const mk = await marcadores(pag);
  const sB = await pag.evaluate(([la, lo]) => window.__az.analogos.vista.aPantalla(la, lo), [c.lugares[1].lat, c.lugares[1].lon]);
  const b = mk.find((m) => m.t === 'B');
  const sel = await pag.evaluate(() => ({ sel: window.__az.analogos.sel, card: document.querySelector('#lista-cartera > .tarjeta[aria-current="true"]')?.dataset.k }));
  if (!b || !b.sel || !sB.visible || Math.hypot(b.x - sB.x, b.y - sB.y) > 1.5 || sel.sel.lista !== 'cartera' || sel.sel.k !== 1 || sel.card !== '1') falla(`${que}: card B should turn the globe to B: ${JSON.stringify({ b, sB, sel })}`);
  else ok(`${que}: card B → globe turns to B (${b.x.toFixed(0)},${b.y.toFixed(0)}), letter B selected`);
  await pag.screenshot({ path: join(SALIDA, `${etiqueta}-cartera-b.png`) });

  // «See the terrain» abre el lugar B (sin red: el diálogo nace con su título y luego avisa y deja el globo).
  await pag.evaluate(() => { window.__tituloRelieve = null; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('relieve-capa')) window.__tituloRelieve = n.getAttribute('aria-label'); }).observe(document.body, { childList: true }); });
  await pag.click('#ver-relieve');
  await esperarQue(pag, () => ['abierto', 'error'].includes(window.__az.relieve.estado), 'the terrain view to open or fail', 60000);
  const rv = await pag.evaluate(() => ({ titulo: window.__tituloRelieve, estado: window.__az.relieve.estado, aviso: document.getElementById('relieve-aviso').hidden ? null : document.getElementById('relieve-aviso').textContent }));
  const quiero = `Terrain around Portfolio place B · ${formatoLatLon(c.lugares[1].lat, c.lugares[1].lon).texto}`;
  if (rv.titulo !== quiero) falla(`${que}: "See the terrain" opened ${JSON.stringify(rv)} ≠ "${quiero}"`);
  else ok(`${que}: "See the terrain" asks for "${rv.titulo.replace('Terrain around ', '')}"; without network → ${rv.estado}: "${rv.aviso}"`);
}

async function comprobarTabla(pag, que, r, etiqueta) {
  await pestana(pag, 'metricas');
  if (!(await pag.$eval('#metricas .comparar', (d) => d.open))) await pag.click('#metricas .comparar summary');
  await pag.waitForTimeout(150);
  const dom = await pag.evaluate(() => {
    const t = document.querySelector('#metricas .tabla-comparar');
    return {
      cabecera: [...t.querySelectorAll('thead th')].map((th) => th.textContent),
      filas: [...t.querySelectorAll('tbody tr')].map((tr) => ({
        id: tr.dataset.id, nombre: tr.querySelector('th').textContent, objetivo: tr.querySelector('td.objetivo').textContent,
        celdas: [...tr.querySelectorAll('td:not(.objetivo)')].map((td) => ({ valor: td.querySelector('.valor').textContent, desv: td.querySelector('.desv').textContent, mejor: td.classList.contains('mejor') })),
      })),
    };
  });
  const t = tablaComparar(r.resultados, REPRO);
  igual(`${que} Compare header`, dom.cabecera, ['Parameter', `Your point (${NOMBRES[r.objetivo.cuerpo]})`, ...r.resultados.map((x, k) => `Place ${k + 1}${paisDe(x.lat, x.lon, PAISES) ?? ''}${formatoLatLon(x.lat, x.lon).texto}`)]);
  igual(`${que} Compare rows`, dom.filas, t.map((f) => ({
    id: f.id, nombre: nombreCorto(f.id, P), objetivo: formatoValor(f.objetivo, P[f.id].unidad),
    celdas: f.celdas.map((c) => ({ valor: formatoValor(c.valor, P[f.id].unidad), desv: c.desv === null ? 'no data' : `${fmtPct(c.desv)} off`, mejor: c.mejor })),
  })));
  ok(`${que} Compare: ${dom.filas.length} rows × ${dom.filas[0]?.celdas.length} places; best per row ${dom.filas.map((f) => `${f.nombre}→${f.celdas.map((c, k) => (c.mejor ? k + 1 : null)).filter(Boolean).join('+')}`).join(', ')} = node`);
  await pag.$eval('#metricas .comparar', (e) => e.scrollIntoView({ block: 'start' }));
  await pag.waitForTimeout(150);
  await pag.screenshot({ path: join(SALIDA, `${etiqueta}-compare.png`) });
}

async function comprobarComponentes(pag, que, o, r, etiqueta) {
  await pestana(pag, 'lugares');
  await pag.click('#avanzado summary');
  await pag.click('label.interruptor:has(#por-componentes)');
  await pag.waitForTimeout(150);
  await quieta(pag);
  const rc = M.buscar(o, { metrica: 'componentes' }), dRef = M.clases.d_ref.valor;
  const leer = () => pag.evaluate(() => [...document.querySelectorAll('#lista > .tarjeta')].map((t) => ({ pct: t.querySelector('.pct span').textContent, coords: t.querySelector('.coords').textContent, distancia: t.querySelector('.distancia')?.textContent ?? null })));
  const dom = await leer();
  igual(`${que} related parameters once`, dom, rc.resultados.map((x) => ({ pct: fmtPct(x.similitud_parametros_pct), coords: formatoLatLon(x.lat, x.lon).texto, distancia: lineaDistancia(x.distancia_componentes, dRef) })));
  if (dom.some((d) => d.pct === fmtPct(0))) falla(`${que}: a 0.0 % component match is on screen`);
  const textos = await pag.evaluate(() => [...document.querySelectorAll('#avanzado-texto p')].map((p) => p.textContent));
  igual(`${que} advanced text`, textos, textoComponentes(M.clases));
  const sel = await pag.evaluate(() => ({ sel: window.__az.analogos.sel, total: document.querySelector('#metricas [data-v=total] span')?.textContent }));
  if (sel.sel.k !== 0 || sel.total !== fmtPct(rc.resultados[0].similitud_parametros_pct)) falla(`${que}: Metrics after reordering ${JSON.stringify(sel)}`);
  ok(`${que} "Count related parameters once": ${dom.map((d) => `${d.coords} ${d.pct} ${d.distancia}`).join(' | ')} = node (Metrics follows place 1)`);
  await pag.screenshot({ path: join(SALIDA, `${etiqueta}-5-componentes.png`) });
  await pag.click('label.interruptor:has(#por-componentes)');
  await pag.waitForTimeout(150);
  const vuelta = await leer();
  igual(`${que} switch off restores the order`, vuelta.map((d) => d.coords), r.resultados.map((x) => formatoLatLon(x.lat, x.lon).texto));
  if (vuelta.some((d) => d.distancia)) falla(`${que}: distance line left after switching off`);
  await pag.click('#avanzado summary');
}

try {
  for (const [mundo, id, etiqueta] of [['mars', 'jezero', 'jezero'], ['moon', 'shackleton_borde', 'shackleton']]) {
    const s = sug(mundo, id), o = M.leerPunto(mundo, s.lat, s.lon), r = M.buscar(o), que = s.nombre;
    const pag = await pagina(1440, 900, `${etiqueta} desktop`);
    await abrir(pag, mundo, s);
    await comprobarEntorno(pag, que, o);
    await comprobarLugares(pag, que, r);
    await pag.screenshot({ path: join(SALIDA, `${etiqueta}-1-places.png`) });
    const mk0 = await marcadores(pag);
    if (mk0.some((m) => m.letra) || !mk0.some((m) => m.t === '1')) falla(`${que}: Places should show numbers only ${JSON.stringify(mk0)}`);
    const c = await comprobarCartera(pag, que, o);
    await pag.screenshot({ path: join(SALIDA, `${etiqueta}-2-portfolio.png`) });
    await pag.$eval('#sin-cubrir', (e) => e.scrollIntoView({ block: 'end' }));
    await pag.click('#cartera-como summary');
    await pag.waitForTimeout(150);
    await pag.screenshot({ path: join(SALIDA, `${etiqueta}-3-portfolio-abajo.png`) });
    await elegirB(pag, que, c, etiqueta);
    // Al volver a Places: números otra vez y el globo en el lugar de Metrics.
    await pestana(pag, 'lugares');
    const mk1 = await marcadores(pag);
    const sel = await pag.evaluate(() => window.__az.analogos.sel);
    if (mk1.some((m) => m.letra) || sel.lista !== 'resultados' || sel.k !== 0) falla(`${que}: back to Places: ${JSON.stringify({ mk1, sel })}`);
    else ok(`${que}: back to Places → numbers again, place 1 selected`);
    await comprobarTabla(pag, que, r, etiqueta);
    await comprobarComponentes(pag, que, o, r, etiqueta);
    // Capa de tipos de entorno: apaga la de similitud, y al revés.
    await pestana(pag, 'lugares');
    await pag.click('label.interruptor:has(#capa)');
    await pag.click('#entorno-como summary');
    await pag.click('label.interruptor:has(#capa-clases)');
    await esperarQue(pag, () => window.__az.analogos.capaClases === true, 'the environment layer');
    await pag.click('#reiniciar');
    await quieta(pag);
    const capas = await pag.evaluate(() => ({ clases: window.__az.analogos.capaClases, sim: window.__az.analogos.capa, simChk: document.getElementById('capa').checked, leyenda: !document.getElementById('leyenda').hidden, err: window.__az.analogos.errores }));
    if (!capas.clases || capas.sim || capas.simChk || capas.leyenda || capas.err.length) falla(`${que}: environment layer on should switch the similarity layer off ${JSON.stringify(capas)}`);
    else ok(`${que}: "Show Earth's environment types" on, similarity layer and its legend off`);
    await pag.screenshot({ path: join(SALIDA, `${etiqueta}-4-tipos.png`) });
    await pag.click('label.interruptor:has(#capa)');
    await pag.waitForTimeout(200);
    const capas2 = await pag.evaluate(() => ({ clases: window.__az.analogos.capaClases, chk: document.getElementById('capa-clases').checked, sim: window.__az.analogos.capa }));
    if (capas2.clases || capas2.chk || !capas2.sim) falla(`${que}: similarity on should switch the types off ${JSON.stringify(capas2)}`);
    await pag.context().close();
  }

  // ---------- Móvil 390 px: Shackleton ----------
  const S = sug('moon', 'shackleton_borde'), oS = M.leerPunto('moon', S.lat, S.lon), rS = M.buscar(oS);
  const mv = await pagina(390, 844, 'mobile', { isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await abrir(mv, 'moon', S);
  const fuera = () => mv.evaluate(() => {
    const malos = [];
    if (document.documentElement.scrollWidth > innerWidth) malos.push(`page ${document.documentElement.scrollWidth} px wide`);
    for (const e of document.querySelectorAll('#panel, .pestanas button, .tarjeta, #entorno, #sin-cubrir, .comparar summary')) {
      if (e.closest('[hidden]') || !e.getClientRects().length) continue;
      const r = e.getBoundingClientRect();
      if (r.left < -0.5 || r.right > innerWidth + 0.5) malos.push(`${e.id || e.className} x ${r.left.toFixed(0)}–${r.right.toFixed(0)}`);
    }
    const tabs = [...document.querySelectorAll('.pestanas button')].map((b) => b.getBoundingClientRect());
    if (tabs.some((t) => t.height < 44)) malos.push('tabs under 44 px');
    return malos;
  });
  let malos = await fuera();
  if (malos.length) falla(`mobile places: ${malos.join('; ')}`); else ok('mobile 390×844 Places: environment line, 3 tabs ≥ 44 px, nothing past the edges');
  await mv.screenshot({ path: join(SALIDA, 'movil-1-places.png') });
  await mv.tap('#tab-cartera');
  await mv.waitForTimeout(200);
  await quieta(mv);
  malos = await fuera();
  const mkM = await marcadores(mv);
  if (malos.length || !mkM.some((m) => m.t === 'A' && m.sel)) falla(`mobile portfolio: ${malos.join('; ')} markers ${JSON.stringify(mkM)}`); else ok('mobile Portfolio: letter A on the globe, cards inside 390 px');
  await mv.screenshot({ path: join(SALIDA, 'movil-2-portfolio.png') });
  await mv.tap('#tab-metricas');
  await mv.waitForTimeout(200);
  await mv.tap('#metricas .comparar summary');
  await mv.waitForTimeout(150);
  await mv.$eval('#metricas .comparar', (e) => e.scrollIntoView({ block: 'start' }));
  const tabla = await mv.evaluate(async () => {
    const sc = document.querySelector('.tabla-scroll'), th = sc.querySelector('tbody th');
    const antes = th.getBoundingClientRect().left;
    sc.scrollLeft = 400;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { ancho: sc.clientWidth, contenido: sc.scrollWidth, desplazado: sc.scrollLeft, antes, despues: th.getBoundingClientRect().left, celda: sc.querySelector('tbody td:not(.objetivo)').getBoundingClientRect().left, borde: sc.getBoundingClientRect().left };
  });
  malos = await fuera();
  if (malos.length || !(tabla.contenido > tabla.ancho) || tabla.desplazado < 100 || Math.abs(tabla.despues - tabla.antes) > 0.5) falla(`mobile Compare: ${malos.join('; ')} ${JSON.stringify(tabla)}`);
  else ok(`mobile Compare: table ${tabla.contenido} px in a ${tabla.ancho} px box, scrolled ${tabla.desplazado} px, first column stays at x=${tabla.despues.toFixed(0)}`);
  await mv.screenshot({ path: join(SALIDA, 'movil-3-compare.png') });
  await comprobarTabla(mv, 'mobile Shackleton rim', rS, 'movil-4');
  await mv.context().close();
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA_CARTERA: ${fallos.length} failure(s)` : 'CAPTURA_CARTERA: ok');
process.exit(fallos.length ? 1 : 0);

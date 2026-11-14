// Abre el mapa global en Chromium, comprueba clic, hoja, cambio de misión, validación y enlace permanente, y guarda capturas.
// Uso: node scripts/captura_mapa.mjs [--ejemplo]   (sin web/data/global/capas.json usa ?ejemplo=1)
import { createServer } from 'node:http';
import { readFile, mkdir, access } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { decodificarPNG, byteDe } from '../web/mapa/png.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
let SALIDA = join(RAIZ, 'capturas/mapa');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.geojson': 'application/geo+json', '.csv': 'text/csv' };
const OPCIONALES = /informe_validacion\.json$|condiciones\.json$/;

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
const base = `http://127.0.0.1:${servidor.address().port}`;

let reales = !process.argv.includes('--ejemplo');
if (reales) { try { await access(join(WEB, 'data/global/capas.json')); } catch { reales = false; } }
const DATOS = reales ? 'data/global' : 'data/global_ejemplo';
if (!reales) SALIDA = join(SALIDA, 'ejemplo');
console.log(reales ? 'data: web/data/global (real)' : 'data: SYNTHETIC web/data/global_ejemplo (?ejemplo=1) → capturas/mapa/ejemplo/');
await mkdir(SALIDA, { recursive: true });
const Q = reales ? '' : '?ejemplo=1';

const leerJSON = async (p) => JSON.parse(await readFile(join(WEB, p), 'utf8'));
const man = await leerJSON(`${DATOS}/capas.json`);
const R = man.rejilla;
const parIni = man.pares.find((p) => p.id === 'shackleton_P3') ?? man.pares[0];
const png = async (f) => decodificarPNG(new Uint8Array(await readFile(join(WEB, DATOS, f))));
const S = await png(parIni.ficheros.s), C = await png(parIni.ficheros.c);
const canS = man.canales[parIni.ficheros.s][0];
const celdaDe = (lat, lon) => ({ fila: Math.round((R.lat0 - lat) / R.paso), col: Math.round((lon - R.lon0) / R.paso) });
const esTierra = (f, c) => byteDe(C, f, c, 1) !== 255;
let informe = null;
try { informe = await leerJSON(`${DATOS}/informe_validacion.json`); } catch { /* opcional */ }

const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const vigilar = (pag, etiqueta) => {
  pag.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text()) && OPCIONALES.test(m.location()?.url ?? '')) return;
    falla(`console${etiqueta}: ${m.text()} ${m.location()?.url ?? ''}`);
  });
  pag.on('pageerror', (e) => falla(`page error${etiqueta}: ${e.message}`));
};
const pag = await nav.newPage({ viewport: { width: 1600, height: 900 } });
vigilar(pag, '');
const listo = (p) => p.waitForFunction(() => window.__mapa?.listo === true, null, { timeout: 60000 });
const muestraLienzo = (p) => p.evaluate(() => {
  const cv = document.getElementById('mapa'), g = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const set = new Set();
  let h = 0;
  for (let i = 0; i < g.length; i += 4 * 97) { set.add((g[i] << 16) | (g[i + 1] << 8) | g[i + 2]); h = (h * 31 + g[i] + g[i + 1] * 7 + g[i + 2] * 13) >>> 0; }
  return { colores: set.size, huella: h };
});
const clicCelda = async (p, f, c) => {
  const pt = await p.evaluate(([f, c]) => window.__mapa.aPantalla(f, c), [f, c]);
  await p.mouse.click(pt.x, pt.y);
  await p.waitForTimeout(250);
};

try {
  await pag.goto(`${base}/index.html${Q}`);
  await listo(pag);
  const info = await pag.evaluate(() => ({ errores: window.__mapa.errores, par: window.__mapa.par?.id, capa: window.__mapa.capa, banda: !document.getElementById('banda-sintetico').hidden, titulo: document.title, lema: document.querySelector('.lema')?.textContent }));
  if (info.errores.length) falla(`page errors: ${info.errores.join('; ')}`);
  if (info.par !== parIni.id || info.capa !== 'S') falla(`initial pair/layer ${info.par}/${info.capa}, expected ${parIni.id}/S`); else ok(`opens on ${info.par} · S`);
  if (info.banda !== (!reales || man.ejemplo === true)) falla(`synthetic banner shown=${info.banda} with real=${reales}`); else ok(`synthetic banner ${info.banda ? 'shown' : 'hidden'}`);
  if (info.titulo !== 'Analog Zero' || !/^Find where on Earth to test Moon-base equipment/.test(info.lema ?? '')) falla('title or tagline wrong');
  const l0 = await muestraLienzo(pag);
  if (l0.colores < 20) falla(`map canvas blank (${l0.colores} colours)`); else ok(`map canvas ${l0.colores} sampled colours`);
  await pag.screenshot({ path: join(SALIDA, '01-mapa.png') });

  // Clic en el mejor candidato: la hoja lleva el valor del píxel.
  const geo = await leerJSON(`${DATOS}/${parIni.candidatos.geojson}`);
  const mejor = geo.features.map((x) => x.properties).sort((a, b) => a.puesto - b.puesto)[0];
  const k = celdaDe(mejor.lat, mejor.lon);
  await clicCelda(pag, k.fila, k.col);
  const byte = byteDe(S, k.fila, k.col, 0), esperado = canS.offset + byte * canS.scale;
  const hoja = await pag.evaluate(() => ({ ...window.__mapa.hoja, texto: document.querySelector('#hoja [data-v=S]')?.textContent, flor: document.querySelectorAll('#hoja svg.flor .petalo').length }));
  if (hoja.fila !== k.fila || hoja.col !== k.col) falla(`click on best candidate opened ${hoja.fila},${hoja.col}, expected ${k.fila},${k.col}`);
  else if (hoja.S !== esperado || hoja.sByte !== byte) falla(`sheet S ${hoja.S} (byte ${hoja.sByte}) ≠ pixel ${esperado} (byte ${byte})`);
  else ok(`best candidate cell ${k.fila},${k.col}: sheet S ${hoja.texto} = pixel byte ${byte} · ${canS.scale} (geojson S ${mejor.S}), rank #${hoja.puesto}, ${hoja.flor} petals`);
  if (hoja.puesto !== mejor.puesto) falla(`sheet rank ${hoja.puesto} ≠ 1`);
  if (Math.abs(mejor.S - esperado) > canS.scale) falla(`candidate S ${mejor.S} far from its pixel ${esperado}`);
  const nDims = Object.keys(parIni.pesos).length;
  if (hoja.flor !== nDims) falla(`flower has ${hoja.flor} petals, mission weights ${nDims} dimensions`);

  // Haughton: sitio conocido con terreno 3D → nombre y puente al visor.
  const hau = celdaDe(75.3833, -89.6667);
  if (!esTierra(hau.fila, hau.col)) console.log('note: Haughton cell is ocean in these layers; bridge not checked there');
  else {
    await clicCelda(pag, hau.fila, hau.col);
    const h = await pag.evaluate(() => ({ ...window.__mapa.hoja, href: document.querySelector('#hoja .abrir-terreno')?.getAttribute('href') }));
    if (!/Haughton/.test(h.nombre ?? '') || !h.terrenos?.includes('haughton') || !/a=haughton&b=shackleton/.test(h.href ?? '')) falla(`Haughton sheet: ${JSON.stringify(h)}`);
    else ok(`Haughton cell: "${h.nombre}", button → ${h.href}`);
    const r = await pag.request.get(`${base}/${h.href}`);
    if (!r.ok()) falla(`terrain link ${h.href} → ${r.status()}`);
  }
  // Celda sin terreno: texto, sin botón.
  await clicCelda(pag, k.fila, k.col);
  const sinTerreno = await pag.evaluate(() => ({ t: document.querySelector('#hoja [data-v=sin-terreno]')?.textContent ?? null, b: document.querySelectorAll('#hoja .abrir-terreno').length, terr: window.__mapa.hoja.terrenos }));
  if (sinTerreno.terr.length === 0 && (sinTerreno.t !== 'no 3D terrain generated for this cell yet' || sinTerreno.b)) falla(`cell without terrain: ${JSON.stringify(sinTerreno)}`);
  else if (sinTerreno.terr.length === 0) ok('cell without terrain says "no 3D terrain generated for this cell yet" and has no button');
  await pag.click('#hoja details.tabla summary');
  await pag.waitForTimeout(150);
  await pag.screenshot({ path: join(SALIDA, '02-hoja.png') });
  const filasTabla = await pag.$$eval('#hoja .comp tbody tr', (t) => t.length);
  const nVars = Object.entries(man.canales).filter(([f]) => /^var_/.test(f)).reduce((s, [, c]) => s + c.filter((x) => !x.vacio).length, 0);
  if (filasTabla < nVars + nDims) falla(`values table has ${filasTabla} rows, expected ≥ ${nVars + nDims}`); else ok(`values table: ${filasTabla} rows (${nVars} raw variables, ${nDims} dimensions)`);

  // Celda que falla una puerta y celda no evaluable: hoja con motivo, sin puesto.
  for (const [nombre, prueba] of [['fails a gate', (f, c) => esTierra(f, c) && (byteDe(C, f, c, 1) & 15)], ['not evaluable', (f, c) => esTierra(f, c) && !(byteDe(C, f, c, 1) & 15) && byteDe(S, f, c, 0) === 255]]) {
    let celda = null;
    for (let f = 60; f < 300 && !celda; f += 3) for (let c = 0; c < R.ancho; c += 3) if (prueba(f, c)) { celda = { f, c }; break; }
    if (!celda) { console.log(`note: no "${nombre}" cell found between rows 60 and 300`); continue; }
    await clicCelda(pag, celda.f, celda.c);
    const h = await pag.evaluate(() => ({ ...window.__mapa.hoja, sit: document.querySelector('#hoja .situacion')?.textContent }));
    if (h.fila !== celda.f || h.puesto !== null || h.S !== null || !new RegExp(nombre, 'i').test(h.sit ?? '')) falla(`${nombre} cell ${celda.f},${celda.c}: ${JSON.stringify(h)}`);
    else ok(`${nombre} cell ${celda.f},${celda.c}: sheet opens without rank — "${h.sit.trim().slice(0, 90)}"`);
  }

  // Océano: sin hoja, con aviso.
  await pag.keyboard.press('Escape');
  let oc = null;
  for (let r = 0; r < 60 && !oc; r++) for (let d = -r; d <= r && !oc; d++) { const f = 180 + d, c = 60 + r; if (!esTierra(f, c)) oc = { f, c }; }
  await clicCelda(pag, oc.f, oc.c);
  const tras = await pag.evaluate(() => ({ hoja: window.__mapa.hoja, aviso: window.__mapa.aviso }));
  if (tras.hoja !== null || !/Ocean/.test(tras.aviso ?? '')) falla(`ocean click ${oc.f},${oc.c}: ${JSON.stringify(tras)}`); else ok(`ocean click ${oc.f},${oc.c}: no sheet, notice "${tras.aviso}"`);

  // Otra misión: recolorea sin recargar; la hoja abierta se rehace con el nuevo par.
  const otro = man.pares.find((p) => p.objetivo === parIni.objetivo && p.id !== parIni.id) ?? man.pares.find((p) => p.id !== parIni.id);
  await clicCelda(pag, k.fila, k.col);
  await pag.evaluate(() => { window.__sinRecarga = true; });
  if (otro.objetivo === parIni.objetivo) await pag.click(`#misiones [data-par="${otro.id}"]`);
  else await pag.selectOption('#objetivo', otro.objetivo);
  await pag.waitForFunction((id) => window.__mapa.par?.id === id && window.__mapa.leyenda, otro.id, { timeout: 20000 });
  await pag.waitForTimeout(250);
  const l1 = await muestraLienzo(pag);
  const cambio = await pag.evaluate(() => ({ sin: window.__sinRecarga === true, nota: !document.getElementById('nota-par').hidden, et: document.querySelector('#hoja .cab-hoja .et')?.textContent }));
  if (!cambio.sin) falla('mission change reloaded the page');
  if (l1.huella === l0.huella) falla('mission change did not recolour the map');
  if (otro.prerregistrado === false && !cambio.nota) falla('non-pre-registered pair without its note');
  if (!cambio.et?.includes(otro.mision)) falla(`open sheet not redone for ${otro.id}: ${cambio.et}`);
  ok(`switched to ${otro.id} without reload (recoloured; note ${cambio.nota ? 'shown' : 'hidden'}; sheet "${cambio.et}")`);
  await pag.screenshot({ path: join(SALIDA, '03-otra-mision.png') });

  // Validación.
  const boton = await pag.$('#validacion .ver-detalle');
  if (informe) {
    if (!boton) falla('validation report present but no "how this was validated"');
    else {
      await boton.click();
      await pag.waitForTimeout(150);
      const v = await pag.evaluate(() => ({ linea: document.getElementById('val-linea').textContent, det: document.getElementById('val-detalle').textContent, vis: !document.getElementById('val-detalle').hidden, sha: document.querySelector('#val-detalle [data-v=sha]')?.textContent }));
      if (!v.vis || v.sha !== informe.umbrales_sha256 || !/not pre-registered/i.test(v.det)) falla(`validation detail: ${JSON.stringify(v).slice(0, 300)}`);
      else ok(`validation: "${v.linea.replace(/\s+/g, ' ').trim().slice(0, 140)}"`);
      if (informe.h1?.k !== undefined && !v.linea.includes(`recovers ${informe.h1.k} of ${informe.h1.n_sitios}`)) falla('validation line does not match informe_validacion.json');
    }
  } else {
    const t = await pag.$eval('#val-linea', (d) => d.textContent);
    if (!/validation pending/.test(t)) falla('without informe_validacion.json the page should say "validation pending"'); else ok('validation pending (no informe_validacion.json)');
  }
  const sombras = await pag.$eval('#val-sombras', (d) => d.textContent);
  if (!/Pearson 0\.99/.test(sombras)) falla(`shadow line: ${sombras}`); else ok(`shadows: ${sombras.replace(/\s+/g, ' ').trim().slice(0, 120)}`);
  await pag.screenshot({ path: join(SALIDA, '04-validacion.png') });

  // Descargas del par activo.
  for (const id of ['desc-csv', 'desc-geojson']) {
    const href = await pag.$eval(`#${id}`, (a) => a.getAttribute('href'));
    const r = href ? await pag.request.get(`${base}/${href}`) : null;
    if (!href || !href.includes(otro.id) || !r.ok()) falla(`${id} → ${href} (${r?.status()})`);
  }
  ok(`downloads point at ${otro.id}`);

  // Enlace permanente: par, capa y celda.
  const dim = await pag.evaluate(() => window.__mapa.capas.find((c) => c.grupo === 'dimension')?.id);
  await pag.selectOption('#capa', dim);
  await pag.waitForFunction((d) => window.__mapa.leyenda?.capa === d, dim);
  const estado1 = await pag.evaluate(() => ({ par: window.__mapa.par.id, capa: window.__mapa.capa, fila: window.__mapa.hoja?.fila, col: window.__mapa.hoja?.col, url: location.href }));
  const pag2 = await nav.newPage({ viewport: { width: 1400, height: 850 } });
  vigilar(pag2, ' (permalink)');
  await pag2.goto(estado1.url);
  await listo(pag2);
  const estado2 = await pag2.evaluate(() => ({ par: window.__mapa.par.id, capa: window.__mapa.capa, fila: window.__mapa.hoja?.fila, col: window.__mapa.hoja?.col, url: location.href }));
  if (['par', 'capa', 'fila', 'col'].some((x) => estado1[x] !== estado2[x])) falla(`permalink ${estado1.url} restored ${JSON.stringify(estado2)}`);
  else ok(`permalink ${estado1.url.replace(base, '')} restores pair, layer and cell`);
  await pag2.close();

  // Modo «test conditions».
  let cm = null;
  try { cm = await leerJSON(`${DATOS}/condiciones.json`); } catch { /* sin generar */ }
  const botonCond = await pag.$eval('#modos [data-modo=cond]', (b) => ({ dis: b.disabled, nota: document.getElementById('modo-nota').textContent }));
  if (!cm) {
    if (!botonCond.dis || botonCond.nota !== 'test conditions not generated') falla(`without condiciones.json: ${JSON.stringify(botonCond)}`); else ok('test conditions disabled: "test conditions not generated"');
  } else {
    if (botonCond.dis) falla('condiciones.json present but TEST CONDITIONS disabled');
    if (await pag.$eval('#val-detalle', (d) => !d.hidden)) await pag.click('#validacion .ver-detalle');
    const lr0 = await muestraLienzo(pag);
    const valAntes = await pag.$eval('#val-linea', (d) => d.textContent);
    await pag.click('#modos [data-modo=cond]');
    await pag.waitForFunction(() => window.__mapa.modo === 'cond' && window.__mapa.leyenda?.capa?.startsWith('cond:'), null, { timeout: 20000 });
    await pag.waitForTimeout(250);
    const c0 = await pag.evaluate(() => ({ eq: window.__mapa.cond.eqId, clave: window.__mapa.cond.clave, contorno: !!window.__mapa.cond.contorno,
      rotulo: document.querySelector('#nota-cond .rotulo-cond').textContent, visibleNota: !document.getElementById('nota-cond').hidden,
      rankingOculto: document.getElementById('mandos-ranking').hidden, resumen: document.getElementById('cond-resumen').textContent,
      leyenda: document.getElementById('leyenda').textContent, val: document.getElementById('val-linea').textContent }));
    const ltv = cm.equipos.find((e) => e.id === 'ltv'), rs = ltv.requisitos.find((r) => r.variable === 'horas_en_sombra');
    const esperado = `${rs.prueba}: ${rs.pct_tierra.toFixed(1)} % of land, north of ${rs.lat_umbral.norte.toFixed(2)}° N / south of ${Math.abs(rs.lat_umbral.sur).toFixed(2)}° S`;
    if (c0.eq !== 'ltv' || c0.clave !== String(rs.indice)) falla(`test conditions opens on ${c0.eq}/${c0.clave}, expected ltv/${rs.indice}`);
    if (c0.rotulo !== 'Not part of the pre-registered validation — physical conditions computed from latitude and NASA POWER climate' || !c0.visibleNota) falla(`fixed label: ${c0.rotulo}`);
    if (!c0.rankingOculto) falla('ranking controls still visible in test conditions');
    if (c0.resumen !== esperado) falla(`summary "${c0.resumen}" ≠ "${esperado}"`); else ok(`summary: ${c0.resumen}`);
    if (!c0.contorno) falla('no contour for a reachable requirement');
    if (!c0.leyenda.includes(rs.cita) || !c0.leyenda.includes(rs.prueba)) falla('legend without the limit and its citation');
    if (c0.val !== valAntes) falla('validation line changed when switching mode');
    const lr1 = await muestraLienzo(pag);
    if (lr1.huella === lr0.huella || lr1.colores < 10) falla(`conditions map not painted (${lr1.colores} colours)`); else ok(`conditions map painted (${lr1.colores} sampled colours), contour drawn, legend cites the catalog`);
    await pag.screenshot({ path: join(SALIDA, '05-condiciones.png') });

    // Haughton: alcanza la oscuridad; botón al terreno 3D.
    const sitioCelda = (id) => cm.sitios.find((s) => s.id === id);
    const hz = sitioCelda('haughton');
    await clicCelda(pag, hz.fila, hz.col);
    const hh = await pag.evaluate(() => ({ ...window.__mapa.hoja, href: document.querySelector('#hoja .abrir-terreno')?.getAttribute('href'), filasDom: document.querySelectorAll('#hoja .cond .req-cond').length }));
    const fsh = hh.filas?.find((f) => f.variable === 'horas_en_sombra');
    const exacto = cm.por_latitud.oscuridad_max_h[hz.fila];
    if (hh.modo !== 'cond' || hh.filasDom !== ltv.requisitos.length || fsh?.veredicto !== 'reaches' || fsh.valor !== exacto) falla(`Haughton conditions sheet: ${JSON.stringify(hh).slice(0, 400)}`);
    else ok(`Haughton (${hz.fila},${hz.col}): ${hh.filasDom} rows, darkness ${fsh.valor} h → ${fsh.texto}; terrain rows "${hh.filas.filter((f) => f.veredicto === 'terreno').map((f) => f.texto)[0]}"`);
    if (!/a=haughton&b=shackleton/.test(hh.href ?? '')) falla(`Haughton conditions sheet without the terrain button: ${hh.href}`);

    // VIPER: el frío de 40 K no se alcanza (rojo, con laboratorio); solo eso va en rojo.
    const viper = cm.equipos.find((e) => e.id === 'viper');
    await pag.selectOption('#cond-eq', 'viper');
    await pag.waitForFunction(() => window.__mapa.hoja?.eq === 'viper', null, { timeout: 20000 });
    await pag.waitForTimeout(200);
    const hv = await pag.evaluate(() => ({ filas: window.__mapa.hoja.filas, rojos: [...document.querySelectorAll('#hoja .cond .ver.v-rompe')].map((t) => t.textContent), sub: [...document.querySelectorAll('#hoja .cond .sub')].map((t) => t.textContent) }));
    const noAlc = viper.requisitos.filter((r) => r.veredicto_global === 'not_reachable').length;
    if (hv.filas.length !== viper.requisitos.length || hv.rojos.length !== noAlc || hv.rojos.some((t) => t !== 'not reachable on Earth')) falla(`VIPER sheet: ${JSON.stringify(hv).slice(0, 400)}`);
    else ok(`VIPER at Haughton: ${hv.filas.map((f) => `${f.variable} ${f.texto}`).join(' · ')}`);
    if (!hv.sub.some((t) => /chamber only/.test(t) && /Glenn/.test(t))) falla(`not reachable without chamber/lab line: ${hv.sub.join(' | ')}`);
    await pag.screenshot({ path: join(SALIDA, '06-hoja-condiciones.png') });

    // S P Crater: oscuridad parcial con la fracción del manifiesto.
    const spc = sitioCelda('sp_crater');
    await clicCelda(pag, spc.fila, spc.col);
    const rv = viper.requisitos.find((r) => r.variable === 'horas_en_sombra');
    const sv = rv.sitios.find((s) => s.id === 'sp_crater');
    const hs = await pag.evaluate(() => window.__mapa.hoja.filas.find((f) => f.variable === 'horas_en_sombra'));
    if (hs.texto !== `partial (${Math.round(sv.fraccion * 100)} %)`) falla(`S P Crater VIPER darkness "${hs.texto}", manifest fraction ${sv.fraccion}`); else ok(`S P Crater: VIPER darkness ${hs.valor} h → ${hs.texto}`);

    // Filtro de acceso (umbral propio) y enlace permanente del modo.
    await pag.fill('#cond-acc', '24');
    await pag.press('#cond-acc', 'Enter');
    await pag.waitForFunction(() => window.__mapa.cond.acc === 24 && /more than 24 h/.test(document.getElementById('leyenda').textContent), null, { timeout: 20000 });
    const urlC = await pag.evaluate(() => location.href);
    if (!/modo=cond/.test(urlC) || !/eq=viper/.test(urlC) || !/acc=24/.test(urlC)) falla(`conditions permalink ${urlC}`);
    const pag4 = await nav.newPage({ viewport: { width: 1400, height: 850 } });
    vigilar(pag4, ' (conditions permalink)');
    await pag4.goto(urlC);
    await listo(pag4);
    const e4 = await pag4.evaluate(() => ({ modo: window.__mapa.modo, eq: window.__mapa.cond?.eqId, clave: window.__mapa.cond?.clave, acc: window.__mapa.cond?.acc, fila: window.__mapa.hoja?.fila, col: window.__mapa.hoja?.col, hm: window.__mapa.hoja?.modo }));
    const e1 = await pag.evaluate(() => ({ modo: window.__mapa.modo, eq: window.__mapa.cond.eqId, clave: window.__mapa.cond.clave, acc: window.__mapa.cond.acc, fila: window.__mapa.hoja?.fila, col: window.__mapa.hoja?.col, hm: window.__mapa.hoja?.modo }));
    if (JSON.stringify(e1) !== JSON.stringify(e4)) falla(`conditions permalink restored ${JSON.stringify(e4)}, expected ${JSON.stringify(e1)}`);
    else ok(`conditions permalink ${urlC.replace(base, '')} restores mode, equipment, requirement, access threshold and cell`);
    await pag4.close();

    // Vuelta al ranking: intacto, con su aviso.
    await pag.click('#modos [data-modo=ranking]');
    await pag.waitForFunction(() => window.__mapa.modo === 'ranking' && !window.__mapa.leyenda?.capa?.startsWith('cond:'), null, { timeout: 20000 });
    const r2 = await pag.evaluate(() => ({ visibles: !document.getElementById('mandos-ranking').hidden && document.getElementById('mandos-cond').hidden, val: document.getElementById('val-linea').textContent, hoja: window.__mapa.hoja?.modo ?? 'ranking' }));
    if (!r2.visibles || r2.val !== valAntes || r2.hoja !== 'ranking') falla(`back to ranking: ${JSON.stringify(r2).slice(0, 300)}`); else ok('back to SIMILARITY RANKING: controls, validation notice and sheet restored');
  }
  // Sin condiciones.json: modo deshabilitado con su texto.
  const pag5 = await nav.newPage({ viewport: { width: 1200, height: 800 } });
  vigilar(pag5, ' (no conditions)');
  await pag5.route(/condiciones\.json$/, (r) => r.fulfill({ status: 404, body: '' }));
  await pag5.goto(`${base}/index.html${Q}`);
  await listo(pag5);
  const nc = await pag5.evaluate(() => ({ dis: document.querySelector('#modos [data-modo=cond]').disabled, nota: document.getElementById('modo-nota').textContent, modo: window.__mapa.modo }));
  if (!nc.dis || nc.nota !== 'test conditions not generated' || nc.modo !== 'ranking') falla(`without condiciones.json: ${JSON.stringify(nc)}`); else ok('without condiciones.json: TEST CONDITIONS disabled, "test conditions not generated"');
  await pag5.close();

  // Sin datos globales: mensaje claro, sin datos de ejemplo.
  const ctx = await nav.newContext({ viewport: { width: 1200, height: 800 } });
  const pag3 = await ctx.newPage();
  pag3.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) falla(`console (no data): ${m.text()}`); });
  pag3.on('pageerror', (e) => falla(`page error (no data): ${e.message}`));
  await pag3.route(/\/data\/global(_ejemplo)?\//, (r) => r.fulfill({ status: 404, body: '' }));
  await pag3.goto(`${base}/index.html`);
  await listo(pag3);
  const sin = await pag3.evaluate(() => ({ txt: document.getElementById('lienzo').textContent, banda: !document.getElementById('banda-sintetico').hidden, par: window.__mapa.par, val: document.getElementById('val-linea').textContent }));
  if (!/global layers not found/.test(sin.txt) || sin.banda || sin.par || !/validation pending/.test(sin.val)) falla(`without global data: ${JSON.stringify(sin)}`);
  else ok('without web/data/global: "global layers not found", no example data, "validation pending"');
  await ctx.close();
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA_MAPA: ${fallos.length} failure(s)` : 'CAPTURA_MAPA: ok');
process.exit(fallos.length ? 1 : 0);

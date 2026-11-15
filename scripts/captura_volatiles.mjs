// Volátiles en Chromium con GPU: capa STABLE ICE, DRILL HERE (Luna y Tierra) y planta de agua en la hoja.
// Compara las cifras de pantalla con panel_volatiles.js/volatiles.js ejecutado aquí sobre los mismos .f32. Uso: node scripts/captura_volatiles.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { defectosVolatiles, capaHielo, tarjetaPerforacion, hojaPlanta, celdaEstableMasCercana, fmtV, NO_MEDIBLE } from '../web/terreno/panel_volatiles.js';
import { defectosFlota, SUPUESTOS } from '../web/terreno/panel_obra.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'volatiles');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

const fallos = [];
const falla = (m) => { fallos.push(m); console.error(`FAIL ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);
const igual = (a, b, que) => {
  if (a === b) return true;
  falla(`${que}: screen ${a} ≠ node ${b}`);
  return false;
};

// ---------- Datos y cifras de referencia en node ----------
function leerTerreno(id) {
  const dir = join(WEB, 'data/terreno', id);
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const leer = (c) => {
    const b = readFileSync(join(dir, c.fichero));
    if (c.tipo === 'uint8') return Float32Array.from(b, (u) => (u === 255 ? NaN : u));
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  const capas = {};
  for (const [k, c] of Object.entries(meta.capas)) if (k !== 'altura') capas[k] = leer(c);
  return { meta, n: meta.n, m_por_px: meta.m_por_px, alturas: leer(meta.capas.altura), capas };
}
const OBRA = JSON.parse(readFileSync(join(WEB, 'data/obra.json'), 'utf8'));
const CAT = JSON.parse(readFileSync(join(WEB, 'data/equipo.json'), 'utf8'));
const D = defectosVolatiles(OBRA, CAT.equipos);
const F = defectosFlota(OBRA, CAT.equipos);

// Celda cuyo vecindario 5×5 cumple la condición, la más cercana al centro de la rejilla.
function celdaHomogenea(t, cond) {
  const { n } = t, k = Math.floor(n / 2);
  for (let r = 0; r < n / 2; r++) for (let a = 0; a < Math.max(8 * r, 1); a++) {
    const f = Math.round(k + r * Math.sin((2 * Math.PI * a) / Math.max(8 * r, 1))), c = Math.round(k + r * Math.cos((2 * Math.PI * a) / Math.max(8 * r, 1)));
    let todo = true;
    for (let df = -2; df <= 2 && todo; df++) for (let dc = -2; dc <= 2 && todo; dc++) {
      const ff = f + df, cc = c + dc;
      if (ff < 0 || cc < 0 || ff >= n || cc >= n || !cond(ff * n + cc)) todo = false;
    }
    if (todo) return { f, c };
  }
  return null;
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
const A = '.panel[data-lado=a]', B = '.panel[data-lado=b]';

async function abrir(url) {
  const pag = await nav.newPage({ viewport: { width: 1600, height: 900 } });
  pag.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') falla(`console ${m.type()}: ${m.text()}`); });
  pag.on('pageerror', (e) => falla(`page error: ${e.message}`));
  pag.on('worker', (w) => w.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') falla(`worker console ${m.type()}: ${m.text()}`); }));
  await pag.goto(url);
  await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: 60000 });
  await pag.waitForFunction(() => window.__az.paneles.every((p) => !p.escena || p.volatiles?.V.D), null, { timeout: 30000 });
  const errores = await pag.evaluate(() => window.__az.errores);
  if (errores.length) falla(`panel errors: ${errores.join('; ')}`);
  return pag;
}
const vista = (pag, k, centro, alto_km) => pag.evaluate(([k, centro, alto]) => new Promise((ok) => {
  const e = window.__az.paneles[k].escena;
  const w = e.mundoDePixel(centro.f, centro.c);
  e.controles.target.set(w.x, w.y, w.z);
  e.camara.position.set(w.x, w.y + alto, w.z + alto * 0.35);
  e.controles.update();
  e.sucio = true;
  requestAnimationFrame(() => requestAnimationFrame(() => { const s = e.aPantalla(e.mundoDePixel(centro.f, centro.c)); ok({ x: s?.x, y: s?.y }); }));
}), [k, centro, alto_km]);
const cuadro = () => new Promise((r) => setTimeout(r, 250));

async function capaPantalla(pag, sel, id) {
  const t = leerTerreno(id), ref = capaHielo(t, D.umbral.valor);
  await pag.click(`${sel} .mandos [data-capa="_hielo_estable"]`);
  await cuadro();
  const s = await pag.evaluate((sel) => {
    const p = window.__az.paneles.find((q) => q.el.matches(sel));
    const d = p.el.querySelector('[data-v=pct-hielo]');
    return { pct: d ? +d.dataset.pct : null, txt: d?.textContent ?? null, modo: p.escena.uniforms.uCapaModo.value, ley: p.el.querySelector('[data-v=leyenda-hielo]')?.textContent.replace(/\s+/g, ' ').trim() ?? null };
  }, sel);
  igual(s.pct, ref.pct, `${id} stable-ice %`);
  igual(s.txt, fmtV.pct(ref.pct), `${id} stable-ice % text`);
  if (s.modo !== 3) falla(`${id}: layer shader mode ${s.modo}, expected 3`);
  if (!/does not show that ice is present/.test(s.ley ?? '') || !/QUOTE/i.test(s.ley ?? '')) falla(`${id}: legend lacks the honest label or the quote: ${s.ley}`);
  ok(`${id} STABLE ICE: screen ${s.txt} (${s.pct}) = node ${ref.pct} · legend: "${s.ley}"`);
  return ref;
}

async function leerTarjeta(pag, sel) {
  return pag.evaluate((sel) => {
    const p = window.__az.paneles.find((q) => q.el.matches(sel)), c = p.el.querySelector('.perforacion');
    const dd = {};
    c.querySelectorAll('dd[data-v]').forEach((d) => { dd[d.dataset.v] = { valor: d.dataset.valor, estado: d.dataset.estado, txt: d.textContent.replace(/\s+/g, ' ').trim() }; });
    const tr = {};
    c.querySelectorAll('tr[data-v]').forEach((r) => { const td = r.querySelectorAll('td'); tr[r.dataset.v] = { estado: td[td.length - 1].dataset.estado, txt: td[td.length - 1].textContent.trim(), luna: td.length === 3 ? td[1].textContent.trim() : null }; });
    const nm = [...c.querySelectorAll('.no-medido')].map((d) => d.textContent.trim());
    return { perf: p.volatiles.V.perf, oculta: c.hidden, dd, tr, nm, esperado: c.querySelector('[data-v=hielo-esperado]')?.textContent.replace(/\s+/g, ' ').trim() ?? null, marca: !p.el.querySelector('.perf-marca').hidden };
  }, sel);
}

async function perforar(pag, sel, k, celda, alto) {
  const s = await vista(pag, k, celda, alto);
  await pag.click(`${sel} .acciones .perforar`);
  await pag.mouse.click(s.x, s.y);
  await cuadro();
  return leerTarjeta(pag, sel);
}

function compararLectura(t, x, id, luna) {
  const ref = tarjetaPerforacion({ t, fila: x.perf.fila, col: x.perf.col, luna, D });
  for (const r of ref.lectura) {
    const d = x.dd[r.k];
    if (!d) { falla(`${id}: no row ${r.k}`); continue; }
    igual(d.estado, r.estado, `${id} ${r.k} state`);
    igual(d.valor, r.valor === null ? '' : String(r.valor), `${id} ${r.k} value`);
    igual(d.txt, r.texto, `${id} ${r.k} text`);
  }
  return ref;
}

try {
  // ---------- 1: capa en shoemaker y shackleton ----------
  let pag = await abrir(`${baseUrl}/terreno/index.html?a=haughton&b=shoemaker&solo=shoemaker`);
  await capaPantalla(pag, B, 'shoemaker');
  await pag.screenshot({ path: join(SALIDA, '01-hielo-shoemaker.png') });
  await pag.click(`${B} .mandos [data-capa=""]`);
  await cuadro();
  if (await pag.$(`${B} [data-v=leyenda-hielo]`)) falla('shoemaker: legend still there after LAYER None');
  else ok('shoemaker: LAYER None removes the stable-ice legend');
  await pag.close();

  pag = await abrir(`${baseUrl}/terreno/index.html?a=haughton&b=shackleton&solo=shackleton`);
  const S = leerTerreno('shackleton');
  await capaPantalla(pag, B, 'shackleton');
  await pag.screenshot({ path: join(SALIDA, '02-hielo-shackleton.png') });

  // ---------- 2: DRILL HERE en una celda fría en sombra y en una iluminada ----------
  const T = S.capas.temp_max, P = S.capas.sombra_permanente, L = S.capas.iluminacion;
  const frio = celdaHomogenea(S, (i) => T[i] <= D.umbral.valor && P[i] === 1);
  const lit = celdaHomogenea(S, (i) => T[i] > D.umbral.valor && L[i] > 0.3);
  console.log(`cold PSR cell ${frio.f},${frio.c} · lit cell ${lit.f},${lit.c}`);
  let x = await perforar(pag, B, 1, frio, 3);
  let ref = compararLectura(S, x, 'drill cold', true);
  if (ref.hielo !== 'si') falla(`drill cold: node says ${ref.hielo} at ${x.perf.fila},${x.perf.col}`);
  igual(x.dd.bocados?.valor, String(ref.plan.bocados), 'drill bites');
  for (const k of ['time between bites (pulling the drill up, brushing the cuttings out, reading them): NOT MEASURED', 'ice below the surface here: NOT MEASURED']) if (!x.nm.some((s) => s.startsWith(k))) falla(`drill cold: missing "${k}"`);
  // Secuencia real de TRIDENT: 10 bocados de 10 cm a 1,25 mm/s = 80 s cada uno; «Next bite» avanza y lo dice.
  const sec = async () => pag.evaluate((sel) => { const t = document.querySelector(`${sel} .perforacion`); return { n: t.querySelector('[data-v=secuencia]')?.dataset.bocados, k: t.querySelector('[data-v=secuencia]')?.dataset.bocado, paso: t.querySelector('[data-v=sec-paso]')?.textContent, corte: t.querySelector('[data-v=corte]')?.dataset.valor, det: [...t.querySelectorAll('.perf-det li')].length, citas: [...t.querySelectorAll('.perf-det li a')].every((a) => /^https:\/\//.test(a.href)) }; }, B);
  let q = await sec();
  if (q.n !== '10' || q.k !== '0' || q.corte !== '800' || !/Footpad pressed on the ground/.test(q.paso ?? '')) falla(`drill sequence at start: ${JSON.stringify(q)}`);
  if (q.det < 13 || !q.citas) falla(`drill sequence: steps, measurements and Earth tests should each carry a source (${q.det} items)`);
  await pag.click(`${B} .perforacion [data-v=sec-sig]`);
  await pag.click(`${B} .perforacion [data-v=sec-sig]`);
  await pag.click(`${B} .perforacion [data-v=sec-sig]`);
  q = await sec();
  if (q.k !== '3' || !/Bite 3 of 10 · 20–30 cm · cutting 1 min 20 s \(4 min 00 s so far\)/.test(q.paso ?? '')) falla(`drill sequence after three bites: ${JSON.stringify(q)}`);
  else ok(`drill sequence: ${q.paso}`);
  if (!/not measured here/.test(x.esperado ?? '') || !/Cabeus/.test(x.esperado ?? '')) falla(`drill cold: expected ice not labelled as measured elsewhere: ${x.esperado}`);
  if (!x.marca) falla('drill cold: no mark on the terrain');
  ok(`drill cold ${x.perf.fila},${x.perf.col}: ${x.dd.temp_max.txt} · shadow ${x.dd.sombra.txt} · ${x.dd.hielo.txt} · bites ${x.dd.bocados?.txt} · "${x.esperado}"`);
  await pag.screenshot({ path: join(SALIDA, '03-perforar-frio.png') });
  await pag.locator(`${B} .perforacion`).screenshot({ path: join(SALIDA, '03b-perforar-frio-tarjeta.png') });

  x = await perforar(pag, B, 1, lit, 3);
  ref = compararLectura(S, x, 'drill lit', true);
  if (ref.hielo !== 'no') falla(`drill lit: node says ${ref.hielo}`);
  ok(`drill lit ${x.perf.fila},${x.perf.col}: ${x.dd.temp_max.txt} · shadow ${x.dd.sombra.txt} · light ${x.dd.iluminacion.txt} · ${x.dd.hielo.txt}`);
  await pag.screenshot({ path: join(SALIDA, '04-perforar-iluminada.png') });
  await pag.fill(`${B} .perforacion [data-v=prof]`, '1.5');
  await pag.$eval(`${B} .perforacion [data-v=prof]`, (i) => i.dispatchEvent(new Event('change')));
  await cuadro();
  const hondo = await leerTarjeta(pag, B);
  if (hondo.dd.bocados?.valor !== '15' || !/^yes/.test(hondo.dd.supera?.txt ?? '')) falla(`depth 1.5 m: ${JSON.stringify(hondo.dd.bocados)} ${JSON.stringify(hondo.dd.supera)}`);
  else ok(`depth 1.5 m: ${hondo.dd.bocados.txt} · beyond class: ${hondo.dd.supera.txt}`);
  await pag.click(`${B} .perforacion [data-v=quitar]`);
  await cuadro();
  const quitada = await leerTarjeta(pag, B);
  if (quitada.marca || !quitada.oculta || quitada.perf) falla(`remove: mark ${quitada.marca}, card hidden ${quitada.oculta}`); else ok('remove: mark and card gone');

  // ---------- 3: planta de agua plantada en la celda iluminada ----------
  const s = await vista(pag, 1, lit, 3);
  await pag.click(`${B} .ver-paleta`);
  await pag.click(`${B} .paleta [data-eq=planta_agua]`);
  await pag.mouse.click(s.x, s.y);
  await cuadro();
  const h = await pag.evaluate(() => {
    const p = window.__az.paneles[1], it = p.plantados.lista.find((q) => q.equipo === 'planta_agua'), c = p.el.querySelector('.hoja .vol-hoja');
    const v = {};
    c.querySelectorAll('[data-v]').forEach((d) => { v[d.dataset.v] = { valor: d.dataset.valor, min: d.dataset.min, max: d.dataset.max, txt: d.textContent.replace(/\s+/g, ' ').trim() }; });
    return { item: it && { fila: it.fila, col: it.col }, v };
  });
  const iL = h.item.fila * S.n + h.item.col, luz = Number.isFinite(L[iL]) ? L[iL] : null;
  const hp = hojaPlanta({ D, F, luz, luna: true, n_robots: SUPUESTOS.n_robots });
  igual(+h.v.regolito.valor, hp.planta.regolito_kg, 'plant regolith');
  igual(+h.v['regolito-rango'].min, hp.planta.intervalo_kg.min, 'plant regolith min');
  igual(+h.v['regolito-rango'].max, hp.planta.intervalo_kg.max, 'plant regolith max');
  igual(+h.v.horas.valor, hp.excavacion.central.horas, 'plant excavation hours');
  igual(+h.v['horas-rango'].min, hp.excavacion.min.horas, 'plant excavation hours min');
  igual(+h.v['horas-rango'].max, hp.excavacion.max.horas, 'plant excavation hours max');
  igual(+h.v.torres.valor, hp.energia.torres, 'plant towers');
  igual(h.v['torres-luz'].valor === undefined ? null : +h.v['torres-luz'].valor, hp.energia.torres_con_luz, 'plant towers with light');
  igual(+h.v.reactores.valor, hp.energia.reactores, 'plant reactors');
  igual(+h.v.o2.valor, hp.propelente.o2_kg, 'plant O2');
  igual(+h.v.h2.valor, hp.propelente.h2_kg, 'plant H2');
  igual(+h.v['o2-fuente'].valor, 10000, 'plant source O2');
  igual(h.v['aviso-o2'].txt, hp.o2.aviso, 'plant O2 warning');
  if (!/haul time: NOT MEASURED/.test(h.v.acarreo?.txt ?? '')) falla(`plant: haul not NOT MEASURED: ${h.v.acarreo?.txt}`);
  const cer = celdaEstableMasCercana(capaHielo(S, D.umbral.valor).mascara, S.n, S.m_por_px, h.item.fila, h.item.col);
  igual(+h.v['dist-hielo']?.valor, cer.dist_m, 'plant distance to the nearest stable-ice cell');
  ok(`water plant at ${h.item.fila},${h.item.col} (light ${luz}): regolith ${h.v.regolito.txt} (${h.v['regolito-rango'].txt}) · excavation ${h.v.horas.txt} (${h.v['horas-rango'].txt}) · towers ${h.v.torres.txt}, with light ${h.v['torres-luz'].txt} · reactors ${h.v.reactores.txt} · O2 ${h.v.o2.txt} vs source ${h.v['o2-fuente'].txt}`);
  ok(`water plant cell: "${h.v['hielo-celda'].txt}"`);
  ok(`O2 warning: "${h.v['aviso-o2'].txt}"`);
  await pag.$eval(`${B} .hoja .vol-hoja`, (el) => el.scrollIntoView({ block: 'start' }));
  await cuadro();
  await pag.screenshot({ path: join(SALIDA, '05-planta-agua-hoja.png') });
  await pag.locator(`${B} .hoja .vol-hoja`).screenshot({ path: join(SALIDA, '05b-planta-agua-bloque.png') });
  await pag.$eval(`${B} .hoja [data-v=aviso-o2]`, (el) => el.scrollIntoView({ block: 'end' }));
  await cuadro();
  await pag.screenshot({ path: join(SALIDA, '05c-planta-agua-o2.png') });
  await pag.close();

  // ---------- 4: Tierra (pareja haughton / shackleton) ----------
  pag = await abrir(`${baseUrl}/terreno/index.html?a=haughton&b=shackleton`);
  const H = leerTerreno('haughton');
  if (await pag.$(`${A} .mandos [data-capa="_hielo_estable"]`)) falla('Earth: the stable-ice layer button should not appear'); else ok('Earth: no stable-ice layer button (no maximum-temperature layer)');
  const xm = await perforar(pag, B, 1, frio, 3);
  const xt = await perforar(pag, A, 0, { f: Math.floor(H.n / 2), c: Math.floor(H.n / 2) }, 3);
  const rt = tarjetaPerforacion({ t: H, fila: xt.perf.fila, col: xt.perf.col, luna: false, D });
  for (const r of rt.lectura) {
    const tr = xt.tr[r.k];
    if (!tr) { falla(`Earth: no row ${r.k}`); continue; }
    igual(tr.estado, r.estado, `Earth ${r.k} state`);
    igual(tr.txt, r.texto, `Earth ${r.k} text`);
    const lm = tarjetaPerforacion({ t: S, fila: xm.perf.fila, col: xm.perf.col, luna: true, D }).lectura.find((y) => y.k === r.k);
    igual(tr.luna, lm.texto, `Earth table, Moon column ${r.k}`);
  }
  if (['temp_max', 'sombra', 'iluminacion', 'hielo'].some((k) => xt.tr[k]?.txt !== NO_MEDIBLE)) falla('Earth: some lunar reading is not "cannot be measured on this terrain"');
  ok(`Earth drill ${xt.perf.fila},${xt.perf.col}: ${Object.entries(xt.tr).map(([k, v]) => `${k}: Moon "${v.luna}" / Earth "${v.txt}"`).join(' · ')}`);
  await pag.screenshot({ path: join(SALIDA, '06-tierra-perforar.png') });
  const sA = await vista(pag, 0, { f: Math.floor(H.n / 2) + 20, c: Math.floor(H.n / 2) }, 3);
  await pag.click(`${A} .ver-paleta`);
  await pag.click(`${A} .paleta [data-eq=planta_agua]`);
  await pag.mouse.click(sA.x, sA.y);
  await cuadro();
  const ht = await pag.$eval(`${A} .hoja .vol-hoja`, (c) => c.textContent.replace(/\s+/g, ' ').trim()).catch(() => null);
  if (!ht?.includes(NO_MEDIBLE)) falla(`Earth water plant: ${ht}`); else ok(`Earth water plant: "${ht}"`);
  const cardTras = await pag.$eval(`${A} .perforacion`, (c) => c.hidden);
  if (!cardTras) falla('Earth: drill card should hide while a planted sheet is open');
  await pag.screenshot({ path: join(SALIDA, '07-tierra-planta.png') });
  await pag.close();
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA_VOLATILES: ${fallos.length} failure(s)` : 'CAPTURA_VOLATILES: ok');
process.exit(fallos.length ? 1 : 0);

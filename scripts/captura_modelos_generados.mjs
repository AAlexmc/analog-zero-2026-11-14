// Modelos generados en código: torre solar (esquemático) y celda verde (concepto) plantados en el visor, su vista de cerca y su modelo
// en el terreno; y la página de catálogo web/terreno/modelos.html entera. Guarda capturas 16-19.
// Uso: node scripts/captura_modelos_generados.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary' };

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
await mkdir(SALIDA, { recursive: true });

const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await nav.newContext({ viewport: { width: 1600, height: 900 } });
const pag = await ctx.newPage();
pag.on('console', (m) => { if (m.type() === 'error') falla(`console: ${m.text()}`); });
pag.on('pageerror', (e) => falla(`page error: ${e.message}`));
pag.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) falla(`network request outside the local server: ${r.url()}`); });

const lado = (i) => `.panel[data-lado=${i === 0 ? 'a' : 'b'}]`;
const buscarCelda = (i, lo, hi, usadas = []) => pag.evaluate(([i, lo, hi, usadas]) => {
  const e = window.__az.paneles[i].escena, n = e.n, vistos = [];
  for (let f = Math.round(n * 0.3); f < n * 0.85; f += 7) {
    for (let c = Math.round(n * 0.15); c < n * 0.6; c += 7) {
      const l = e.leer(f, c);
      if (!(l.pendiente >= lo && l.pendiente <= hi) || e.capas.agua?.[f * n + c] >= 1) continue;
      // Lejos de las ya usadas y en otra fila: el rótulo de una marca no debe tapar el pin de la vecina.
      if (usadas.some((u) => Math.hypot(u.f - f, u.c - c) < n * 0.08 || Math.abs(u.f - f) < n * 0.05)) continue;
      const s = e.aPantalla(e.mundoDePixel(f, c));
      const g = s?.dentro && document.elementFromPoint(s.x, s.y) === e.renderer.domElement && e.rayo(s.x, s.y);
      if (g && Math.round(g.fila) === f && Math.round(g.col) === c) vistos.push({ f, c, x: s.x, y: s.y, pend: l.pendiente });
    }
  }
  return vistos[Math.floor(vistos.length / 2)] ?? null;
}, [i, lo, hi, usadas]);
const plantar = async (i, eq, celda) => {
  await pag.click(`${lado(i)} .ver-paleta`);
  await pag.click(`${lado(i)} .paleta [data-eq=${eq}]`);
  await pag.mouse.click(celda.x, celda.y);
  await pag.waitForTimeout(150);
  return pag.evaluate(([i, eq]) => window.__az.paneles[i].plantados.lista.filter((x) => x.equipo === eq).at(-1)?.uid ?? null, [i, eq]);
};
const seleccionar = async (i, uid) => {
  const cerrar = await pag.$(`${lado(i)} .hoja [data-a=cerrar]`);
  if (cerrar && await cerrar.isVisible()) await cerrar.click();
  const pin = await pag.$eval(`.marca[data-uid="${uid}"] .pin`, (d) => { const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await pag.mouse.click(pin.x, pin.y);
  await pag.waitForTimeout(200);
  if (await pag.evaluate((i) => window.__az.paneles[i].sel, i) !== uid) falla(`could not select planted uid ${uid}`);
};
// Lo que el propio módulo dice del equipo, calculado en la página con el mismo catálogo.
const esperado = (id) => pag.evaluate(async (id) => {
  const g = await import('/terreno/modelos_generados.js');
  const f = await g.cargarFuentes();
  const r = g.construirEsquematico(f.equipos.find((q) => q.id === id), f.conceptos);
  return { titulo: r.titulo, linea: r.linea, medida: r.medida, aEscala: r.aEscala, clase: r.clase };
}, id);

try {
  await pag.goto(`${base}/terreno/index.html`);
  await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: 60000 });
  // Cada panel se planta por separado (un gemelo podría caer sobre otra marca); el equipo espejo tiene su guion.
  await pag.evaluate(() => { window.__az.espejo = false; });
  const info = await pag.evaluate(() => ({ ids: window.__az.paneles.map((p) => p.id), cuerpos: window.__az.paneles.map((p) => p.escena?.meta.cuerpo), errores: window.__az.errores }));
  console.log(`panels: ${info.ids.join(' | ')} (${info.cuerpos.join(' | ')})`);
  if (info.errores.length) falla(`panel errors: ${info.errores.join('; ')}`);
  const LUNA = info.cuerpos.indexOf('luna'), TIERRA = info.cuerpos.indexOf('tierra');
  if (LUNA < 0 || TIERRA < 0) throw new Error('need a Moon and an Earth panel');

  const casos = [[LUNA, 'torre_solar', 'esquematico'], [TIERRA, 'celda_verde', 'concepto'], [LUNA, 'flip', null]];
  const puestos = {}, usadas = { [LUNA]: [], [TIERRA]: [] };
  for (const [i, eq] of casos) {
    const c = await buscarCelda(i, 0, 8, usadas[i]) ?? await buscarCelda(i, 0, 40, usadas[i]);
    if (!c) { falla(`no visible cell to plant ${eq}`); continue; }
    usadas[i].push(c);
    const uid = await plantar(i, eq, c);
    if (!uid) falla(`${eq} not planted`); else { puestos[eq] = uid; ok(`${eq} planted on ${info.ids[i]} cell ${c.f},${c.c} (slope ${c.pend.toFixed(1)}°)`); }
  }
  await pag.evaluate(() => window.__az.paneles.forEach((p) => { p.escena.sucio = true; }));
  await pag.waitForTimeout(500);

  // Terreno: modelo generado presente con el tamaño del módulo; sin medida citada (FLIP) no hay modelo.
  for (const [i, eq, clase] of casos) {
    const x = await pag.evaluate(([i, uid]) => window.__az.paneles[i].modelos.instancias().find((q) => q.uid === uid) ?? null, [i, puestos[eq]]);
    const e = await esperado(eq);
    if (!clase) {
      if (x || e.aEscala) falla(`${eq}: no cited size, but a model is on the terrain (${JSON.stringify(x)})`); else ok(`${eq}: no cited size → nothing drawn on the terrain`);
      continue;
    }
    if (!x?.enEscena || x.generado !== clase || x.fichero) { falla(`${eq}: generated ${clase} model not in the terrain scene (${JSON.stringify(x)})`); continue; }
    const t = x.tam, medida = [t[0], t[2], t[1]];
    if (medida.some((v, k) => Math.abs(v - e.medida[k]) > 1e-3)) falla(`${eq}: size in the browser ${medida} ≠ ${e.medida}`);
    else ok(`${eq}: ${clase} in the terrain scene, ${x.mallas} meshes, ${medida.map((v) => v.toFixed(2)).join(' × ')} m, ×${x.factor}`);
  }
  const notas = await pag.evaluate(() => window.__az.paneles.map((p) => p.modelos.nota()));
  if (!/schematics: built from published dimensions/.test(notas[LUNA] ?? '')) falla(`Moon terrain note does not name the schematic (${notas[LUNA]})`); else ok(`Moon note: "${notas[LUNA]}"`);
  if (!/concepts: own design/.test(notas[TIERRA] ?? '')) falla(`Earth terrain note does not name the concept (${notas[TIERRA]})`); else ok(`Earth note: "${notas[TIERRA]}"`);
  await pag.screenshot({ path: join(SALIDA, '18-terreno-generados.png') });

  // Vista de cerca con su rótulo de clase.
  for (const [i, eq, clase, png] of [[LUNA, 'torre_solar', 'esquematico', '16-cerca-torre-solar'], [TIERRA, 'celda_verde', 'concepto', '17-cerca-celda-verde'], [LUNA, 'flip', null, '17-cerca-flip-sin-escala']]) {
    if (!puestos[eq]) continue;
    await seleccionar(i, puestos[eq]);
    const e = await esperado(eq);
    if (clase) await pag.waitForFunction(([i, clase]) => window.__az.paneles[i].cerca?.estado().generado === clase, [i, clase], { timeout: 20000 }).catch(() => {});
    const c = await pag.evaluate((i) => window.__az.paneles[i].cerca?.estado() ?? null, i);
    const pie = c?.pie ?? '';
    if (clase) {
      if (c?.generado !== clase || c.modelo) falla(`${eq} close-up: expected a generated ${clase} (${JSON.stringify(c)})`);
      if (!pie.includes(e.titulo) || !pie.includes(e.linea)) falla(`${eq} close-up label missing: ${pie}`); else ok(`${eq} close-up: "${e.titulo}" · "${e.linea}"`);
      if (!/not an official NASA model/.test(pie)) falla(`${eq} close-up should say it is not a NASA model`);
      const mu = await pag.evaluate((i) => window.__az.paneles[i].cerca.muestra(), i);
      if (!mu || mu.colores < 20) falla(`${eq} close-up canvas blank (${JSON.stringify(mu)})`); else ok(`${eq} close-up canvas ${mu.w}×${mu.h}, ${mu.colores} sampled colours`);
    } else if (!pie.includes('size not published — not drawn to scale') || c?.generado) falla(`${eq} close-up should say the size is not published: ${pie}`);
    else ok(`${eq} close-up: "${pie.slice(0, 110)}"`);
    await pag.locator(`${lado(i)} .hoja .cerca`).scrollIntoViewIfNeeded();
    await pag.waitForTimeout(150);
    await pag.locator(`${lado(i)} .hoja .cerca`).screenshot({ path: join(SALIDA, `${png}.png`) });
    await pag.screenshot({ path: join(SALIDA, `${png}-pantalla.png`) });
  }

  // Catálogo visual.
  const pag2 = await ctx.newPage();
  pag2.on('console', (m) => { if (m.type() === 'error') falla(`modelos.html console: ${m.text()}`); });
  pag2.on('pageerror', (e) => falla(`modelos.html page error: ${e.message}`));
  await pag2.goto(`${base}/terreno/modelos.html`);
  await pag2.waitForFunction(() => window.__modelos?.listo === true, null, { timeout: 90000 });
  const est = await pag2.evaluate(() => ({ errores: window.__modelos.errores, tarjetas: window.__modelos.tarjetas }));
  if (est.errores.length) falla(`modelos.html errors: ${est.errores.join('; ')}`);
  const porClase = {};
  for (const t of est.tarjetas) (porClase[t.clase] ??= []).push(`${t.id}${t.dibujado ? '' : ' (not drawn)'}`);
  for (const [k, v] of Object.entries(porClase)) ok(`${k}: ${v.join(', ')}`);
  if (!porClase['NASA official 3D model']?.length) falla('catalogue page shows no official model');
  if ((porClase['Analog Zero concept · own design, assumed dimensions'] ?? []).length !== 5) falla('catalogue page should show the 5 own concepts');
  const blancos = await pag2.evaluate(() => [...document.querySelectorAll('.tarjeta-modelo canvas')].filter((cv) => {
    const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, cols = new Set();
    for (let i = 0; i < px.length; i += 4 * 97) cols.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    return cols.size < 20;
  }).map((cv) => cv.closest('.tarjeta-modelo').dataset.id));
  if (blancos.length) falla(`blank model cards: ${blancos.join(', ')}`); else ok(`${est.tarjetas.filter((t) => t.dibujado).length} drawn cards, none blank`);
  for (const t of est.tarjetas) if (!t.dibujado && !/size not published — not drawn to scale|no schematic drawing|failed to load/.test(t.texto)) falla(`${t.id}: undrawn card does not say why: ${t.texto}`);
  await pag2.screenshot({ path: join(SALIDA, '19-modelos-catalogo.png'), fullPage: true });
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA_MODELOS_GENERADOS: ${fallos.length} failure(s)` : 'CAPTURA_MODELOS_GENERADOS: ok');
process.exit(fallos.length ? 1 : 0);

// Modelos 3D de NASA en el visor: planta equipo con modelo en la Luna y la Tierra, comprueba que el modelo está en la escena,
// la vista de cerca (pendiente medida, sustituto, sin modelo), mover/quitar/recargar y el fallo de carga; guarda capturas.
// Uso: node scripts/captura_modelos.mjs [--ejemplo]
import { createServer } from 'node:http';
import { readFile, mkdir, access } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
let SALIDA = join(RAIZ, 'capturas');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary' };

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
if (reales) { try { await access(join(WEB, 'data/terreno/index.json')); } catch { reales = false; } }
if (!reales) SALIDA = join(SALIDA, 'ejemplo');
console.log(reales ? 'data: web/data/terreno (real)' : 'data: SYNTHETIC (?ejemplo=1) → capturas/ejemplo/');
await mkdir(SALIDA, { recursive: true });
const modelos = JSON.parse(await readFile(join(WEB, 'data/modelos.json'), 'utf8')).modelos;

const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await nav.newContext({ viewport: { width: 1600, height: 900 } });
const pag = await ctx.newPage();
pag.on('console', (m) => { if (m.type() === 'error') falla(`console: ${m.text()}`); });
pag.on('pageerror', (e) => falla(`page error: ${e.message}`));
pag.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) falla(`network request outside the local server: ${r.url()}`); });

const lado = (i) => `.panel[data-lado=${i === 0 ? 'a' : 'b'}]`;
// Celda visible, sin agua ni retoque, con la pendiente en [lo, hi], lejos de las ya usadas.
const buscarCelda = (i, lo, hi, usadas = [], pg = pag) => pg.evaluate(([i, lo, hi, usadas]) => {
  const e = window.__az.paneles[i].escena, n = e.n, vistos = [];
  for (let f = Math.round(n * 0.3); f < n * 0.85; f += 7) {
    for (let c = Math.round(n * 0.15); c < n * 0.6; c += 7) {
      const l = e.leer(f, c);
      if (!(l.pendiente >= lo && l.pendiente <= hi) || e.capas.agua?.[f * n + c] >= 1) continue;
      if (usadas.some((u) => Math.hypot(u.f - f, u.c - c) < n * 0.08)) continue;
      const s = e.aPantalla(e.mundoDePixel(f, c));
      const g = s?.dentro && document.elementFromPoint(s.x, s.y) === e.renderer.domElement && e.rayo(s.x, s.y);
      if (g && Math.round(g.fila) === f && Math.round(g.col) === c) vistos.push({ f, c, x: s.x, y: s.y, pend: l.pendiente });
    }
  }
  return vistos[Math.floor(vistos.length / 2)] ?? null;
}, [i, lo, hi, usadas]);
const plantar = async (i, eq, celda, pg = pag) => {
  await pg.click(`${lado(i)} .ver-paleta`);
  await pg.click(`${lado(i)} .paleta [data-eq=${eq}]`);
  await pg.mouse.click(celda.x, celda.y);
  await pg.waitForTimeout(150);
  return pg.evaluate(([i, eq]) => window.__az.paneles[i].plantados.lista.filter((x) => x.equipo === eq).at(-1)?.uid ?? null, [i, eq]);
};
const esperarModelos = (i, n) => pag.waitForFunction(([i, n]) => {
  const xs = window.__az.paneles[i].modelos.instancias();
  return xs.length >= n && xs.every((x) => x.enEscena || x.estado === 'error');
}, [i, n], { timeout: 90000 });
const cerca = (i, pg = pag) => pg.evaluate((i) => window.__az.paneles[i].cerca?.estado() ?? null, i);
const seleccionar = async (i, uid) => {
  const cerrar = await pag.$(`${lado(i)} .hoja [data-a=cerrar]`);
  if (cerrar && await cerrar.isVisible()) await cerrar.click();
  const pin = await pag.$eval(`.marca[data-uid="${uid}"] .pin`, (d) => { const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await pag.mouse.click(pin.x, pin.y);
  await pag.waitForTimeout(150);
  const sel = await pag.evaluate((i) => window.__az.paneles[i].sel, i);
  if (sel !== uid) falla(`could not select planted uid ${uid} by clicking its marker (selected ${sel})`);
};
// Píxeles del lienzo del terreno que cambian al ocultar los modelos, en una caja alrededor de la posición plantada.
const pixelesModelo = (i, uid) => pag.evaluate(([i, uid]) => {
  const p = window.__az.paneles[i], e = p.escena, it = p.plantados.buscar(uid);
  const s = e.aPantalla(e.mundoDePixel(it.fila, it.col));
  if (!s?.dentro) return { fuera: true };
  const gl = e.renderer.getContext(), r = e.renderer.domElement.getBoundingClientRect();
  const kx = gl.drawingBufferWidth / r.width, ky = gl.drawingBufferHeight / r.height, L = 40;
  const x0 = Math.max(0, Math.round((s.x - r.left) * kx) - L), y0 = Math.max(0, Math.round(gl.drawingBufferHeight - (s.y - r.top) * ky) - L);
  const leer = () => { e.dibujar(true); const px = new Uint8Array(4 * 2 * L * 2 * L); gl.readPixels(x0, y0, 2 * L, 2 * L, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const con = leer();
  p.modelos.grupo.visible = false;
  const sin = leer();
  p.modelos.grupo.visible = true;
  e.dibujar(true);
  let k = 0;
  for (let j = 0; j < con.length; j += 4) if (Math.abs(con[j] - sin[j]) + Math.abs(con[j + 1] - sin[j + 1]) + Math.abs(con[j + 2] - sin[j + 2]) > 30) k++;
  return { distintos: k };
}, [i, uid]);

try {
  await pag.goto(`${base}/terreno/index.html${reales ? '' : '?ejemplo=1'}`);
  await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: 60000 });
  const info = await pag.evaluate(() => ({ ids: window.__az.paneles.map((p) => p.id), cuerpos: window.__az.paneles.map((p) => p.escena?.meta.cuerpo), errores: window.__az.errores }));
  console.log(`panels: ${info.ids.join(' | ')} (${info.cuerpos.join(' | ')})`);
  if (info.errores.length) falla(`panel errors: ${info.errores.join('; ')}`);
  const LUNA = info.cuerpos.indexOf('luna'), TIERRA = info.cuerpos.indexOf('tierra');
  if (LUNA < 0 || TIERRA < 0) throw new Error('need a Moon and an Earth panel');

  // Plantar IPEx (RASSOR) y LTV (SEV) en los dos paneles, y VIPER (sin modelo) en la Luna.
  const puestos = { [LUNA]: {}, [TIERRA]: {} }, usadas = { [LUNA]: [], [TIERRA]: [] };
  for (const i of [LUNA, TIERRA]) {
    for (const [eq, lo, hi] of [['ipex', 5, 14], ['ltv', 2, 12], ...(i === LUNA ? [['viper', 0, 30]] : [['celda_verde', 0, 30]])]) {
      const c = await buscarCelda(i, lo, hi, usadas[i]) ?? await buscarCelda(i, 0, 40, usadas[i]);
      if (!c) { falla(`no visible cell to plant ${eq} on panel ${i}`); continue; }
      usadas[i].push(c);
      const uid = await plantar(i, eq, c);
      if (!uid) falla(`${eq} not planted on panel ${i}`); else { puestos[i][eq] = { uid, ...c }; ok(`${eq} planted on ${info.ids[i]} cell ${c.f},${c.c} (slope ${c.pend.toFixed(1)}°)`); }
    }
  }
  for (const i of [LUNA, TIERRA]) await esperarModelos(i, 2);
  for (const i of [LUNA, TIERRA]) {
    const xs = await pag.evaluate((i) => window.__az.paneles[i].modelos.instancias(), i);
    for (const x of xs) {
      if (!x.enEscena || x.mallas < 1) falla(`${info.ids[i]} ${x.equipo}: 3D model not in the terrain scene (${JSON.stringify(x)})`);
      else ok(`${info.ids[i]} ${x.equipo}: ${x.fichero ?? `${x.generado} drawn in code`} in the scene, ${x.mallas} meshes, ×${x.factor}`);
      if (!x.fichero) continue;
      const m = modelos.find((q) => q.fichero === x.fichero);
      const [tx, ty, tz] = x.tam ?? [];
      const medida = [Math.max(tx, tz), Math.min(tx, tz), ty];
      if (!m || medida.some((v, k) => !(Math.abs(v - m.medida_m[k]) <= 0.01))) falla(`${x.fichero}: size in the browser ${medida.map((v) => v?.toFixed(3))} ≠ medida_m ${m?.medida_m}`);
      else ok(`${x.fichero}: size in the browser ${medida.map((v) => v.toFixed(3)).join(' × ')} m = medida_m`);
    }
    if (xs.some((x) => (x.equipo === 'viper' || x.equipo === 'celda_verde') && x.fichero)) falla('equipment without an official model got a NASA model on the terrain');
    const nota = await pag.evaluate((i) => window.__az.paneles[i].modelos.nota(), i);
    if (!/^3D models ×\d+/.test(nota ?? '')) falla(`${info.ids[i]}: terrain does not state the enlargement factor (${nota})`); else ok(`${info.ids[i]} note: "${nota}"`);
    for (const eq of ['ipex', 'ltv']) {
      if (!puestos[i][eq]) continue;
      const px = await pixelesModelo(i, puestos[i][eq].uid);
      if (!(px.distintos > 10)) falla(`${info.ids[i]} ${eq}: model not visible on the terrain canvas (${JSON.stringify(px)})`); else ok(`${info.ids[i]} ${eq}: ${px.distintos} canvas pixels change when the models are hidden`);
    }
  }
  await pag.waitForTimeout(300);
  await pag.screenshot({ path: join(SALIDA, '10-modelos-terreno.png') });

  // Vista de cerca: IPEx en la Luna y LTV en la Tierra.
  for (const [i, eq, png, sust] of [[LUNA, 'ipex', '11-cerca-luna-ipex.png', /3D model shown: NASA RASSOR excavator — stand-in, not IPEx/], [TIERRA, 'ltv', '12-cerca-tierra-ltv.png', /3D model shown: NASA Space Exploration Vehicle \(SEV\) — stand-in, not Lunar Terrain Vehicle/]]) {
    const pu = puestos[i][eq];
    if (!pu) continue;
    await seleccionar(i, pu.uid);
    await pag.waitForFunction((i) => window.__az.paneles[i].cerca?.estado().estado === 'ok', i, { timeout: 60000 }).catch(() => {});
    const c = await cerca(i);
    if (c?.estado !== 'ok' || c.aviso) falla(`${eq} close-up: model not loaded (${JSON.stringify(c)})`);
    if (!sust.test(c?.pie ?? '')) falla(`${eq} close-up: stand-in text missing: ${c?.pie}`); else ok(`${eq} close-up: "${c.pie.match(sust)[0]}"`);
    const aqui = await pag.$eval(`${lado(i)} .hoja .req[data-var=pendiente_deg] .aqui`, (d) => d.textContent.trim()).catch(() => null);
    const enCerca = (c?.pie ?? '').match(/on the ([\d.]+°) slope measured here/)?.[1] ?? null;
    if (!aqui || aqui !== enCerca) falla(`${eq} close-up slope ${enCerca} ≠ sheet slope ${aqui}`);
    else if (Math.abs(c.inclinacion_deg - parseFloat(aqui)) > 0.05) falla(`${eq} close-up plane tilted ${c.inclinacion_deg}° but the sheet says ${aqui}`);
    else ok(`${eq} close-up plane tilted ${c.inclinacion_deg.toFixed(2)}° = sheet slope ${aqui}`);
    const mu = await pag.evaluate((i) => window.__az.paneles[i].cerca.muestra(), i);
    if (!mu || mu.colores < 20) falla(`${eq} close-up canvas blank (${JSON.stringify(mu)})`); else ok(`${eq} close-up canvas ${mu.w}×${mu.h}, ${mu.colores} sampled colours`);
    // Órbita con el ratón.
    const caja = await pag.$eval(`${lado(i)} .hoja .cerca canvas`, (cv) => { const r = cv.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const antes = c.camara;
    await pag.mouse.move(caja.x, caja.y);
    await pag.mouse.down();
    await pag.mouse.move(caja.x + 60, caja.y + 10, { steps: 6 });
    await pag.mouse.up();
    await pag.waitForTimeout(150);
    await pag.screenshot({ path: join(SALIDA, png) });
    await pag.locator(`${lado(i)} .hoja`).screenshot({ path: join(SALIDA, png.replace('.png', '-hoja.png')) });
    const despues = (await cerca(i))?.camara;
    if (!antes || !despues || Math.hypot(...antes.map((v, k) => v - despues[k])) < 0.1) falla(`${eq} close-up: mouse drag did not orbit the camera (${antes} → ${despues})`); else ok(`${eq} close-up: mouse drag orbits the camera`);
  }

  // Sin modelo oficial: VIPER (Luna) y celda verde (Tierra) → esquemático o concepto generado, o «no official 3D model loaded».
  for (const [i, eq] of [[LUNA, 'viper'], [TIERRA, 'celda_verde']]) {
    const pu = puestos[i][eq];
    if (!pu) continue;
    await seleccionar(i, pu.uid);
    await pag.waitForTimeout(300);
    const c = await cerca(i);
    const svg = await pag.$(`${lado(i)} .hoja .cerca svg.huella-cerca`);
    if (!/no official 3D model loaded|schematic · built from published dimensions|Analog Zero concept · own design, assumed dimensions/.test(c?.pie ?? '') || c.modelo) falla(`${eq} close-up should show no NASA model: ${JSON.stringify(c)}`); else ok(`${eq} close-up: "${c.pie.slice(0, 90)}"`);
    if (eq === 'celda_verde' && !svg && !c.generado) falla('green cell close-up should draw the hexagon footprint or its concept model');
    await pag.locator(`${lado(i)} .hoja`).screenshot({ path: join(SALIDA, `14-sin-modelo-${eq}.png`) });
  }

  // Terreno de cerca: la cámara se acerca al LTV de la Luna y el factor baja.
  const pu = puestos[LUNA].ltv;
  if (pu) {
    if (await pag.isVisible(`${lado(LUNA)} .hoja [data-a=cerrar]`)) await pag.click(`${lado(LUNA)} .hoja [data-a=cerrar]`);
    await pag.click(`${lado(LUNA)} .ampliar`);
    await pag.waitForTimeout(300);
    const f = await pag.evaluate(([i, uid]) => new Promise((ok) => {
      const p = window.__az.paneles[i], e = p.escena, it = p.plantados.buscar(uid), w = e.mundoDePixel(it.fila, it.col);
      e.controles.target.copy(w);
      e.camara.position.set(w.x + 0.35, w.y + 0.3, w.z + 0.45);
      e.controles.update();
      e.sucio = true;
      setTimeout(() => ok(p.modelos.instancias().find((x) => x.uid === uid)), 400);
    }), [LUNA, pu.uid]);
    const nota = await pag.evaluate((i) => window.__az.paneles[i].modelos.nota(), LUNA);
    if (!(f?.factor < 200) || !nota.includes(`×${f.factor}`)) falla(`zoomed-in factor should drop and be written on screen (${f?.factor}, ${nota})`); else ok(`zoomed in on the terrain: ×${f.factor} ("${nota}")`);
    await pag.screenshot({ path: join(SALIDA, '13-terreno-cerca.png') });

    // Mover: el modelo sigue al marcador.
    const mov = await pag.evaluate(([i, uid]) => new Promise((ok) => {
      const p = window.__az.paneles[i], e = p.escena, it = p.plantados.buscar(uid);
      const s = e.aPantalla(e.mundoDePixel(it.fila, it.col + 3));
      ok({ s, antes: [it.fila, it.col] });
    }), [LUNA, pu.uid]);
    const pin = await pag.$eval(`.marca[data-uid="${pu.uid}"] .pin`, (d) => { const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await pag.mouse.move(pin.x, pin.y);
    await pag.mouse.down();
    await pag.mouse.move(mov.s.x, mov.s.y, { steps: 8 });
    await pag.mouse.up();
    await pag.waitForTimeout(300);
    const tras = await pag.evaluate(([i, uid]) => { const p = window.__az.paneles[i], e = p.escena, it = p.plantados.buscar(uid), w = e.mundoDePixel(it.fila, it.col); return { celda: [it.fila, it.col], w: [w.x, w.z], m: p.modelos.instancias().find((x) => x.uid === uid) }; }, [LUNA, pu.uid]);
    const sigue = tras.m?.pos && Math.hypot(tras.m.pos[0] - tras.w[0], tras.m.pos[2] - tras.w[1]) < 1e-9;
    if (tras.celda.join() === mov.antes.join() || !sigue) falla(`moving the marker should move the model (${JSON.stringify({ antes: mov.antes, tras })})`); else ok(`moved ${mov.antes} → ${tras.celda}; model follows`);
    await pag.click(`${lado(LUNA)} .ampliar`);
    await pag.waitForTimeout(300);
  }

  // Recargar: lo plantado vuelve con sus modelos.
  await pag.waitForTimeout(600);
  const antes = await pag.evaluate(() => window.__az.paneles.map((p) => p.modelos.instancias().filter((x) => x.enEscena).length));
  await pag.reload();
  await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: 60000 });
  await pag.evaluate(() => window.__az.paneles.forEach((p) => { p.escena.sucio = true; }));
  for (const i of [LUNA, TIERRA]) await esperarModelos(i, 2);
  const recarga = await pag.evaluate(() => window.__az.paneles.map((p) => p.modelos.instancias().filter((x) => x.enEscena).length));
  if (recarga[LUNA] !== antes[LUNA] || recarga[TIERRA] !== antes[TIERRA] || antes[LUNA] < 2 || antes[TIERRA] < 2) falla(`after reload, models in scene ${recarga} (before ${antes})`); else ok(`after reload, models back in both scenes (${recarga.join(' + ')})`);

  // Quitar: el modelo sale de la escena.
  const quitar = await pag.evaluate((i) => window.__az.paneles[i].plantados.lista.find((x) => x.equipo === 'ipex')?.uid, LUNA);
  await seleccionar(LUNA, quitar);
  await pag.click(`${lado(LUNA)} .hoja [data-a=quitar]`);
  await pag.waitForTimeout(300);
  const tras = await pag.evaluate(([i, uid]) => ({ inst: window.__az.paneles[i].modelos.instancias().map((x) => x.uid), hijos: window.__az.paneles[i].modelos.grupo.children.length }), [LUNA, quitar]);
  if (tras.inst.includes(quitar) || tras.hijos !== antes[LUNA] - 1) falla(`removing IPEx should remove its model (${JSON.stringify(tras)})`); else ok('removing IPEx removes its model from the scene');

  // Fallo de carga visible y sin modelo de sustitución.
  const ctx2 = await nav.newContext({ viewport: { width: 1600, height: 900 } });
  const pag2 = await ctx2.newPage();
  pag2.on('pageerror', (e) => falla(`page error (404 model): ${e.message}`));
  await pag2.route('**/data/modelos/sev.glb', (r) => r.fulfill({ status: 404, body: '' }));
  await pag2.goto(`${base}/terreno/index.html${reales ? '' : '?ejemplo=1'}`);
  await pag2.waitForFunction(() => window.__az?.listo === true, null, { timeout: 60000 });
  const c2 = await buscarCelda(LUNA, 0, 40, [], pag2);
  if (!c2) throw new Error('no visible Moon cell for the 404 check');
  await plantar(LUNA, 'ltv', c2, pag2);
  await pag2.waitForFunction((i) => /failed to load/.test(window.__az.paneles[i].modelos.nota() ?? ''), LUNA, { timeout: 30000 }).catch(() => {});
  await pag2.waitForFunction((i) => window.__az.paneles[i].cerca?.estado().estado === 'error', LUNA, { timeout: 30000 }).catch(() => {});
  const cErr = await cerca(LUNA, pag2);
  if (!/^3D model failed to load/.test(cErr?.aviso ?? '')) falla(`a 404 model should be reported in the close-up (${JSON.stringify(cErr)})`); else ok(`404 model in the close-up: "${cErr.aviso}"`);
  const err = await pag2.evaluate((i) => ({ nota: window.__az.paneles[i].modelos.nota(), inst: window.__az.paneles[i].modelos.instancias(), hijos: window.__az.paneles[i].modelos.grupo.children.length }), LUNA);
  if (!/3D model failed to load: sev\.glb/.test(err.nota ?? '') || err.hijos !== 0) falla(`a 404 model should be reported on the terrain and leave nothing in its place (${JSON.stringify(err)})`);
  else ok(`404 model: "${err.nota}", nothing drawn in its place`);
  await pag2.screenshot({ path: join(SALIDA, '15-fallo-carga.png') });
  await ctx2.close();
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA_MODELOS: ${fallos.length} failure(s)` : 'CAPTURA_MODELOS: ok');
process.exit(fallos.length ? 1 : 0);

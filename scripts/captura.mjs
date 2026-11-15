// Abre el visor de terreno en Chromium con GPU, comprueba que pinta y que el retoque funciona, y guarda capturas.
// Uso: node scripts/captura.mjs [--ejemplo]   (sin datos reales en web/data/terreno usa ?ejemplo=1)
import { createServer } from 'node:http';
import { readFile, mkdir, access } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
let SALIDA = join(RAIZ, 'capturas');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

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

const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pag = await nav.newPage({ viewport: { width: 1600, height: 900 } });
pag.on('console', (m) => { if (m.type() === 'error') falla(`console: ${m.text()}`); });
pag.on('pageerror', (e) => falla(`page error: ${e.message}`));

try {
  await pag.goto(`${base}/terreno/index.html${reales ? '' : '?ejemplo=1'}`);
  await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: 60000 });
  // Aquí cada panel se planta por separado; el equipo espejo tiene su guion (captura_espejo.mjs).
  await pag.evaluate(() => { window.__az.espejo = false; });
  const info = await pag.evaluate(() => ({
    errores: window.__az.errores,
    ids: window.__az.paneles.map((p) => p.id),
    gpu: (() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl?.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })(),
  }));
  console.log(`renderer: ${info.gpu}`);
  console.log(`panels: ${info.ids.join(' | ')}`);
  if (info.errores.length) falla(`panel errors: ${info.errores.join('; ')}`);

  const lienzos = await pag.evaluate(() => window.__az.paneles.map((p) => p.escena?.muestraLienzo() ?? null));
  lienzos.forEach((l, i) => { if (!l || l.colores < 20) falla(`panel ${i} canvas blank (${l?.colores ?? 'no scene'} colours)`); else ok(`panel ${i} canvas ${l.w}×${l.h}, ${l.colores} sampled colours`); });

  await pag.waitForTimeout(300);
  await pag.screenshot({ path: join(SALIDA, '01-dos-paneles.png') });
  const fps2 = await pag.evaluate(() => window.__az.medirFps(3000));
  console.log(`fps two panels: ${fps2.toFixed(1)}`);

  // Ampliar el panel de la Luna (b).
  await pag.click('.panel[data-lado=b] .ampliar');
  await pag.waitForTimeout(400);
  const url = new URL(pag.url());
  if (url.searchParams.get('solo') !== info.ids[1]) falla(`URL has no solo=${info.ids[1]}: ${pag.url()}`); else ok('expanded state in URL');
  const l2 = await pag.evaluate(() => window.__az.paneles[1].escena.muestraLienzo());
  if (l2.colores < 20) falla('expanded canvas blank');
  await pag.screenshot({ path: join(SALIDA, '02-ampliado.png') });
  const fps1 = await pag.evaluate(() => window.__az.medirFps(2000));
  console.log(`fps expanded: ${fps1.toFixed(1)}`);

  // Trazo de allanar con el ratón.
  await pag.click('.panel[data-lado=b] [data-herr=allanar]');
  await pag.$eval('.panel[data-lado=b] [data-i=int]', (i) => { i.value = 100; i.dispatchEvent(new Event('input')); });
  await pag.$eval('.panel[data-lado=b] [data-i=radio]', (i) => { i.value = 420; i.dispatchEvent(new Event('input')); });
  const trazo = await pag.evaluate(() => {
    const e = window.__az.paneles[1].escena, n = e.n;
    // Tramo visible desde la cámara, iluminado y de poco desnivel, para que el trazo se vea como una explanada.
    const L = Math.round(n * 0.12), cands = [];
    for (let f = Math.round(n * 0.55); f < n * 0.92; f += Math.round(n / 64)) {
      for (let c = Math.round(n * 0.1); c < n * 0.78; c += Math.round(n / 64)) {
        let luz = 0, lo = Infinity, hi = -Infinity;
        for (let k = 0; k < L; k++) { const i = f * n + c + k; luz += e.datosSombra[i] / 255; lo = Math.min(lo, e.base[i]); hi = Math.max(hi, e.base[i]); }
        if (Number.isFinite(hi - lo)) cands.push({ f, c0: c, c1: c + L, nota: hi - lo - 400 * luz / L });
      }
    }
    cands.sort((x, y) => x.nota - y.nota);
    const visible = ({ f, c0, c1 }) => [c0, (c0 + c1) / 2, c1].every((c) => {
      const s = e.aPantalla(e.mundoDePixel(f, c));
      const g = s?.dentro && e.rayo(s.x, s.y);
      return g && Math.hypot(g.fila - f, g.col - c) < 2;
    });
    const mejor = cands.find(visible) ?? cands[0];
    const { f, c0, c1 } = mejor;
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const c = c0 + ((c1 - c0) * k) / 12;
      const s = e.aPantalla(e.mundoDePixel(f, c));
      pts.push([s.x, s.y]);
    }
    const idx = [];
    for (let c = c0; c <= c1; c += 4) idx.push(f * n + c);
    return { pts, idx, antes: idx.map((i) => e.actual[i]), base: idx.map((i) => e.base[i]) };
  });
  await pag.mouse.move(...trazo.pts[0]);
  await pag.mouse.down();
  for (const p of trazo.pts.slice(1)) await pag.mouse.move(p[0], p[1], { steps: 4 });
  await pag.mouse.up();
  await pag.waitForTimeout(300);
  const tras = await pag.evaluate((idx) => {
    const p = window.__az.paneles[1], e = p.escena;
    const celdas = e.delta.reduce((a, d) => a + (d !== 0 ? 1 : 0), 0);
    return { alt: idx.map((i) => e.actual[i]), base: idx.map((i) => e.base[i]), celdas, texto: p.el.querySelector('.retoque dl').textContent };
  }, trazo.idx);
  const cambiadas = tras.alt.filter((h, i) => Math.abs(h - trazo.antes[i]) > 1e-3).length;
  if (tras.celdas === 0 || cambiadas === 0) falla(`flatten stroke changed nothing (cells ${tras.celdas})`); else ok(`flatten stroke: ${tras.celdas} cells, ${cambiadas}/${trazo.idx.length} probe cells changed`);
  if (tras.base.some((h, i) => !Object.is(h, trazo.base[i]))) falla('original heights were modified');
  console.log(`stats: ${tras.texto.replace(/\s+/g, ' ').trim()}`);
  await pag.click('.panel[data-lado=b] [data-modo=pendiente]');
  await pag.waitForTimeout(200);
  await pag.screenshot({ path: join(SALIDA, '03-retocado.png') });
  await pag.click('.panel[data-lado=b] [data-modo=relieve]');

  await pag.keyboard.press('Control+z');
  await pag.waitForTimeout(200);
  const des = await pag.evaluate((idx) => { const e = window.__az.paneles[1].escena; return { alt: idx.map((i) => e.actual[i]), celdas: e.delta.reduce((a, d) => a + (d !== 0 ? 1 : 0), 0) }; }, trazo.idx);
  if (des.celdas !== 0 || des.alt.some((h, i) => !Object.is(h, trazo.antes[i]))) falla(`undo did not restore heights (cells ${des.celdas})`); else ok('Ctrl+Z restores original heights');
  await pag.keyboard.press('Control+Shift+z');
  await pag.waitForTimeout(200);
  const re = await pag.evaluate((idx) => { const e = window.__az.paneles[1].escena; return idx.map((i) => e.actual[i]); }, trazo.idx);
  if (re.some((h, i) => !Object.is(h, tras.alt[i]))) falla('redo did not reapply the stroke'); else ok('Ctrl+Shift+Z reapplies the stroke');

  // Capa superpuesta, si hay.
  const capa = await pag.$('.panel.ampliado [data-capa]:not([data-capa=""])');
  if (capa) {
    await capa.click();
    await pag.waitForTimeout(300);
    await pag.screenshot({ path: join(SALIDA, '04-capa.png') });
    ok(`layer shown: ${await capa.textContent()}`);
  } else console.log('no overlay layers in this terrain: 04-capa.png not taken');

  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(200);
  const vuelta = await pag.evaluate(() => ({ amp: document.body.dataset.ampliado ?? null, solo: new URL(location.href).searchParams.get('solo') }));
  if (vuelta.amp || vuelta.solo) falla('Esc did not return to the pair'); else ok('Esc returns to two panels');

  // ---------- Equipo plantado ----------
  // Celda visible, sin retocar, con la pendiente en [lo, hi]; devuelve su posición en pantalla.
  const buscarCelda = (lado, lo, hi) => pag.evaluate(([i, lo, hi]) => {
    const p = window.__az.paneles[i], e = p.escena, n = e.n;
    const vistos = [];
    for (let f = Math.round(n * 0.3); f < n * 0.85; f += 7) {
      for (let c = Math.round(n * 0.15); c < n * 0.6; c += 7) {
        const l = e.leer(f, c);
        if (!(l.pendiente >= lo && l.pendiente <= hi) || e.capas.agua?.[f * n + c] >= 1) continue;
        let tocada = false;
        for (let df = -12; df <= 12 && !tocada; df++) for (let dc = -12; dc <= 12; dc++) if (e.delta[(f + df) * n + c + dc] !== 0) { tocada = true; break; }
        if (tocada) continue;
        const s = e.aPantalla(e.mundoDePixel(f, c));
        const g = s?.dentro && document.elementFromPoint(s.x, s.y) === e.renderer.domElement && e.rayo(s.x, s.y);
        if (g && Math.round(g.fila) === f && Math.round(g.col) === c) vistos.push({ f, c, x: s.x, y: s.y, pend: l.pendiente });
      }
    }
    return vistos[Math.floor(vistos.length / 2)] ?? null;
  }, [lado, lo, hi]);
  const plantar = async (lado, eq, celda) => {
    const sel = `.panel[data-lado=${lado === 0 ? 'a' : 'b'}]`;
    await pag.click(`${sel} .ver-paleta`);
    await pag.click(`${sel} .paleta [data-eq=${eq}]`);
    await pag.mouse.click(celda.x, celda.y);
    await pag.waitForTimeout(150);
    return pag.evaluate(([i, eq]) => window.__az.paneles[i].plantados.lista.filter((x) => x.equipo === eq).map((x) => ({ uid: x.uid, fila: x.fila, col: x.col })), [lado, eq]);
  };
  const filaHoja = (lado, variable) => pag.evaluate(([i, v]) => {
    const r = window.__az.paneles[i].el.querySelector(`.hoja .req[data-var=${v}]`);
    return r ? { clase: r.className, texto: r.textContent.replace(/\s+/g, ' ').trim() } : null;
  }, [lado, variable]);

  const terrenoA = await pag.evaluate(() => window.__az.paneles[0].escena.meta.cuerpo);
  const ladera = await buscarCelda(1, 18, 28);
  const llano = await buscarCelda(0, 0, 4);
  if (!ladera || !llano) falla(`no visible cell to plant on (moon slope ${!!ladera}, earth flat ${!!llano})`);
  else {
    const enB = await plantar(1, 'ltv', ladera), enA = await plantar(0, 'ltv', llano);
    if (enA.length !== 1 || enB.length !== 1) falla(`LTV not planted in both panels (${enA.length}, ${enB.length})`);
    else ok(`LTV planted on ${terrenoA} cell ${enA[0].fila},${enA[0].col} and on the Moon cell ${enB[0].fila},${enB[0].col} (slope ${ladera.pend.toFixed(1)}°)`);
    await pag.click(`.marca[data-uid="${enB[0].uid}"] .pin`);
    await pag.waitForTimeout(150);
    const comp = await pag.evaluate(() => [...document.querySelectorAll('.panel[data-lado=b] .hoja .comp tbody tr')].map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()));
    if (!comp.length) falla('Moon/Earth comparison missing in the LTV sheet'); else ok(`comparison: ${comp.join(' | ')}`);
    if (!comp.some((t) => /under-tested here/.test(t))) falla('Earth flat cell vs Moon slope should read "under-tested here"');
    const noEns = await pag.$eval('.panel[data-lado=b] .hoja', (h) => h.textContent);
    if (!/No public source states what cannot be tested on Earth for this system\./.test(noEns)) falla('LTV sheet should state that no source lists what cannot be tested on Earth');
    const CITA = '.panel[data-lado=b] .hoja .req[data-var=pendiente_deg] .src details.cita';
    await pag.click(`${CITA} .ver-cita`);
    const citaAbierta = (await pag.$eval(CITA, (d) => d.open)) && (await pag.isVisible(`${CITA} q`));
    if (!citaAbierta) falla('a mouse click on QUOTE should open the literal quotation of the limit'); else ok(`quote opens by mouse: ${(await pag.textContent(`${CITA} q`)).slice(0, 60)}`);
    await pag.waitForTimeout(200);
    await pag.screenshot({ path: join(SALIDA, '05-plantado.png') });

    // Huella a escala real al acercarse.
    const huella = await pag.evaluate((uid) => new Promise((ok) => {
      const p = window.__az.paneles[1], e = p.escena, it = p.plantados.buscar(uid);
      const w = e.mundoDePixel(it.fila, it.col);
      e.controles.target.copy(w);
      e.camara.position.set(w.x, w.y + 0.02, w.z + 0.02);
      e.controles.update();
      e.sucio = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const poli = p.marcas.get(uid).poli;
        const r = poli.getBoundingClientRect();
        ok({ visible: poli.style.display !== 'none', w: r.width, h: r.height });
      }));
    }), enB[0].uid);
    if (!huella.visible || huella.w < 10) falla(`LTV footprint not drawn when zoomed in (${JSON.stringify(huella)})`); else ok(`LTV footprint drawn to scale when zoomed in (${huella.w.toFixed(0)}×${huella.h.toFixed(0)} px)`);
    await pag.evaluate(() => { const e = window.__az.paneles[1].escena; const D = e.ladoKm * 1.45; e.controles.target.set(0, 0, 0); e.camara.position.set(0, D * Math.sin(55 * Math.PI / 180), D * Math.cos(55 * Math.PI / 180)); e.controles.update(); e.sucio = true; });
  }

  // Punto 4: torre solar (≤ 10°) en una ladera → BREAKS; allanar ahí → OK; deshacer → BREAKS.
  await pag.click('.panel[data-lado=b] .ampliar');
  await pag.waitForTimeout(400);
  const ladera2 = await buscarCelda(1, 16, 26);
  if (!ladera2) falla('no visible slope cell for the solar tower');
  else {
    const torre = await plantar(1, 'torre_solar', ladera2);
    const antes = await filaHoja(1, 'pendiente_deg');
    if (!/\brompe\b/.test(antes?.clase ?? '')) falla(`solar tower on a ${ladera2.pend.toFixed(1)}° slope should BREAK: ${antes?.texto}`); else ok(`solar tower on slope: ${antes.texto.slice(0, 90)}`);
    await pag.waitForTimeout(200);
    await pag.screenshot({ path: join(SALIDA, '06-hoja-rompe.png') });

    await pag.click('.panel[data-lado=b] [data-herr=allanar]');
    await pag.$eval('.panel[data-lado=b] [data-i=int]', (i) => { i.value = 100; i.dispatchEvent(new Event('input')); });
    await pag.$eval('.panel[data-lado=b] [data-i=radio]', (i) => { i.value = 380; i.dispatchEvent(new Event('input')); });
    const pos = await pag.evaluate((uid) => { const p = window.__az.paneles[1], e = p.escena, it = p.plantados.buscar(uid); return e.aPantalla(e.mundoDePixel(it.fila, it.col)); }, torre[0].uid);
    let trazos = 0;
    for (let k = 0; k < 3; k++) {
      if (k && /\bok\b/.test((await filaHoja(1, 'pendiente_deg'))?.clase ?? '')) break;
      trazos++;
      await pag.mouse.move(pos.x, pos.y);
      await pag.mouse.down();
      for (let j = 0; j < 6; j++) {
        await pag.mouse.move(pos.x + 10, pos.y, { steps: 3 });
        await pag.mouse.move(pos.x - 10, pos.y + 4, { steps: 3 });
        await pag.mouse.move(pos.x, pos.y - 4, { steps: 3 });
      }
      await pag.mouse.move(pos.x, pos.y, { steps: 2 });
      await pag.mouse.up();
      await pag.waitForTimeout(150);
    }
    const tras = await filaHoja(1, 'pendiente_deg');
    if (!/\bok\b/.test(tras?.clase ?? '')) falla(`after flattening, the solar tower slope should be OK: ${tras?.texto}`); else ok(`after flatten: ${tras.texto.slice(0, 90)}`);
    const marca = await pag.$eval(`.marca[data-uid="${torre[0].uid}"]`, (d) => d.className);
    if (/rompe/.test(marca)) console.log(`note: tower marker still red after flattening (other requirement breaks: ${await pag.$eval('.panel[data-lado=b] .hoja', (h) => [...h.querySelectorAll('.req.rompe .nom-req')].map((x) => x.textContent).join(', '))})`);
    await pag.click('.panel[data-lado=b] [data-herr=navegar]');
    await pag.waitForTimeout(200);
    await pag.screenshot({ path: join(SALIDA, '07-hoja-tras-allanar.png') });
    const ipex = await pag.$eval('.panel[data-lado=b] [data-v=ipex]', (d) => (d.hidden ? null : d.textContent.replace(/\s+/g, ' ').trim()));
    console.log(ipex ? `excavator line: ${ipex}` : 'excavator line hidden (no verified density or IPEx figure)');

    for (let k = 0; k < trazos; k++) await pag.keyboard.press('Control+z');
    await pag.waitForTimeout(200);
    const deshecho = await filaHoja(1, 'pendiente_deg');
    if (!/\brompe\b/.test(deshecho?.clase ?? '')) falla(`undo should bring the BREAKS back: ${deshecho?.texto}`); else ok(`undo (${trazos} stroke(s)) brings the slope BREAKS back`);
    for (let k = 0; k < trazos; k++) await pag.keyboard.press('Control+Shift+z');
  }

  // Punto 7: en estereográfica polar el sol se rotula como longitud y recorre el día lunar.
  const rotSol = await pag.$eval('.panel[data-lado=b] .mandos', (m) => m.textContent);
  const botonDia = await pag.$('.panel[data-lado=b] [data-a=dia]');
  if (!/Sun longitude/.test(rotSol) || !botonDia) falla('polar Moon panel should label the sun control "Sun longitude" and offer the lunar-day sweep');
  else {
    const az0 = await pag.$eval('.panel[data-lado=b] [data-sol=az]', (i) => +i.value);
    await botonDia.click();
    await pag.waitForTimeout(1500);
    await botonDia.click();
    const az1 = await pag.$eval('.panel[data-lado=b] [data-sol=az]', (i) => +i.value);
    if (az1 === az0) falla('lunar-day sweep did not move the sun'); else ok(`lunar-day sweep: sun longitude ${az0}° → ${az1}° in 1.5 s`);
  }

  // Persistencia: recargar devuelve lo plantado.
  const antesRecarga = await pag.evaluate(() => window.__az.paneles.map((p) => p.plantados?.lista.length ?? 0));
  await pag.waitForTimeout(600);
  await pag.reload();
  await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: 60000 });
  const trasRecarga = await pag.evaluate(() => window.__az.paneles.map((p) => p.plantados?.lista.length ?? 0));
  if (antesRecarga.join() !== trasRecarga.join()) falla(`planted equipment not restored after reload (${antesRecarga} → ${trasRecarga})`); else ok(`planted equipment restored after reload (${trasRecarga.join(' + ')})`);

  // Exportar lleva `plantado` sin tocar los campos del contrato; importar lo devuelve.
  if (!(await pag.evaluate(() => document.querySelector('.panel[data-lado=b]').classList.contains('ampliado')))) await pag.click('.panel[data-lado=b] .ampliar');
  const [descarga] = await Promise.all([pag.waitForEvent('download'), pag.click('.panel[data-lado=b] [data-a=exportar]')]);
  const exportado = JSON.parse(await readFile(await descarga.path(), 'utf8'));
  const claves = Object.keys(exportado);
  if (claves.slice(0, 4).join() !== 'terreno,n,base_sha256,celdas' || !Array.isArray(exportado.plantado) || exportado.plantado.length !== trasRecarga[1]) falla(`export keys/plantado wrong: ${claves} ${JSON.stringify(exportado.plantado)}`);
  else ok(`export: ${claves.join(', ')} (${exportado.plantado.length} planted)`);
  await pag.evaluate(() => { const p = window.__az.paneles[1]; p.plantados.lista.length = 0; });
  await pag.setInputFiles('.panel[data-lado=b] [data-a=importar]', { name: 'retouch-shackleton.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exportado)) });
  await pag.waitForTimeout(300);
  const importado = await pag.evaluate(() => ({ n: window.__az.paneles[1].plantados.lista.length, marcas: document.querySelectorAll('.panel[data-lado=b] .marca').length, estado: document.querySelector('.panel[data-lado=b] .retoque .estado').textContent }));
  if (importado.n !== exportado.plantado.length || importado.marcas !== importado.n) falla(`import did not restore planted equipment: ${JSON.stringify(importado)}`); else ok(`import: ${importado.estado}`);

  // Sin catálogo: la paleta lo dice y el visor sigue funcionando.
  const ctx2 = await nav.newContext({ viewport: { width: 1600, height: 900 } });
  const pag2 = await ctx2.newPage();
  pag2.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) falla(`console (no catalogue): ${m.text()}`); });
  pag2.on('pageerror', (e) => falla(`page error (no catalogue): ${e.message}`));
  await pag2.route('**/data/equipo.json', (r) => r.fulfill({ status: 404, body: '' }));
  await pag2.goto(`${base}/terreno/index.html${reales ? '' : '?ejemplo=1'}`);
  await pag2.waitForFunction(() => window.__az?.listo === true, null, { timeout: 60000 });
  await pag2.click('.panel[data-lado=b] .ver-paleta');
  const sinCat = await pag2.evaluate(() => ({
    paleta: document.querySelector('.panel[data-lado=b] .paleta').textContent,
    lienzos: window.__az.paneles.map((p) => p.escena?.muestraLienzo().colores ?? 0),
    errores: window.__az.errores,
  }));
  if (!/equipment catalogue not found/.test(sinCat.paleta) || sinCat.lienzos.some((c) => c < 20) || sinCat.errores.length) falla(`without catalogue: ${JSON.stringify(sinCat)}`);
  else ok('without web/data/equipo.json the palette says "equipment catalogue not found" and both terrains still draw');
  await ctx2.close();

  // ---------- Agua: tinte en los tres modos, sombras visibles, leyenda, lectura y notas ----------
  if (reales) for (const [id, png] of [['haughton', '08-agua-haughton.png'], ['mistastin', '09-agua-mistastin.png']]) {
    const pag3 = await nav.newPage({ viewport: { width: 1600, height: 900 } });
    pag3.on('pageerror', (e) => falla(`page error (${id}): ${e.message}`));
    await pag3.goto(`${base}/terreno/index.html?a=${id}&b=shackleton&solo=${id}`);
    await pag3.waitForFunction(() => window.__az?.listo === true, null, { timeout: 60000 });
    // Píxel del lienzo en una posición de pantalla, recién dibujado.
    const muestra = (pts, sinAgua) => pag3.evaluate(([pts, sinAgua]) => {
      const e = window.__az.paneles[0].escena, u = e.uniforms.uHayAgua;
      const antes = u?.value;
      if (u && sinAgua) u.value = 0;
      e.dibujar(true);
      const gl = e.renderer.getContext(), r = e.renderer.domElement.getBoundingClientRect();
      const kx = gl.drawingBufferWidth / r.width, ky = gl.drawingBufferHeight / r.height, px = new Uint8Array(4);
      const out = pts.map(({ x, y }) => {
        gl.readPixels(Math.round((x - r.left) * kx), Math.round(gl.drawingBufferHeight - (y - r.top) * ky), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [px[0], px[1], px[2]];
      });
      if (u) u.value = antes;
      e.dibujar(true);
      return out;
    }, [pts, sinAgua]);
    // Celdas de agua y de tierra a ≥ 5 celdas de la orilla, visibles y devueltas por el rayo.
    const celdas = await pag3.evaluate(() => {
      const e = window.__az.paneles[0].escena, n = e.n, a = e.capas.agua;
      if (!a) return null;
      const lejos = (f, c, agua) => { for (let df = -5; df <= 5; df++) for (let dc = -5; dc <= 5; dc++) { const v = a[(f + df) * n + c + dc]; if ((v >= 1) !== agua) return false; } return true; };
      const out = { agua: [], tierra: [], aguaSombra: [] };
      for (let f = 6; f < n - 6; f += 9) for (let c = 6; c < n - 6; c += 9) {
        const agua = a[f * n + c] >= 1;
        if (!lejos(f, c, agua)) continue;
        const s = e.aPantalla(e.mundoDePixel(f, c));
        const g = s?.dentro && document.elementFromPoint(s.x, s.y) === e.renderer.domElement && e.rayo(s.x, s.y);
        if (!g || Math.hypot(g.fila - f, g.col - c) > 1) continue;
        const x = { f, c, x: s.x, y: s.y, luz: e.datosSombra[f * n + c] };
        (agua ? out.agua : out.tierra).push(x);
      }
      return out;
    });
    if (!celdas || !celdas.agua.length || !celdas.tierra.length) { falla(`${id}: no visible water and land cells to sample (${JSON.stringify(celdas && { agua: celdas.agua.length, tierra: celdas.tierra.length })})`); await pag3.close(); continue; }
    const pa = celdas.agua.slice(0, 12), pt = celdas.tierra.slice(0, 12);
    for (const modo of ['relieve', 'cota', 'pendiente']) {
      await pag3.click(`.panel[data-lado=a] [data-modo=${modo}]`);
      const [con, sin] = [await muestra([...pa, ...pt], false), await muestra([...pa, ...pt], true)];
      const dif = con.map((c, k) => Math.max(...c.map((v, j) => Math.abs(v - sin[k][j]))));
      const dAgua = dif.slice(0, pa.length), dTierra = dif.slice(pa.length);
      const azul = con.slice(0, pa.length).filter(([r, , b]) => b - r >= 30).length;
      if (Math.min(...dAgua) < 20 || Math.max(...dTierra) > 2 || azul < pa.length) falla(`${id} ${modo}: water not tinted (min change on water ${Math.min(...dAgua).toFixed(0)}/255, max on land ${Math.max(...dTierra).toFixed(0)}, blue ${azul}/${pa.length})`);
      else ok(`${id} ${modo}: water tinted (${pa.length} water samples change ≥ ${Math.min(...dAgua).toFixed(0)}/255, ${pt.length} land samples unchanged; water rgb ${con[0].map((v) => v.toFixed(0)).join(',')})`);
    }
    await pag3.click('.panel[data-lado=a] [data-modo=relieve]');
    // Sol bajo: el agua en sombra proyectada tiene que seguir viéndose más oscura que la iluminada.
    await pag3.$eval('.panel[data-lado=a] [data-sol=el]', (i) => { i.value = 4; i.dispatchEvent(new Event('input')); });
    await pag3.waitForTimeout(300);
    const luz = await pag3.evaluate((pa) => { const e = window.__az.paneles[0].escena; return pa.map((x) => e.datosSombra[x.f * e.n + x.c]); }, celdas.agua);
    const enSombra = celdas.agua.filter((_, k) => luz[k] === 0).slice(0, 8), alSol = celdas.agua.filter((_, k) => luz[k] === 255).slice(0, 8);
    if (!enSombra.length || !alSol.length) console.log(`${id}: no water cell in cast shadow at sun elevation 4° (${enSombra.length} shadowed, ${alSol.length} lit): shadow contrast not checked`);
    else {
      const lum = (cs) => cs.reduce((s, [r, g, b]) => s + 0.2126 * r + 0.7152 * g + 0.0722 * b, 0) / cs.length;
      const [ls, ll] = [lum(await muestra(enSombra, false)), lum(await muestra(alSol, false))];
      if (!(ll >= 1.5 * ls)) falla(`${id}: cast shadow on water not visible under the tint (lit ${ll.toFixed(0)} vs shadow ${ls.toFixed(0)})`);
      else ok(`${id}: cast shadows still visible on water at sun elevation 4° (luminance lit ${ll.toFixed(0)} vs shadow ${ls.toFixed(0)}, ${alSol.length}/${enSombra.length} samples)`);
    }
    await pag3.$eval('.panel[data-lado=a] [data-sol=el]', (i) => { i.value = 30; i.dispatchEvent(new Event('input')); });
    await pag3.waitForTimeout(300);
    // Lectura bajo el cursor, leyenda, botón de capa y notas del meta.
    await pag3.mouse.move(pa[0].x, pa[0].y);
    await pag3.waitForTimeout(100);
    const ui = await pag3.evaluate(() => {
      const p = window.__az.paneles[0], m = p.escena.meta, el = p.el;
      const ley = el.querySelector('.leyenda [data-leyenda=agua]');
      return {
        lectura: el.querySelector('[data-k=agua]')?.textContent ?? null,
        leyenda: ley ? ley.textContent.replace(/\s+/g, ' ').trim() : null,
        enlace: ley?.querySelector('a')?.href ?? null, url: m.capas.agua.url,
        boton: !!el.querySelector('[data-capa=agua]'),
        notas: el.querySelector('.tarjeta [data-notas]')?.textContent ?? null, metaNotas: m.notas,
      };
    });
    const claseCursor = await pag3.evaluate((x) => { const e = window.__az.paneles[0].escena; return e.meta.capas.agua.clases[String(e.capas.agua[x.f * e.n + x.c])]; }, pa[0]);
    if (ui.lectura !== claseCursor) falla(`${id}: bottom bar should read "${claseCursor}" over water, reads ${JSON.stringify(ui.lectura)}`); else ok(`${id}: bottom bar over water reads "${ui.lectura}"`);
    if (!/Water/.test(ui.leyenda ?? '') || ui.enlace !== ui.url) falla(`${id}: legend has no water entry linked to its source (${JSON.stringify({ leyenda: ui.leyenda, enlace: ui.enlace })})`); else ok(`${id}: legend "${ui.leyenda.slice(0, 120)}"`);
    if (ui.boton) falla(`${id}: water is always tinted, it should not also be a LAYER button`);
    if (!ui.notas || !ui.notas.includes(ui.metaNotas)) falla(`${id}: meta.notas not shown on the terrain card (${JSON.stringify(ui.notas)})`); else ok(`${id}: meta.notas on the card (${ui.notas.length} chars)`);
    await pag3.mouse.move(5, 5);
    await pag3.waitForTimeout(200);
    await pag3.screenshot({ path: join(SALIDA, png) });
    await pag3.close();
  }
} catch (e) {
  falla(`script: ${e.stack ?? e.message}`);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `CAPTURA: ${fallos.length} failure(s)` : 'CAPTURA: ok');
process.exit(fallos.length ? 1 : 0);

// «Generate report» en el visor (Chromium): (a) el botón no cambia la barra (misma altura, una sola línea); (b) sin base el
// informe sale igual y dice qué falta; (c) con base: diálogo, vista previa con las 10 secciones y sus gráficos, cifras = las de
// la pantalla (radio, piezas, pendiente de una pieza, altura del sol a una hora); (d) la descarga = el srcdoc; (e) el fichero
// suelto (file://) se ve igual sin red, y en PDF; (f) Esc cierra y el foco vuelve al botón; (g) simulación de Marte (?lugar=&punto=).
// Uso: node scripts/captura_informe.mjs [--sin-vivo]
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'informe');
const SIN_VIVO = process.argv.includes('--sin-vivo');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const fallos = [];
const comprobar = (cond, bien, mal) => { if (cond) console.log(`ok   ${bien}`); else { fallos.push(mal); console.error(`FAIL ${mal}`); } };

const servidor = createServer(async (req, res) => {
  const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = join(WEB, ruta.endsWith('/') ? `${ruta}index.html` : ruta);
  if (!f.startsWith(WEB)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': TIPOS[extname(f)] ?? 'application/octet-stream' }).end(await readFile(f)); } catch { res.writeHead(404).end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}`;
await mkdir(SALIDA, { recursive: true });
const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const contexto = await nav.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const pag = await contexto.newPage();
pag.on('console', (m) => { if (m.type() === 'error') { fallos.push(`console: ${m.text()}`); console.error(`FAIL console: ${m.text()}`); } });
pag.on('pageerror', (e) => { fallos.push(`page error: ${e.message}`); console.error(`FAIL page error: ${e.message}`); });
const abrir = async (q = '') => {
  await pag.goto(`${base}/terreno/index.html${q}`);
  await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: 180000 });
  await pag.waitForTimeout(600);
};
const limpiar = () => pag.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('analog-zero.planted.')) localStorage.removeItem(k); });
const marco = () => pag.frames().find((f) => f.parentFrame() && f.url() === 'about:srcdoc');
const informe = async () => {
  await pag.click('#informe');
  await pag.waitForFunction(() => { const d = document.querySelector('.inf-dialogo'); const f = d?.querySelector('iframe'); return d?.open && !window.__az.informe.ultimo().trabajando && !!f.getAttribute('srcdoc') && f.contentDocument?.readyState === 'complete' && !!f.contentDocument.getElementById('s10'); }, null, { timeout: 240000 });
  await pag.waitForTimeout(500);
  const f = marco();
  return f.evaluate(() => {
    const t = (e) => e?.textContent.replace(/\s+/g, ' ').trim() ?? null;
    const sec = Object.fromEntries([...document.querySelectorAll('section[id^=s]')].map((s) => [s.id, { titulo: t(s.querySelector('h2')), svg: s.querySelectorAll('svg').length, texto: t(s), falta: [...s.querySelectorAll('.falta')].map(t) }]));
    return { titulo: document.title, sec, h1: t(document.querySelector('h1')), alto: document.documentElement.scrollHeight };
  });
};
const SECCIONES = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'];

try {
  // (a) barra
  await abrir();
  await limpiar();
  await abrir();
  await pag.evaluate(() => document.fonts.ready);
  await pag.waitForTimeout(300);
  const barra = await pag.evaluate(() => {
    const b = document.querySelector('.marca-barra'), boton = document.getElementById('informe'), en = document.getElementById('enlazar');
    const caja = (e) => e.getBoundingClientRect();
    const hijos = () => [...b.children].filter((e) => e.offsetParent !== null && caja(e).width > 0).map((e) => { const r = caja(e); return { id: e.id || e.className, top: r.top, bottom: r.bottom }; });
    const con = { alto: caja(b).height, hijos: hijos() };
    boton.style.display = 'none';
    const sin = { alto: caja(b).height, hijos: hijos() };
    boton.style.display = '';
    return { con, sin, boton: [caja(boton).height, caja(boton).width], enlazar: caja(en).height, clase: boton.className, texto: boton.textContent };
  });
  // Lo que ya había en la barra queda a la misma altura, con y sin el botón (el botón cabe en la línea de los demás botones).
  const quietos = barra.sin.hijos.every((x, k) => { const y = barra.con.hijos.filter((z) => z.id !== 'informe')[k]; return y && y.id === x.id && Math.abs(y.top - x.top) < 0.5 && Math.abs(y.bottom - x.bottom) < 0.5; });
  const enLinea = barra.con.hijos.filter((x) => x.id === 'informe' || x.id === 'enlazar').map((x) => x.top);
  comprobar(Math.abs(barra.con.alto - barra.sin.alto) < 0.5 && quietos && Math.abs(enLinea[0] - enLinea[1]) < 0.5, `(a) the top bar is ${barra.con.alto.toFixed(1)} px high with the button and ${barra.sin.alto.toFixed(1)} px without it; nothing else in it moves; the button sits on the line of "Link cameras"`, `(a) bar: ${JSON.stringify(barra)}`);
  comprobar(Math.abs(barra.boton[0] - barra.enlazar) < 0.5 && /marca-boton/.test(barra.clase) && barra.texto === 'Generate report', `(a) "${barra.texto}" is as tall as "Link cameras" (${barra.boton[0].toFixed(1)} px)`, `(a) button: ${JSON.stringify(barra)}`);
  await pag.screenshot({ path: join(SALIDA, 'a-barra.png'), clip: { x: 0, y: 0, width: 1600, height: 120 } });
  // Más estrecho que 1600 px: solo se informa (ver la entrega).
  for (const w of [1500, 1280]) {
    await pag.setViewportSize({ width: w, height: 1000 });
    await pag.waitForTimeout(200);
    const a = await pag.evaluate(() => { const b = document.querySelector('.marca-barra'), bt = document.getElementById('informe'); const con = b.getBoundingClientRect().height; bt.style.display = 'none'; const sin = b.getBoundingClientRect().height; bt.style.display = ''; return [con, sin]; });
    console.log(`info at ${w} px the top bar is ${a[0].toFixed(1)} px high with the button, ${a[1].toFixed(1)} px without`);
  }
  await pag.setViewportSize({ width: 1600, height: 1000 });

  // (b) sin base
  const r0 = await informe();
  comprobar(SECCIONES.every((k) => r0.sec[k]) && r0.h1 === 'Analog Zero — simulation report', `(b) without a base the report opens with its ${Object.keys(r0.sec).length} sections`, `(b) sections: ${JSON.stringify(Object.keys(r0.sec))}`);
  comprobar(/No base generated: press Generate base/.test(r0.sec.s5.texto) && /No base generated: press Generate base/.test(r0.sec.s6.texto), '(b) sections 5 and 6 say "No base generated: press Generate base"', `(b) s5 ${r0.sec.s5.texto.slice(0, 200)} · s6 ${r0.sec.s6.texto.slice(0, 200)}`);
  console.log(`info global layers of the search engine read in ${(await pag.evaluate(() => window.__az.informe.ultimo().segundosMotor))?.toFixed(2)} s (first report)`);
  await pag.screenshot({ path: join(SALIDA, 'b-sin-base.png') });
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(300);
  const foco = await pag.evaluate(() => ({ abierto: document.querySelector('.inf-dialogo').open, foco: document.activeElement?.id }));
  comprobar(!foco.abierto && foco.foco === 'informe', '(f) Esc closes the preview and the focus goes back to the button', `(f) after Esc: ${JSON.stringify(foco)}`);

  // (c) con base
  await pag.evaluate(() => window.__az.asentamiento.generar());
  await pag.waitForFunction(() => window.__az.asentamiento.estado.trabajando === false, null, { timeout: 180000 });
  const t0 = Date.now();
  const r = await informe();
  const seg = (Date.now() - t0) / 1000;
  comprobar(SECCIONES.every((k) => r.sec[k]) && r.sec.s2.titulo === '2. Parameters used' && r.sec.s10.titulo === '10. Sources', `(c) with the base the report has the 10 sections (built in ${seg.toFixed(1)} s; global layers read in ${(await pag.evaluate(() => window.__az.informe.ultimo().segundosMotor))?.toFixed(2)} s)`, `(c) sections: ${JSON.stringify(Object.fromEntries(Object.entries(r.sec).map(([k, v]) => [k, v.titulo])))}`);
  const svgs = Object.fromEntries(['s3', 's4', 's5', 's6', 's8'].map((k) => [k, r.sec[k].svg]));
  comprobar(Object.values(svgs).every((v) => v >= 1) && svgs.s4 >= 2 && svgs.s6 >= 2, `(c) charts per section: ${JSON.stringify(svgs)}`, `(c) charts: ${JSON.stringify(svgs)}`);
  comprobar(Object.values(r.sec).every((s) => !/\bNaN\b|undefined|\[object/.test(s.texto)), '(c) no "NaN", "undefined" or "[object" anywhere in the report', `(c) bad text in: ${Object.entries(r.sec).filter(([, s]) => /\bNaN\b|undefined|\[object/.test(s.texto)).map(([k]) => k)}`);
  console.log(`info missing parts: ${JSON.stringify(Object.fromEntries(Object.entries(r.sec).filter(([, s]) => s.falta.length).map(([k, s]) => [k, s.falta])))}`);

  // cifras del informe = pantalla
  const pantalla = await pag.evaluate(() => {
    const az = window.__az, A = az.asentamiento.estado.res;
    const pb = az.paneles.find((p) => p.lado === A.pri), it = pb.plantados.lista.find((x) => x.equipo === 'habitat_superficie');
    return { radio: A.radio_m, piezas: az.paneles.map((p) => ({ cuerpo: p.escena.meta.cuerpo, n: p.plantados.lista.length })), pend: pb.escena.leer(it.fila, it.col).pendiente, cuerpoPri: pb.escena.meta.cuerpo };
  });
  const enInforme = await marco().evaluate(() => {
    const s6 = document.getElementById('s6'), tablas = [...s6.querySelectorAll('table')];
    const filas = tablas.map((t) => [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())));
    const s4 = [...document.querySelectorAll('#s4 table tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
    const cab4 = [...document.querySelectorAll('#s4 table thead th')].map((th) => th.textContent.trim());
    return { radio: s6.querySelector('p').textContent, h3: [...s6.querySelectorAll('h3')].map((h) => h.textContent), filas, s4, cab4, piezasPlano: [...s6.querySelectorAll('.plano')].map((f) => f.querySelectorAll('g.pieza').length) };
  });
  comprobar(enInforme.radio.includes(`Radius ${pantalla.radio} m`), `(c) radius in the report = on screen: ${pantalla.radio} m`, `(c) radius: "${enInforme.radio}" vs ${pantalla.radio}`);
  comprobar(enInforme.filas.length === 2 && enInforme.filas.every((f, k) => f.length === pantalla.piezas.find((x) => x.cuerpo === ({ Moon: 'luna', Earth: 'tierra', Mars: 'marte' }[enInforme.h3[k]])).n) && enInforme.piezasPlano.every((v, k) => v === enInforme.filas[k].length), `(c) pieces per world in the report = planted on screen: ${enInforme.h3.map((h, k) => `${h} ${enInforme.filas[k].length}`).join(', ')}`, `(c) pieces: ${JSON.stringify(enInforme.h3)} ${JSON.stringify(enInforme.filas.map((f) => f.length))} vs ${JSON.stringify(pantalla.piezas)} · plan ${enInforme.piezasPlano}`);
  const kPri = enInforme.h3.findIndex((h) => ({ Moon: 'luna', Earth: 'tierra', Mars: 'marte' }[h] === pantalla.cuerpoPri));
  const habRow = enInforme.filas[kPri]?.find((f) => /Surface habitat/.test(f[1]));
  comprobar(habRow && habRow[6] === pantalla.pend.toFixed(2), `(c) slope of the habitat in the report (${habRow?.[6]}°) = the cell on screen (${pantalla.pend.toFixed(2)}°)`, `(c) habitat row ${JSON.stringify(habRow)} vs ${pantalla.pend}`);
  await pag.evaluate(() => window.__az.dia.ir(9));
  await pag.waitForFunction(() => window.__az.dia.listo(), null, { timeout: 120000 });
  const sol9 = await pag.evaluate(() => window.__az.paneles.filter((p) => p.escena).map((p) => ({ cuerpo: p.escena.meta.cuerpo, el: p.escena.sol.el })));
  const fila9 = enInforme.s4.find((f) => f[0] === '9');
  const cols = sol9.map((s) => enInforme.cab4.findIndex((c) => c === `${{ luna: 'Moon', tierra: 'Earth', marte: 'Mars' }[s.cuerpo]} elevation`));
  comprobar(fila9 && cols.every((c, k) => c > 0 && fila9[c].replace('−', '-') === `${sol9[k].el.toFixed(2)}°`), `(c) Sun elevation at hour 9 in the report = Day at 9 on screen: ${sol9.map((s) => `${s.cuerpo} ${s.el.toFixed(2)}°`).join(', ')}`, `(c) hour 9: ${JSON.stringify(fila9)} ${JSON.stringify(enInforme.cab4)} vs ${JSON.stringify(sol9)}`);
  await pag.screenshot({ path: join(SALIDA, 'c-dialogo.png') });

  // (d) descarga
  const [descarga] = await Promise.all([pag.waitForEvent('download'), pag.click('.inf-dialogo [data-a=descargar]')]);
  const ruta = join(SALIDA, descarga.suggestedFilename());
  await descarga.saveAs(ruta);
  const fichero = await readFile(ruta, 'utf8');
  const srcdoc = await pag.evaluate(() => document.querySelector('.inf-dialogo iframe').getAttribute('srcdoc'));
  comprobar(fichero === srcdoc && fichero.length > 10000, `(d) the downloaded file "${descarga.suggestedFilename()}" (${(fichero.length / 1024).toFixed(0)} KB) is byte for byte the preview`, `(d) download ${fichero.length} chars vs srcdoc ${srcdoc?.length}`);
  comprobar(/^analog-zero-report-(moon|mars)-[-\d.]+_[-\d.]+\.html$/.test(descarga.suggestedFilename()), '(d) file name: analog-zero-report-<world>-<lat>_<lon>.html', `(d) name ${descarga.suggestedFilename()}`);
  comprobar(!/<script|<link\b|<img\b|\ssrc=/i.test(fichero), '(d) the file has no script, no link, no image, no src', '(d) the file loads something');

  // imprimir: el iframe deja llamar a print() (sandbox allow-modals + allow-same-origin)
  const imp = await pag.evaluate(() => { const f = document.querySelector('.inf-dialogo iframe'); try { return { ok: typeof f.contentWindow.print === 'function', origen: f.contentDocument !== null }; } catch (e) { return { ok: false, error: e.message }; } });
  comprobar(imp.ok && imp.origen, '(d) the preview can be printed: print() reachable in the sandboxed frame', `(d) print: ${JSON.stringify(imp)}`);

  // (e) fichero suelto, sin red
  const suelta = await contexto.newPage();
  const pedidas = [];
  await suelta.route('**/*', (rt) => { const u = rt.request().url(); if (u.startsWith('file:')) rt.continue(); else { pedidas.push(u); rt.abort(); } });
  await suelta.setViewportSize({ width: 1100, height: 1400 });
  await suelta.goto(pathToFileURL(ruta).href);
  await suelta.waitForTimeout(400);
  const vista = await suelta.evaluate(() => ({ secciones: document.querySelectorAll('section[id^=s]').length, svg: document.querySelectorAll('svg').length, ancho: document.documentElement.scrollWidth }));
  comprobar(pedidas.length === 0 && vista.secciones === 10 && vista.svg >= 7 && vista.ancho <= 1100, `(e) the file opens on its own with no network request: ${vista.secciones} sections, ${vista.svg} charts, nothing wider than the page`, `(e) file: ${JSON.stringify(vista)} requests ${JSON.stringify(pedidas)}`);
  await suelta.screenshot({ path: join(SALIDA, 'e-fichero-completo.png'), fullPage: true });
  for (const k of SECCIONES) await suelta.locator(`#${k}`).screenshot({ path: join(SALIDA, `e-${k}.png`) });
  await suelta.pdf({ path: join(SALIDA, 'e-informe.pdf'), format: 'A4', printBackground: true });
  await suelta.close();
  await pag.click('.inf-dialogo [data-a=cerrar]');
  await limpiar();

  // (g) simulación de Marte
  if (!SIN_VIVO) {
    await abrir('?lugar=-23.8634%2C-69.1328&nombre=Test+place&punto=-4.5895%2C137.4417&mundo=mars');
    const avisos = await pag.evaluate(() => ({ lugar: window.__az.avisoLugar ?? null, punto: window.__az.avisoPunto ?? null, cuerpos: window.__az.paneles.map((p) => p.escena?.meta.cuerpo ?? null) }));
    console.log(`info Mars simulation panels: ${JSON.stringify(avisos)}`);
    const rm0 = await informe();
    comprobar(SECCIONES.every((k) => rm0.sec[k]) && /No base generated/.test(rm0.sec.s6.texto), '(g) Mars simulation, no base: the report comes out and says so', `(g) no base: ${JSON.stringify(Object.keys(rm0.sec))}`);
    await pag.click('.inf-dialogo [data-a=cerrar]');
    await pag.evaluate(() => window.__az.asentamiento.generar());
    await pag.waitForFunction(() => window.__az.asentamiento.estado.trabajando === false, null, { timeout: 180000 });
    const rm = await informe();
    comprobar(SECCIONES.every((k) => rm.sec[k]) && /Mars/.test(rm.sec.s1.texto) && rm.sec.s6.svg >= 1, `(g) Mars simulation with base: 10 sections, "${rm.titulo}"`, `(g) Mars: ${JSON.stringify(Object.fromEntries(Object.entries(rm.sec).map(([k, v]) => [k, v.svg])))}`);
    console.log(`info Mars missing parts: ${JSON.stringify(Object.fromEntries(Object.entries(rm.sec).filter(([, s]) => s.falta.length).map(([k, s]) => [k, s.falta])))}`);
    console.log(`info Mars section 8: ${rm.sec.s8.texto.slice(0, 300)}`);
    await pag.screenshot({ path: join(SALIDA, 'g-marte-dialogo.png') });
    const html = await pag.evaluate(() => window.__az.informe.ultimo().html);
    const sueltaM = await contexto.newPage();
    await sueltaM.route('**/*', (rt) => (rt.request().url().startsWith('file:') ? rt.continue() : rt.abort()));
    await sueltaM.setViewportSize({ width: 1100, height: 1400 });
    await sueltaM.setContent(html);
    for (const k of ['s4', 's5', 's6', 's8']) await sueltaM.locator(`#${k}`).screenshot({ path: join(SALIDA, `g-marte-${k}.png`) });
    await sueltaM.close();
    await pag.click('.inf-dialogo [data-a=cerrar]');
    // Base por prioridad y con misión y mes en la dirección: el informe lleva los números y las reglas de la pantalla, y dice lo que su tabla de parecido no aplica.
    await limpiar();
    await abrir('?lugar=-23.8634%2C-69.1328&nombre=Test+place&punto=-4.5895%2C137.4417&mundo=mars&mision=taladros&mes=7');
    await pag.evaluate(() => window.__az.asentamiento.generar({ modo: 'prioridad', orden: ['ltv', 'taladro_trident'] }));
    await pag.waitForFunction(() => window.__az.asentamiento.estado.trabajando === false, null, { timeout: 180000 });
    await pag.waitForTimeout(500);
    const pr = await pag.evaluate(async () => {
      const d = await window.__az.informe.datos(), p = d.paneles.find((x) => x.cuerpo !== 'tierra') ?? d.paneles[0];
      const marcas = Object.fromEntries([...document.querySelectorAll(`.panel[data-lado=${p.lado}] .marca.de-base`)].map((m) => [+m.dataset.uid, +m.querySelector('.as-n').textContent]));
      const base = p.piezas.filter((x) => x.de_base);
      return { modo: d.base?.modo, n: base.length, igual: base.every((x) => marcas[x.uid] === x.num), ltv: base.find((x) => x.id === 'ltv'), hab: base.find((x) => x.id === 'habitat_superficie') };
    });
    comprobar(pr.modo === 'prioridad' && pr.n > 0 && pr.igual && pr.ltv.num === 1 && /^Your first need: placed first/.test(pr.ltv.regla) && /pulled towards Lunar Terrain Vehicle, your first need/.test(pr.hab.regla), `(g) base by priority: the report numbers its ${pr.n} pieces like the markers and gives the rule the screen gives ("${pr.ltv.regla}")`, `(g) priority: ${JSON.stringify({ modo: pr.modo, n: pr.n, igual: pr.igual, ltv: [pr.ltv?.num, pr.ltv?.regla], hab: [pr.hab?.num, pr.hab?.regla] })}`);
    const rp = await informe();
    comprobar(/The mission objective and the month in the address are not applied in this table/.test(rp.sec.s8.texto) && /Around what you need most/.test(rp.sec.s2.texto), '(g) with a mission and a month in the address, section 8 says its table does not apply them; section 2 names the priority mode', `(g) s8: ${rp.sec.s8.texto.slice(0, 400)}`);
    await pag.click('.inf-dialogo [data-a=cerrar]');
    await limpiar();
  }
} catch (e) {
  fallos.push(`script: ${e.message}`); console.error(e);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `\n${fallos.length} FAILED` : '\nall ok');
process.exit(fallos.length ? 1 : 0);

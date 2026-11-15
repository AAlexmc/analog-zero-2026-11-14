// «Generate base» en el visor (Chromium): (a) la barra y sus radios; (b) un clic planta cada equipo de superficie del catálogo
// dentro del radio en la Luna y su gemelo en la Tierra, a los mismos metros del centro, y deja las dos vistas desde arriba
// con el anillo; (c) las celdas = el optimizador en node con los mismos datos; (d) la ficha al pasar el ratón: dos mundos,
// tira del día, y cambia con la hora de Day; clic la fija y abre las fichas; (e) radio de 250 m: el reactor no cabe a 1 km y
// se dice; (f) quitar una pieza la quita de los dos mundos y de la imagen; (g) tras recargar sigue; Clear la borra;
// (h) simulación (?lugar=, con red): lo plantado en una simulación no aparece en otra.
// Uso: node scripts/captura_asentamiento.mjs [--sin-vivo]
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { celdaEspejo } from '../web/terreno/espejo.js';
import { piezasDe, generarAsentamiento, RADIOS_M, RADIO_DEFECTO_M } from '../web/terreno/asentamiento.js';
import { evaluarRequisito } from '../web/terreno/evaluar.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'asentamiento');
const SIN_VIVO = process.argv.includes('--sin-vivo');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const fallos = [];
const comprobar = (cond, bien, mal) => { if (cond) console.log(`ok   ${bien}`); else { fallos.push(mal); console.error(`FAIL ${mal}`); } };
const bits = (v) => { let k = 0; for (let x = v >>> 0; x; x &= x - 1) k++; return k; };

const servidor = createServer(async (req, res) => {
  const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = join(WEB, ruta.endsWith('/') ? `${ruta}index.html` : ruta);
  if (!f.startsWith(WEB)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': TIPOS[extname(f)] ?? 'application/octet-stream' }).end(await readFile(f)); } catch { res.writeHead(404).end(); }
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}`;
await mkdir(SALIDA, { recursive: true });
const catalogo = JSON.parse(await readFile(join(WEB, 'data', 'equipo.json'), 'utf8'));
const nav = await chromium.launch({ headless: true, args: ['--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pag = await nav.newPage({ viewport: { width: 1600, height: 1000 } });
pag.on('console', (m) => { if (m.type() === 'error') { fallos.push(`console: ${m.text()}`); console.error(`FAIL console: ${m.text()}`); } });
pag.on('pageerror', (e) => { fallos.push(`page error: ${e.message}`); console.error(`FAIL page error: ${e.message}`); });
const abrir = async (q = '?a=haughton&b=shackleton&mes=6') => {
  await pag.goto(`${base}/terreno/index.html${q}`);
  await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: 180000 });
  await pag.waitForTimeout(600);
};
const limpiar = () => pag.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('analog-zero.planted.')) localStorage.removeItem(k); });
const lista = (i) => pag.evaluate((i) => window.__az.paneles[i].plantados?.lista.map((x) => ({ uid: x.uid, equipo: x.equipo, fila: x.fila, col: x.col, par: x.par })) ?? [], i);
// El botón abre la tabla de prioridades: se elige el modo (y, por prioridad, la pieza que va primero) y se acepta.
const generar = async (modo = 'optimo', primero = null) => {
  await pag.click('#asentamiento [data-a=generar]');
  await pag.waitForSelector('dialog.as-dialogo[open]');
  await pag.click(`dialog.as-dialogo [data-modo=${modo}]`);
  if (primero) await pag.click(`dialog.as-dialogo tr[data-id="${primero}"] [data-mover=primero]`);
  await pag.click('dialog.as-dialogo [data-a=ok]');
  await pag.waitForFunction(() => window.__az.asentamiento.estado.trabajando === false, null, { timeout: 180000 });
  await pag.waitForTimeout(900);
};
const ficha = (lado) => pag.evaluate((lado) => {
  const f = document.querySelector(`.as-ficha[data-lado=${lado}]`);
  if (!f || f.hidden) return null;
  const t = (e) => e.textContent.replace(/\s+/g, ' ').trim();
  return { titulo: t(f.querySelector('.as-cab b')), fijada: f.dataset.fijada, cab: [...f.querySelectorAll('thead th')].map(t), regla: f.querySelector('.as-regla') ? t(f.querySelector('.as-regla')) : null,
    filas: Object.fromEntries([...f.querySelectorAll('tr[data-fila]')].map((tr) => [tr.dataset.fila, [...tr.children].map(t)])), tiras: [...f.querySelectorAll('.as-tira')].map((d) => [...d.querySelectorAll('.celdas i')].map((i) => i.className)), pie: t(f.querySelector('.as-pie')) };
}, lado);

try {
  await abrir();
  await limpiar();
  await abrir();

  // (a) barra
  const barra = await pag.evaluate(() => { const c = document.getElementById('asentamiento'); return { visible: !c.hidden && c.offsetHeight > 0, boton: c.querySelector('[data-a=generar]').textContent, radios: [...c.querySelectorAll('[data-radio]')].map((b) => [b.textContent, b.getAttribute('aria-pressed')]), limpiar: c.querySelector('[data-a=limpiar]').disabled, estado: c.querySelector('[data-v=estado]').textContent, detalle: c.querySelector('.as-detalle').hidden }; });
  comprobar(barra.visible && barra.boton === 'Generate base' && barra.limpiar && barra.detalle, `(a) the Base bar shows "Generate base", with Clear off and no table yet: "${barra.estado}"`, `(a) bar: ${JSON.stringify(barra)}`);
  comprobar(barra.radios.length === RADIOS_M.length && barra.radios.find((r) => r[1] === 'true')?.[0] === `${RADIO_DEFECTO_M / 1000} km`, `(a) radii offered: ${barra.radios.map((r) => r[0]).join(', ')}; ${RADIO_DEFECTO_M / 1000} km selected`, `(a) radii: ${JSON.stringify(barra.radios)}`);
  await pag.screenshot({ path: join(SALIDA, 'a-antes.png') });

  // (b) generar
  const geo = await pag.evaluate(() => window.__az.paneles.map((p) => ({ n: p.escena.n, m: p.escena.m, cuerpo: p.escena.meta.cuerpo })));
  const t0 = Date.now();
  await generar();
  const seg = (Date.now() - t0) / 1000;
  let [ta, tb] = [await lista(0), await lista(1)];
  const { piezas, excluidos } = piezasDe(catalogo);
  comprobar(tb.length === piezas.length && tb.every((x) => x.par === `base:${RADIO_DEFECTO_M}:${x.equipo}`) && new Set(tb.map((x) => x.equipo)).size === piezas.length, `(b) ${tb.length} pieces planted on the Moon, one per surface system of the catalogue, in ${seg.toFixed(1)} s`, `(b) moon pieces: ${JSON.stringify(tb.map((x) => x.equipo))} vs ${piezas.map((x) => x.id)}`);
  const k1 = (geo[1].n - 1) / 2;
  const dist = tb.map((x) => Math.hypot(x.fila - k1, x.col - k1) * geo[1].m);
  comprobar(dist.every((d) => d <= RADIO_DEFECTO_M + 1e-6), `(b) every piece is inside the radius (farthest ${Math.max(...dist).toFixed(0)} m of ${RADIO_DEFECTO_M} m)`, `(b) pieces outside the radius: ${dist.map((d) => d.toFixed(0))}`);
  comprobar(new Set(tb.map((x) => `${x.fila},${x.col}`)).size === tb.length && new Set(ta.map((x) => `${x.fila},${x.col}`)).size === ta.length, '(b) no two pieces share a cell, on either world', '(b) two pieces share a cell');
  const alturasT = await pag.evaluate(() => Array.from(window.__az.paneles[0].escena.mostradas));
  const gemelos = tb.map((x) => ({ x, g: celdaEspejo({ n: geo[1].n, m: geo[1].m }, { n: geo[0].n, m: geo[0].m, alturas: alturasT }, x.fila, x.col), t: ta.find((y) => y.par === x.par) }));
  comprobar(ta.length === tb.length && gemelos.every(({ g, t }) => t && g && t.fila === g.fila && t.col === g.col), '(b) each piece has its twin on Earth at the same metres from the centre (node)', `(b) twins: ${JSON.stringify(gemelos.filter(({ g, t }) => !t || !g || t.fila !== g.fila || t.col !== g.col).map(({ x }) => x.equipo))}`);
  const vista = await pag.evaluate(() => window.__az.paneles.map((p) => { p.modelos.sincronizar(p.plantados.lista); const a = p.asAnillo; return { suelo: !!p.escena.suelo, modelos: p.modelos.instancias().filter((x) => x.enEscena).length, anillo: a.style.display !== 'none' && a.firstElementChild.getAttribute('points')?.split(' ').length, marcas: p.el.querySelectorAll('.marcas .marca').length }; }));
  comprobar(vista.every((v) => !v.suelo && v.anillo === 72 && v.marcas === piezas.length), `(b) both panels are seen from above with the radius ring and ${piezas.length} markers`, `(b) views: ${JSON.stringify(vista)}`);
  await pag.waitForFunction(() => window.__az.paneles.every((p) => p.modelos.instancias().every((x) => x.enEscena)), null, { timeout: 60000 }).catch(() => {});
  const sinModelo = await pag.evaluate(() => { const p = window.__az.paneles[1], ins = p.modelos.instancias(); return p.plantados.lista.filter((it) => !ins.some((x) => x.uid === it.uid && x.enEscena)).map((it) => it.equipo).sort(); });
  comprobar(sinModelo.join() === 'flip,pista_aterrizaje,rover_prospeccion_rtg', `(b) a 3D model stands for ${piezas.length - sinModelo.length} of ${piezas.length} pieces; marker only for the three with no published size (${sinModelo.join(', ')})`, `(b) pieces without a 3D model: ${sinModelo}`);
  const numeros = await pag.evaluate(() => [...document.querySelectorAll('.panel[data-lado=b] .marca.de-base .as-n')].map((b) => +b.textContent).sort((a, b) => a - b));
  comprobar(numeros.join() === piezas.map((_, i) => i + 1).join(), '(b) each marker carries its number, 1 to 12, the one in the table', `(b) marker numbers: ${numeros}`);
  const barra2 = await pag.evaluate(() => { const c = document.getElementById('asentamiento'); const t = (e) => e.textContent.replace(/\s+/g, ' ').trim(); return { boton: c.querySelector('[data-a=generar]').textContent, limpiar: c.querySelector('[data-a=limpiar]').disabled, estado: t(c.querySelector('[data-v=estado]')), detalle: c.querySelector('.as-detalle').hidden, filas: [...c.querySelectorAll('.as-tabla tbody tr')].map((tr) => [...tr.children].map(t)), cab: [...c.querySelectorAll('.as-tabla thead th')].map(t), notas: t(c.querySelector('.as-notas')), enlaces: c.querySelectorAll('.as-tabla a[href^=http]').length }; });
  comprobar(barra2.boton === 'Generate again' && !barra2.limpiar && !barra2.detalle && new RegExp(`^${piezas.length} pieces inside 1 km of the window centre · Moon .* · Earth `).test(barra2.estado), `(b) status: "${barra2.estado}"`, `(b) status: ${JSON.stringify(barra2.estado)}`);
  comprobar(barra2.filas.length === piezas.length && barra2.cab.join('|') === 'Piece|Why there (own rule)|Published limits|On Moon|On Earth' && barra2.enlaces > 0, `(b) the table has ${barra2.filas.length} rows, with ${barra2.enlaces} source links for the published limits`, `(b) table: ${JSON.stringify(barra2.cab)} ${barra2.filas.length} rows ${barra2.enlaces} links`);
  comprobar(excluidos.every((x) => barra2.notas.includes(x.nombre)) && /rules and weights are ours/.test(barra2.notas) && /Laid out for Moon; Earth gets the same layout/.test(barra2.notas), `(b) notes name what was left out (${excluidos.map((x) => x.nombre).join(', ')}) and say the rules are ours`, `(b) notes: ${barra2.notas}`);
  await pag.screenshot({ path: join(SALIDA, 'b-base.png') });
  await pag.click('#asentamiento .as-detalle summary');
  await pag.waitForTimeout(200);
  await pag.screenshot({ path: join(SALIDA, 'b-tabla.png') });
  await pag.click('#asentamiento .as-detalle summary');

  // (c) = node
  const datos = await pag.evaluate(() => { const p = window.__az.paneles[1], q = window.__az.paneles[0], m = window.__az.dia.mapa(p); return { alturas: Array.from(p.escena.mostradas), sombra: p.escena.capas.sombra_permanente ? Array.from(p.escena.capas.sombra_permanente) : null, agua: p.escena.capas.agua ? Array.from(p.escena.capas.agua) : null, aguaT: q.escena.capas.agua ? Array.from(q.escena.capas.agua) : null, capas: Object.fromEntries(['temp_max', 'temp_min', 'iluminacion', 'sombra_permanente'].filter((k) => p.escena.capas[k]).map((k) => [k, Array.from(p.escena.capas[k])])), luz: m && !m.pendiente ? Array.from(m.bits) : null, sep: window.__az.asentamiento.estado.res.separacion_min_m, r: window.__az.asentamiento.estado.res.r }; });
  const o = { n: geo[1].n, m: geo[1].m }, d = { n: geo[0].n, m: geo[0].m, alturas: Float32Array.from(alturasT.map((v) => (v === null ? NaN : v))) };
  const enCapa = (k, i) => { const x = datos.capas[k]?.[i]; return Number.isFinite(x) ? { valor: x } : { valor: null }; };
  const cumple = (pieza, f, c) => {
    const reqs = (catalogo.equipos.find((q) => q.id === pieza.id).requisitos ?? []).filter((q) => ['temp_k', 'iluminacion_frac', 'sombra_permanente'].includes(q.variable) && Number.isFinite(q.valor));
    const i = f * geo[1].n + c, med = { temp_k: { max: enCapa('temp_max', i), min: enCapa('temp_min', i) }, iluminacion_frac: enCapa('iluminacion', i), sombra_permanente: enCapa('sombra_permanente', i) };
    return reqs.every((q) => evaluarRequisito(q, med).estado !== 'rompe');
  };
  const rNode = generarAsentamiento({ n: geo[1].n, m: geo[1].m, alturas: Float32Array.from(datos.alturas.map((v) => (v === null ? NaN : v))), agua: datos.agua, capas: datos.sombra ? { sombra_permanente: datos.sombra } : {} }, piezas,
    { radio_m: RADIO_DEFECTO_M, luz: datos.luz ? { pasos: (i) => bits(datos.luz[i]), total: 24 } : null, separacion_min_m: datos.sep, margen_separacion_m: geo[0].m * Math.SQRT2, cumple, apto: (f, c) => { const r = celdaEspejo(o, d, f, c); return !!r && !r.recortado && !r.movido && !(datos.aguaT?.[r.fila * d.n + r.col] >= 1); } });
  comprobar(rNode.piezas.length === tb.length && rNode.piezas.every((x) => { const y = tb.find((z) => z.equipo === x.id); return y && y.fila === x.fila && y.col === x.col; }), `(c) the cells in the browser are the ones the optimiser gives in node (${rNode.candidatos} candidate cells, light map ${datos.luz ? 'used' : 'not available'}, shadow from ${rNode.sombraDe})`, `(c) browser ≠ node: ${JSON.stringify(rNode.piezas.map((x) => [x.id, x.fila, x.col]))} vs ${JSON.stringify(tb.map((x) => [x.equipo, x.fila, x.col]))}`);
  comprobar(!!datos.luz && rNode.usaLuz, '(c) the light map of the day was ready and used', '(c) no light map');

  // (d) ficha
  const hab = tb.find((x) => x.equipo === 'reactor_fision');
  // Punto de la pantalla donde el rayo da en el modelo (la barra Day cambia de alto al arrancar: se vuelve a buscar).
  const sobreModelo = async () => {
    const s = await pag.evaluate((uid) => { const p = window.__az.paneles[1], it = p.plantados.buscar(uid), s = p.escena.aPantalla(p.escena.mundoDePixel(it.fila, it.col)); return { x: s.x, y: s.y }; }, hab.uid);
    for (const dy of [-10, -20, -30, -45, -60, -6, 0]) if (await pag.evaluate(([x, y]) => window.__az.asentamiento.uidBajo(window.__az.paneles[1], x, y), [s.x, s.y + dy]) === hab.uid) return { x: s.x, y: s.y + dy, bajo: hab.uid };
    return { ...s, bajo: null };
  };
  let punto = await sobreModelo();
  const bajo = punto.bajo, py = punto.y;
  comprobar(bajo === hab.uid, '(d) the ray under the pointer hits the reactor model', `(d) under the pointer: uid ${bajo}, wanted ${hab.uid}`);
  await pag.mouse.move(punto.x - 200, py - 200);
  await pag.mouse.move(punto.x, py, { steps: 4 });
  await pag.waitForTimeout(500);
  let f = await ficha('b');
  comprobar(f && f.titulo === 'Fission surface power reactor' && f.fijada === 'false' && f.cab.join('|') === '|Moon|Earth' && /own rule/.test(f.regla ?? ''), `(d) hovering the reactor model opens its card for both worlds: "${f?.regla}"`, `(d) card: ${JSON.stringify(f)}`);
  if (f) {
    const med = await pag.evaluate((par) => window.__az.paneles.map((p) => { const it = p.plantados.lista.find((x) => x.par === par), e = p.escena; return { pend: e.leer(it.fila, it.col).pendiente, cota: e.mostradas[it.fila * e.n + it.col], el: e.sol.el }; }), hab.par);
    comprobar(f.filas.pendiente?.[1].startsWith(`${med[1].pend.toFixed(1)}°`) && f.filas.pendiente?.[2].startsWith(`${med[0].pend.toFixed(1)}°`) && f.filas.cota[1] === `${med[1].cota.toFixed(1)} m` && f.filas.cota[2] === `${med[0].cota.toFixed(1)} m`, `(d) slope and elevation = the cells: Moon ${f.filas.pendiente?.[1]}, Earth ${f.filas.pendiente?.[2]}`, `(d) rows: ${JSON.stringify(f.filas)} vs ${JSON.stringify(med)}`);
    comprobar(/set by hand/.test(f.filas.sol[1]) && /Play in Day/.test(f.filas.sol[1]) && !f.filas.luz, `(d) before Day runs: "${f.filas.sol[1]}"`, `(d) Sun row: ${JSON.stringify(f.filas.sol)}`);
    comprobar(f.tiras.length === 2 && f.tiras.every((t) => t.length === 24) && /\d+ of 24 /.test(f.filas.dia[1]) && /\d+ of 24 hours/.test(f.filas.dia[2]), `(d) day strips of 24 steps for both worlds: Moon ${f.filas.dia[1]}, Earth ${f.filas.dia[2]}`, `(d) strips: ${JSON.stringify(f.tiras.map((t) => t.length))} ${JSON.stringify(f.filas.dia)}`);
    comprobar(/Temperature hour by hour: NOT MEASURED/.test(f.pie), '(d) the card says hourly temperature is not measured', `(d) foot: ${f.pie}`);
  }
  await pag.screenshot({ path: join(SALIDA, 'd-ficha.png') });
  // Day: la ficha sigue a la hora
  await pag.evaluate(() => window.__az.dia.ir(9));
  await pag.waitForFunction(() => window.__az.dia.listo(), null, { timeout: 120000 });
  await pag.waitForTimeout(700);
  const f9 = await ficha('b');
  await pag.evaluate(() => window.__az.dia.ir(13));
  await pag.waitForTimeout(900);
  const f15 = await ficha('b');
  const solT = await pag.evaluate(() => window.__az.paneles[0].escena.sol);
  comprobar(f9 && f15 && f9.filas.sol[2] !== f15.filas.sol[2] && f15.filas.sol[2].includes(`${Math.abs(solT.el).toFixed(1)}°`) && !!f15.filas.luz, `(d) the card follows the hour: Earth Sun at 09:00 "${f9?.filas.sol[2]}", at 13:00 "${f15?.filas.sol[2]}", light "${f15?.filas.luz?.[2]}"`, `(d) card with Day: ${JSON.stringify(f9?.filas.sol)} → ${JSON.stringify(f15?.filas.sol)} (Sun ${solT.el})`);
  comprobar(f15 && f15.tiras.every((t) => t.filter((c) => /ahora/.test(c)).length === 1), '(d) with Day running each strip marks the current step', `(d) "now" marks: ${JSON.stringify(f15?.tiras.map((t) => t.filter((c) => /ahora/.test(c)).length))}`);
  await pag.screenshot({ path: join(SALIDA, 'd-ficha-hora.png') });
  punto = await sobreModelo();
  await pag.mouse.click(punto.x, punto.y);
  await pag.waitForTimeout(500);
  f = await ficha('b');
  const hojas = await pag.evaluate(() => window.__az.paneles.map((p) => ({ abierta: !p.el.querySelector('.hoja').hidden, titulo: p.el.querySelector('.hoja h3')?.textContent })));
  comprobar(f?.fijada === 'true' && hojas.every((h) => h.abierta && h.titulo === 'Fission surface power reactor'), '(d) a click pins the card and opens the full sheet on both panels', `(d) pinned ${f?.fijada}, sheets ${JSON.stringify(hojas)}`);
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(200);
  comprobar((await ficha('b')) === null, '(d) Esc closes the pinned card', '(d) the pinned card stayed');
  // sobre el rótulo de una marca
  await pag.hover(`.panel[data-lado=a] .marca[data-uid="${ta.find((x) => x.equipo === 'torre_solar').uid}"] .rot`);
  await pag.waitForTimeout(400);
  const fm = await ficha('a');
  comprobar(fm?.titulo === 'Vertical solar array tower' && fm.cab.join('|') === '|Earth|Moon', '(d) hovering a marker label on the Earth panel opens that card, Earth column first', `(d) marker card: ${JSON.stringify(fm?.titulo)} ${JSON.stringify(fm?.cab)}`);
  await pag.mouse.move(5, 5);

  // (f) quitar una pieza: sale de los dos mundos y de la imagen
  const ltv = tb.find((x) => x.equipo === 'ltv');
  await pag.evaluate((uid) => {
    const p = window.__az.paneles[1], r = p.escena.renderer, pintar = r.render.bind(r);
    window.__vistos = [];
    r.render = (...a) => { window.__vistos.push(p.modelos.grupo.children.filter((o) => o.userData.uid === uid).length); return pintar(...a); };
  }, ltv.uid);
  await pag.click('#asentamiento .as-detalle summary');
  await pag.click('#asentamiento .as-tabla tr[data-pieza=ltv] td:first-child');
  await pag.waitForTimeout(400);
  await pag.click('#asentamiento .as-detalle summary');
  const abiertas = await pag.evaluate(() => window.__az.paneles.map((p) => p.el.querySelector('.hoja h3')?.textContent));
  comprobar(abiertas.every((t) => t === 'Lunar Terrain Vehicle'), '(f) a click on a row of the table opens that piece on both panels', `(f) sheets after the row click: ${JSON.stringify(abiertas)}`);
  const antes = await pag.evaluate(() => window.__vistos.at(-1));
  await pag.click('.panel[data-lado=b] .hoja [data-a=quitar]');
  // Nada más mueve la cámara: si quitar no pidiera otro fotograma, el modelo se quedaría en la imagen.
  await pag.waitForFunction(() => window.__vistos.at(-1) === 0, null, { timeout: 15000 }).catch(() => {});
  [ta, tb] = [await lista(0), await lista(1)];
  const despues = await pag.evaluate(() => ({ ultimo: window.__vistos.at(-1), n: window.__vistos.length, modelos: window.__az.paneles.map((p) => p.modelos.instancias().length) }));
  comprobar(!tb.some((x) => x.equipo === 'ltv') && !ta.some((x) => x.equipo === 'ltv') && tb.length === piezas.length - 1 && ta.length === piezas.length - 1, '(f) removing the LTV on the Moon removes its twin on Earth', `(f) after remove: moon ${tb.map((x) => x.equipo)} earth ${ta.map((x) => x.equipo)}`);
  comprobar(antes === 1 && despues.ultimo === 0, `(f) the last frame drawn no longer has the LTV model in it (was ${antes}, now ${despues.ultimo})`, `(f) the removed model is still in the last frame drawn: before ${antes}, after ${JSON.stringify(despues)}`);

  // (e) radio de 250 m
  await pag.click('#asentamiento [data-radio="250"]');
  await generar();
  [ta, tb] = [await lista(0), await lista(1)];
  const d250 = tb.map((x) => Math.hypot(x.fila - k1, x.col - k1) * geo[1].m);
  const res250 = await pag.evaluate(() => { const c = document.getElementById('asentamiento'); const t = (e) => e.textContent.replace(/\s+/g, ' ').trim(); return { r: window.__az.asentamiento.estado.res.r, estado: t(c.querySelector('[data-v=estado]')), reactor: t(c.querySelector('.as-tabla tr[data-pieza=reactor_fision]')) }; });
  comprobar(tb.every((x) => x.par.startsWith('base:250:')) && d250.every((v) => v <= 250 + 1e-6) && new Set(tb.map((x) => x.equipo)).size === tb.length, `(e) generating again with 250 m replaces the base: ${tb.length} pieces, farthest ${Math.max(...d250).toFixed(0)} m; not placed: ${res250.r.sin_sitio.map((x) => x.id).join(', ') || 'none'}`, `(e) 250 m: ${JSON.stringify(tb.map((x) => [x.equipo, x.par]))} ${d250.map((v) => v.toFixed(0))}`);
  comprobar(/BREAKS/.test(res250.reactor) && /Distance from Surface habitat/.test(res250.reactor) && /try a wider radius/.test(res250.reactor) && /Moon \d+ breaks? a published limit \([^)]*Fission surface power reactor/.test(res250.estado), `(e) the reactor cannot keep its published 1 km from the habitat inside 250 m, and the bar says so: "${res250.estado}"`, `(e) reactor row: ${res250.reactor} · status: ${res250.estado}`);
  await pag.screenshot({ path: join(SALIDA, 'e-radio-250.png') });

  // (g) recarga y Clear
  await pag.waitForTimeout(600);
  await abrir();
  [ta, tb] = [await lista(0), await lista(1)];
  const tras = await pag.evaluate(() => { const c = document.getElementById('asentamiento'); return { radio: c.querySelector('[data-radio][aria-pressed=true]')?.dataset.radio, boton: c.querySelector('[data-a=generar]').textContent, anillo: window.__az.paneles.map((p) => p.asAnillo.style.display !== 'none'), filas: c.querySelectorAll('.as-tabla tbody tr').length }; });
  comprobar(tb.length > 0 && ta.length === tb.length && tras.radio === '250' && tras.boton === 'Generate again' && tras.anillo.every(Boolean) && tras.filas === tb.length, `(g) after a reload the base is still there (${tb.length} pieces, 250 m ring, table)`, `(g) after reload: moon ${tb.length} earth ${ta.length} ${JSON.stringify(tras)}`);
  await pag.click('#asentamiento [data-a=limpiar]');
  await pag.waitForTimeout(500);
  [ta, tb] = [await lista(0), await lista(1)];
  const vacio = await pag.evaluate(() => ({ anillo: window.__az.paneles.map((p) => p.asAnillo.style.display !== 'none'), modelos: window.__az.paneles.map((p) => p.modelos.instancias().length), detalle: document.querySelector('#asentamiento .as-detalle').hidden, guardado: Object.keys(localStorage).filter((k) => k.startsWith('analog-zero.planted.')).length }));
  comprobar(ta.length === 0 && tb.length === 0 && vacio.anillo.every((x) => !x) && vacio.modelos.every((x) => x === 0) && vacio.detalle && vacio.guardado === 0, '(g) Clear base removes every piece, the ring, the table and the autosave', `(g) after Clear: ${ta.length} ${tb.length} ${JSON.stringify(vacio)}`);
  // lo plantado a mano no lo toca la base
  await pag.evaluate(() => { window.__az.espejo = false; });
  await pag.click('.panel[data-lado=b] .ver-paleta');
  await pag.click('.panel[data-lado=b] .paleta [data-eq=viper]');
  const cb = await pag.locator('.panel[data-lado=b] .lienzo canvas').first().boundingBox();
  await pag.mouse.click(cb.x + cb.width / 2 + 120, cb.y + cb.height / 2 - 90);
  await pag.waitForTimeout(400);
  await pag.click('#asentamiento [data-radio="500"]');
  await generar();
  tb = await lista(1);
  comprobar(tb.filter((x) => x.equipo === 'viper').length === 2 && tb.filter((x) => !x.par).length === 1, '(g) a rover planted by hand is kept when the base is generated', `(g) by hand + base: ${JSON.stringify(tb.filter((x) => x.equipo === 'viper'))}`);
  await pag.click('#asentamiento [data-a=limpiar]');
  await pag.waitForTimeout(400);
  tb = await lista(1);
  comprobar(tb.length === 1 && !tb[0].par, '(g) and Clear base leaves it alone', `(g) after Clear: ${JSON.stringify(tb)}`);
  await limpiar();

  // (i) tabla de prioridades: el taladro primero y lo demás alrededor
  await abrir();
  await generar();
  const optimo = await lista(1);
  await pag.click('#asentamiento [data-a=generar]');
  await pag.waitForSelector('dialog.as-dialogo[open]');
  const dlg0 = await pag.evaluate(() => { const d = document.querySelector('dialog.as-dialogo'), r = d.getBoundingClientRect(); return { modo: d.querySelector('[data-modo][aria-pressed=true]').dataset.modo, filas: [...d.querySelectorAll('tbody tr')].map((tr) => tr.dataset.id), centrado: Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2 && r.top > 0 && r.bottom < innerHeight, mueve: d.querySelectorAll('[data-mover]').length }; });
  comprobar(dlg0.modo === 'optimo' && dlg0.centrado && dlg0.filas.join() === piezas.map((p) => p.id).join() && dlg0.mueve === 0, '(i) the button opens the table in the middle of the screen; after an optimal layout it opens on Optimal, rows in rule order, nothing to move', `(i) dialog: ${JSON.stringify(dlg0)}`);
  await pag.click('dialog.as-dialogo [data-modo=prioridad]');
  await pag.click('dialog.as-dialogo tr[data-id="taladro_trident"] [data-mover=primero]');
  await pag.click('dialog.as-dialogo tr[data-id="torre_solar"] [data-mover="-1"]');
  const fa = await pag.locator('dialog.as-dialogo tr[data-id="viper"]').boundingBox(), fb = await pag.locator('dialog.as-dialogo tr[data-id="reactor_fision"]').boundingBox();
  await pag.locator('dialog.as-dialogo tr[data-id="viper"]').dragTo(pag.locator('dialog.as-dialogo tr[data-id="reactor_fision"]'));
  const dlg1 = await pag.evaluate(() => { const d = document.querySelector('dialog.as-dialogo'); return { filas: [...d.querySelectorAll('tbody tr')].map((tr) => tr.dataset.id), ancla: d.querySelector('tr.ancla')?.dataset.id, borrador: window.__az.asentamiento.dialogo.borrador.orden }; });
  const esperado = (() => { const o = piezas.map((p) => p.id); const mv = (id, k) => { o.splice(k, 0, ...o.splice(o.indexOf(id), 1)); }; mv('taladro_trident', 0); mv('torre_solar', o.indexOf('torre_solar') - 1); mv('viper', o.indexOf('reactor_fision')); return o; })();
  comprobar(!!fa && !!fb && dlg1.ancla === 'taladro_trident' && dlg1.filas.join() === esperado.join() && dlg1.borrador.join() === esperado.join(), `(i) rows move with First, with the arrows and by dragging: ${dlg1.filas.slice(0, 5).join(' > ')} …`, `(i) order: ${JSON.stringify(dlg1)} expected ${esperado}`);
  await pag.screenshot({ path: join(SALIDA, 'i-tabla-prioridades.png') });
  await pag.click('dialog.as-dialogo [data-a=ok]');
  await pag.waitForFunction(() => window.__az.asentamiento.estado.trabajando === false, null, { timeout: 180000 });
  await pag.waitForTimeout(900);
  const prio = await lista(1), prioT = await lista(0);
  const mediaA = (l, id) => { const a = l.find((x) => x.equipo === id); return l.filter((x) => x !== a).reduce((s, x) => s + Math.hypot(x.fila - a.fila, x.col - a.col) * geo[1].m, 0) / (l.length - 1); };
  const resI = await pag.evaluate(() => { const c = document.getElementById('asentamiento'), t = (e) => e.textContent.replace(/\s+/g, ' ').trim(), R = window.__az.asentamiento.estado.res; return { modo: R.modo, orden: R.orden, incumple: R.r.piezas.map((p) => [p.id, p.incumple]).filter((x) => x[1].length), estado: t(c.querySelector('[data-v=estado]')), filas: [...c.querySelectorAll('.as-tabla tbody tr')].map((tr) => [tr.dataset.pieza, t(tr.children[0]), t(tr.children[1])]), notas: t(c.querySelector('.as-notas')), numeros: [...document.querySelectorAll('.panel[data-lado=b] .marca.de-base')].map((d) => [+d.dataset.uid, +d.querySelector('.as-n').textContent]) }; });
  const num = new Map(resI.numeros), sepI = Math.hypot(prio.find((x) => x.equipo === 'reactor_fision').fila - prio.find((x) => x.equipo === 'habitat_superficie').fila, prio.find((x) => x.equipo === 'reactor_fision').col - prio.find((x) => x.equipo === 'habitat_superficie').col) * geo[1].m;
  comprobar(resI.modo === 'prioridad' && resI.orden.join() === esperado.join() && prio.length === optimo.length && prioT.length === prio.length && prio.every((x) => x.par === `base:1000:${x.equipo}:p${esperado.indexOf(x.equipo) + 1}` && num.get(x.uid) === esperado.indexOf(x.equipo) + 1) && prioT.every((x) => prio.some((y) => y.par === x.par)),
    `(i) generated by priority: ${prio.length} pieces in each world, numbered in the order asked, the rank kept in each piece's key`, `(i) priority: ${JSON.stringify({ modo: resI.modo, orden: resI.orden, pares: prio.map((x) => x.par), numeros: resI.numeros })}`);
  comprobar(mediaA(prio, 'taladro_trident') < mediaA(optimo, 'taladro_trident') && sepI >= 1000 && /around TRIDENT drill/.test(resI.estado) && /^1 TRIDENT drill/.test(resI.filas[0][1]) && /^Your first need: placed first/.test(resI.filas[0][2]) && resI.filas.some((f) => /pulled towards TRIDENT drill, your first need/.test(f[2])) && /Laid out by your priorities: TRIDENT drill was placed first/.test(resI.notas),
    `(i) the layout gathers around the drill (mean distance to it ${mediaA(prio, 'taladro_trident').toFixed(0)} m, was ${mediaA(optimo, 'taladro_trident').toFixed(0)} m in the optimal layout); reactor still ${sepI.toFixed(0)} m from the habitat; the bar and the table say whose order it is: "${resI.estado}"`, `(i) around the drill: ${mediaA(prio, 'taladro_trident')} vs ${mediaA(optimo, 'taladro_trident')}, reactor ${sepI} m, ${JSON.stringify(resI.filas.slice(0, 3))} "${resI.estado}" "${resI.notas}"`);
  console.log(`  (i) limits broken by priority: ${JSON.stringify(resI.incumple)}`);
  await pag.screenshot({ path: join(SALIDA, 'i-base-prioridad.png') });
  await pag.waitForTimeout(600);
  await abrir();
  await pag.click('#asentamiento [data-a=generar]');
  await pag.waitForSelector('dialog.as-dialogo[open]');
  const dlg2 = await pag.evaluate(() => { const d = document.querySelector('dialog.as-dialogo'); return { modo: d.querySelector('[data-modo][aria-pressed=true]').dataset.modo, filas: [...d.querySelectorAll('tbody tr')].map((tr) => tr.dataset.id), numeros: [...document.querySelectorAll('.panel[data-lado=b] .marca.de-base')].map((m) => +m.querySelector('.as-n').textContent).sort((a, b) => a - b).join() }; });
  comprobar(dlg2.modo === 'prioridad' && dlg2.filas.join() === esperado.join() && dlg2.numeros === piezas.map((_, i) => i + 1).join(), '(i) after a reload the table opens on the same priorities and the markers keep their numbers', `(i) after reload: ${JSON.stringify(dlg2)}`);
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(200);
  comprobar(await pag.evaluate(() => !document.querySelector('dialog.as-dialogo').open && window.__az.asentamiento.estado.trabajando === false), '(i) Esc closes the table without generating', '(i) Esc did not close the table');
  // Una pieza quitada a mano no corre los números de las demás al recargar.
  await pag.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('analog-zero.planted.')) { const d = JSON.parse(localStorage.getItem(k)); d.plantado = d.plantado.filter((x) => !/:p2$/.test(x.par ?? '')); localStorage.setItem(k, JSON.stringify(d)); } });
  await abrir();
  const hueco = await pag.evaluate(() => ({ numeros: [...document.querySelectorAll('.panel[data-lado=b] .marca.de-base .as-n')].map((b) => +b.textContent).sort((a, b) => a - b).join(), estado: document.querySelector('#asentamiento [data-v=estado]').textContent.replace(/\s+/g, ' '), filas: [...document.querySelectorAll('#asentamiento .as-tabla tbody tr')].map((tr) => `${tr.querySelector('.as-n').textContent}:${tr.dataset.pieza}`) }));
  comprobar(hueco.numeros === piezas.map((_, i) => i + 1).filter((k) => k !== 2).join() && /around TRIDENT drill/.test(hueco.estado) && hueco.filas.every((f) => +f.split(':')[0] === esperado.indexOf(f.split(':')[1]) + 1), `(i) with piece 2 removed by hand, the others keep their numbers after a reload (${hueco.numeros})`, `(i) numbers after removing one: ${JSON.stringify(hueco)}`);
  await pag.click('#asentamiento [data-a=limpiar]');
  await pag.waitForTimeout(400);
  await limpiar();

  // (h) simulación con el lugar del usuario (teselas en línea)
  if (!SIN_VIVO) {
    // El punto elegido cae dentro del terreno de Shackleton, lejos de su centro: la base se centra en él.
    const PUNTO_H = { lat: -89.5, lon: 120 };
    const sim = (lat, lon) => `?lugar=${lat}%2C${lon}&nombre=Test+place&b=shackleton&punto=${PUNTO_H.lat}%2C${PUNTO_H.lon}&mundo=moon&vista=suelo`;
    await abrir(sim('75.2500', '-84.2500'));
    const aviso = await pag.evaluate(() => window.__az.avisoLugar ?? null);
    if (aviso) console.log(`skip (h) no network for the Earth tiles: ${aviso}`);
    else {
      comprobar((await lista(0)).length === 0 && (await lista(1)).length === 0, '(h) a simulation opens with nothing planted', `(h) planted on entry: ${JSON.stringify(await lista(1))}`);
      const pre = await pag.evaluate(() => ({ suelo: window.__az.paneles.map((p) => !!p.escena?.suelo), estado: document.querySelector('#asentamiento [data-v=estado]').textContent }));
      comprobar(pre.suelo[0] && /around your point/.test(pre.estado), `(h) entered at ground level; the bar speaks of "your point"`, `(h) entry: ${JSON.stringify(pre)}`);
      await generar();
      const s1 = await pag.evaluate(() => ({ n: window.__az.paneles.map((p) => p.plantados.lista.length), suelo: window.__az.paneles.map((p) => !!p.escena.suelo), claves: Object.keys(localStorage).filter((k) => k.startsWith('analog-zero.planted.')), estado: document.querySelector('#asentamiento [data-v=estado]').textContent.replace(/\s+/g, ' ') }));
      comprobar(s1.n[0] > 0 && s1.n[0] === s1.n[1] && s1.suelo.every((x) => !x) && s1.claves.length === 2 && s1.claves.every((k) => /@lugar_75\.2500_-84\.2500_\d+km~shackleton~-89\.5000_120\.0000$/.test(k)), `(h) base generated in the simulation (${s1.n[1]} pieces per world), saved under this pair of places: "${s1.estado}"`, `(h) simulation: ${JSON.stringify(s1)}`);
      const cen = await pag.evaluate(async (P) => {
        const { latLonAPixel } = await import('./georef.js');
        const [t, l] = window.__az.paneles, c = latLonAPixel(l.escena.meta, P.lat, P.lon), k = (l.escena.n - 1) / 2, kt = (t.escena.n - 1) / 2, R = window.__az.asentamiento.estado.res;
        const dl = l.plantados.lista.map((x) => Math.hypot(x.fila - c.fila, x.col - c.col) * l.escena.m), dt = t.plantados.lista.map((x) => Math.hypot(x.fila - kt, x.col - kt) * t.escena.m);
        const hab = (p) => p.plantados.lista.find((x) => x.equipo === 'habitat_superficie');
        return { lejos_m: Math.hypot(c.fila - k, c.col - k) * l.escena.m, maxLuna: Math.max(...dl), maxTierra: Math.max(...dt), radio: R.radio_m, mT: t.escena.m, centro: R.r.centro, c, habL: Math.hypot(hab(l).fila - c.fila, hab(l).col - c.col) * l.escena.m, habT: Math.hypot(hab(t).fila - kt, hab(t).col - kt) * t.escena.m };
      }, PUNTO_H);
      comprobar(cen.lejos_m > 2000 && Math.abs(cen.centro.fila - cen.c.fila) < 1e-9 && Math.abs(cen.centro.col - cen.c.col) < 1e-9 && cen.maxLuna <= cen.radio + 1e-6 && cen.maxTierra <= cen.radio + cen.mT && /of your point/.test(s1.estado),
        `(h) the base is centred on the chosen point, ${(cen.lejos_m / 1000).toFixed(1)} km from the centre of the Moon window: farthest piece ${cen.maxLuna.toFixed(0)} m from the point on the Moon, ${cen.maxTierra.toFixed(0)} m from the place on Earth; habitat ${cen.habL.toFixed(0)} m and ${cen.habT.toFixed(0)} m`, `(h) centre: ${JSON.stringify(cen)} "${s1.estado}"`);
      await pag.screenshot({ path: join(SALIDA, 'h-simulacion.png') });
      await pag.click('.panel[data-lado=a] .suelo');
      await pag.waitForTimeout(1200);
      await pag.screenshot({ path: join(SALIDA, 'h-simulacion-suelo.png') });
      await pag.waitForTimeout(500);
      await abrir(sim('75.7500', '-84.2500'));
      const otra = [await lista(0), await lista(1)];
      comprobar(otra[0].length === 0 && otra[1].length === 0, '(h) another simulation with the same Moon terrain starts empty: nothing carried over', `(h) carried over: ${JSON.stringify(otra)}`);
      await abrir(sim('75.2500', '-84.2500'));
      const vuelta = [await lista(0), await lista(1)];
      comprobar(vuelta[0].length === s1.n[0] && vuelta[1].length === s1.n[1], '(h) back in the first simulation its base is still there', `(h) back: ${vuelta[0].length} ${vuelta[1].length}`);
      await limpiar();
    }
  }
} catch (e) {
  fallos.push(`script: ${e.message}`); console.error(e);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `\n${fallos.length} FAILED` : '\nall ok');
process.exit(fallos.length ? 1 : 0);

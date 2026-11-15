// Recorrido del día en el visor (Chromium), Haughton + Shackleton del catálogo (sin red):
// (a) barra «Day» visible y sin mover nada hasta que se usa; (b) a una hora, el sol de cada panel = sol.js en node;
// (c) diciembre a 75° N: noche, nada con sol; (d) «Same 24 hours»: el sol lunar casi no se mueve; (e) sombra del equipo a
// ras de suelo = alto ÷ tan(altura); (f) tira del día = barrido de sombras en node; (g) la ficha del gemelo gana la fila del
// día; (h) Play avanza y se para; (i) mover el sol a mano suelta el recorrido; (j) si cambia el terreno, la tira se recalcula.
// Uso: node scripts/captura_dia.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import { solTierra, solPolar, DIA_LUNAR_H, largoSombra } from '../web/terreno/sol.js';
import { sombras, sobrePlanoTangente } from '../web/terreno/calculo.js';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const WEB = join(RAIZ, 'web');
const SALIDA = join(RAIZ, 'capturas', 'dia');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const fallos = [];
const comprobar = (cond, bien, mal) => { if (cond) console.log(`ok   ${bien}`); else { fallos.push(mal); console.error(`FAIL ${mal}`); } };
const cerca = (a, b, tol) => Math.abs(a - b) <= tol;

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
const pag = await nav.newPage({ viewport: { width: 1600, height: 900 } });
pag.on('console', (m) => { if (m.type() === 'error') { fallos.push(`console: ${m.text()}`); console.error(`FAIL console: ${m.text()}`); } });
pag.on('pageerror', (e) => { fallos.push(`page error: ${e.message}`); console.error(`FAIL page error: ${e.message}`); });
const limpiar = () => pag.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('analog-zero.planted.')) localStorage.removeItem(k); });
const abrir = async (q = '') => {
  await pag.goto(`${base}/terreno/index.html?a=haughton&b=shackleton${q}`);
  await pag.waitForFunction(() => window.__az?.listo === true, null, { timeout: 120000 });
  await pag.waitForTimeout(600);
};
const ir = async (h) => {
  await pag.evaluate((h) => window.__az.dia.ir(h), h);
  await pag.waitForFunction(() => window.__az.dia.listo(), null, { timeout: 180000 });
  await pag.waitForTimeout(500);
};
const lectura = () => pag.evaluate(() => ({
  txt: [...document.querySelectorAll('.dia-lectura')].map((d) => d.querySelector('.dia-texto').textContent.replace(/\s+/g, ' ').trim()),
  tira: [...document.querySelectorAll('.dia-lectura')].map((d) => { const t = d.querySelector('.dia-tira'); return t.hidden ? null : { txt: t.textContent.replace(/\s+/g, ' ').trim(), celdas: [...t.querySelectorAll('.celdas i')].map((i) => i.className.split(' ')[0]) }; }),
  sol: window.__az.paneles.map((p) => ({ ...p.escena.sol, luzDia: p.escena.luzDia, frac: p.escena.fraccionConSol() })),
  mandos: window.__az.paneles.map((p) => ({ az: p.el.querySelector('.mandos [data-v=az]').textContent, el: p.el.querySelector('.mandos [data-v=el]').textContent })),
  activo: window.__az.dia.estado.activo, hora: window.__az.dia.estado.hora,
}));

try {
  await abrir('&mes=7');
  await limpiar();
  await abrir('&mes=7');
  const meta = await pag.evaluate(() => window.__az.paneles.map((p) => ({ lat: p.escena.meta.centro.lat, n: p.escena.n, m: p.escena.m, R: p.escena.meta.georef.radio_m })));
  let L = await lectura();
  comprobar(await pag.isVisible('#dia') && !L.activo && L.txt.every((t) => /Sun set by hand in Display/.test(t)) && L.sol[0].az === 315 && L.sol[0].el === 30, '(a) Day bar is there and has not moved the Sun yet', `(a) at start: ${JSON.stringify(L)}`);
  comprobar(await pag.$eval('#dia [data-a=mes]', (s) => s.value) === '7', '(a) the month of the URL is selected (July)', '(a) month select is not July');
  await pag.screenshot({ path: join(SALIDA, 'a-inicio.png') });

  // (b) hora 10
  await ir(10);
  L = await lectura();
  const t10 = solTierra({ lat: meta[0].lat, mes: 7, hora: 10 }), l10 = solPolar({ az0: 315, el: 1.5, horas: (10 / 24) * DIA_LUNAR_H });
  comprobar(cerca(L.sol[0].az, t10.az, 1e-6) && cerca(L.sol[0].el, t10.el, 1e-6), `(b) Earth Sun at 10:00 in July = node: ${t10.el.toFixed(2)}° high, bearing ${t10.az.toFixed(1)}°`, `(b) Earth Sun ${JSON.stringify(L.sol[0])} vs node ${JSON.stringify(t10)}`);
  comprobar(cerca(L.sol[1].az, l10.az, 1e-6) && L.sol[1].el === 1.5, `(b) Moon Sun after 10/24 of a lunar day = node: grid azimuth ${l10.az.toFixed(1)}°`, `(b) Moon Sun ${JSON.stringify(L.sol[1])} vs node ${JSON.stringify(l10)}`);
  comprobar(/10:00 local solar time · July/.test(L.txt[0]) && new RegExp(`Sun ${t10.el.toFixed(1)}° above the horizon`).test(L.txt[0]) && /Earth day 12\.3 of 29\.53/.test(L.txt[1]), `(b) readouts: "${L.txt[0]}" | "${L.txt[1]}"`, `(b) readouts: ${JSON.stringify(L.txt)}`);
  comprobar(L.mandos[0].el === `${t10.el.toFixed(1)}°` && L.mandos[0].az === `${Math.round(t10.az)}°`, `(b) Display sliders follow: ${L.mandos[0].az}, ${L.mandos[0].el}`, `(b) Display sliders: ${JSON.stringify(L.mandos)}`);
  comprobar(L.tira.every((t) => t === null), '(b) no strip while nothing is planted', `(b) strips: ${JSON.stringify(L.tira)}`);

  // equipo: torre solar en la Luna → gemelo en la Tierra
  await pag.click('.panel[data-lado=b] .ver-paleta');
  await pag.click('.panel[data-lado=b] .paleta [data-eq=torre_solar]');
  const c = await pag.locator('.panel[data-lado=b] .lienzo canvas').first().boundingBox();
  await pag.mouse.click(c.x + c.width / 2 - 120, c.y + c.height / 2 - 150);
  await pag.waitForTimeout(500);
  await ir(10);
  L = await lectura();
  const items = await pag.evaluate(() => window.__az.paneles.map((p) => { const it = p.plantados.lista[0]; return it && { fila: it.fila, col: it.col, uid: it.uid }; }));
  comprobar(items.every(Boolean) && L.tira.every((t) => t && t.celdas.length === 24), `(f) a 24-step strip per panel: "${L.tira[0]?.txt}" | "${L.tira[1]?.txt}"`, `(f) strips: ${JSON.stringify(L.tira)}`);
  // (f) la misma tira en node
  for (const i of [0, 1]) {
    const alt = Float32Array.from(await pag.evaluate((i) => Array.from(window.__az.paneles[i].escena.mostradas), i));
    const h = sobrePlanoTangente(alt, meta[i].n, meta[i].m, meta[i].R);
    const esperado = Array.from({ length: 24 }, (_, k) => {
      const s = i === 0 ? solTierra({ lat: meta[0].lat, mes: 7, hora: k + 0.5 }) : solPolar({ az0: 315, el: 1.5, horas: ((k + 0.5) / 24) * DIA_LUNAR_H });
      if (!(s.el > 0)) return 'noche';
      return sombras(h, meta[i].n, meta[i].m, s.az, s.el)[items[i].fila * meta[i].n + items[i].col] === 255 ? 'sol' : 'sombra';
    });
    const n = esperado.filter((x) => x === 'sol').length;
    comprobar(JSON.stringify(esperado) === JSON.stringify(L.tira[i].celdas) && new RegExp(`${n} of 24`).test(L.tira[i].txt), `(f) ${i ? 'Moon' : 'Earth'} strip = node shadow sweep: ${n} of 24 sunlit`, `(f) ${i ? 'Moon' : 'Earth'} strip ${L.tira[i].celdas.join(',')} vs node ${esperado.join(',')}`);
  }
  // (g) la ficha del gemelo
  const filaDia = await pag.evaluate(() => { const tr = document.querySelector('.panel[data-lado=b] .hoja [data-espejo] tr[data-fila=dia]'); return tr ? [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim()) : null; });
  comprobar(filaDia && /of 24 steps of 29\.5 h/.test(filaDia[1]) && /of 24 hours/.test(filaDia[2]), `(g) twin sheet row: ${filaDia?.join(' | ')}`, `(g) no "day" row in the twin sheet: ${JSON.stringify(filaDia)}`);
  await pag.screenshot({ path: join(SALIDA, 'b-hora-10.png') });

  // (e) sombra del equipo a ras de suelo en la Tierra
  await pag.click('.panel[data-lado=a] .suelo');
  await pag.waitForTimeout(700);
  await ir(10);
  const sombra = await pag.evaluate(() => { const p = window.__az.paneles[0]; p.modelos.sincronizar(p.plantados.lista); return p.modelos.instancias()[0]; });
  const teorica = largoSombra(sombra.tam[1], t10.el);
  comprobar(sombra.sombra?.visible && sombra.sombra.dibujada_m > 0 && sombra.sombra.dibujada_m <= teorica * 1.001, `(e) tower shadow drawn at ground level: ${sombra.sombra?.dibujada_m.toFixed(1)} m (flat-ground length ${teorica.toFixed(1)} m; shorter = cut by rising ground)`, `(e) shadow ${JSON.stringify(sombra.sombra)} vs ${teorica}`);
  comprobar(new RegExp(`on flat ground its shadow is ${teorica.toFixed(0)} m long`).test((await lectura()).txt[0]), '(e) the readout gives the flat-ground shadow length', `(e) readout: ${(await lectura()).txt[0]}`);
  await pag.screenshot({ path: join(SALIDA, 'e-sombra-suelo.png') });
  const nota = await pag.evaluate(() => window.__az.paneles[0].modelos.nota());
  comprobar(/equipment shadows: a strip as wide as the item/.test(nota ?? ''), '(e) the canvas note says what the shadow is', `(e) note: ${nota}`);

  // (c) diciembre
  await pag.selectOption('#dia [data-a=mes]', '12');
  await ir(12);
  L = await lectura();
  const t12 = solTierra({ lat: meta[0].lat, mes: 12, hora: 12 });
  comprobar(t12.el < 0 && cerca(L.sol[0].el, t12.el, 1e-6) && L.sol[0].frac === 0 && L.sol[0].luzDia < 1, `(c) December noon at 75° N: Sun ${t12.el.toFixed(1)}°, nothing sunlit, scene dimmed to ${L.sol[0].luzDia.toFixed(2)}`, `(c) December: ${JSON.stringify(L.sol[0])} vs ${JSON.stringify(t12)}`);
  comprobar(/below the horizon: night/.test(L.txt[0]) && /in the dark/.test(L.txt[0]) && L.tira[0].celdas.every((x) => x === 'noche') && /0 of 24/.test(L.tira[0].txt), `(c) readout: "${L.txt[0]}" · strip all night`, `(c) readout ${L.txt[0]} strip ${L.tira[0]?.celdas}`);
  const sombraNoche = await pag.evaluate(() => { const p = window.__az.paneles[0]; p.modelos.sincronizar(p.plantados.lista); return p.modelos.instancias()[0].sombra; });
  comprobar(sombraNoche.visible === false, '(c) no equipment shadow at night', `(c) shadow at night: ${JSON.stringify(sombraNoche)}`);
  await pag.screenshot({ path: join(SALIDA, 'c-noche-polar.png') });

  // (d) mismas 24 horas
  await pag.selectOption('#dia [data-a=mes]', '7');
  await pag.click('#dia [data-modo=mismo]');
  await ir(10);
  L = await lectura();
  const lm = solPolar({ az0: 315, el: 1.5, horas: 10 });
  comprobar(cerca(L.sol[1].az, lm.az, 1e-6) && /10\.0 h later: the Sun has gone 5\.1° round the horizon/.test(L.txt[1]), `(d) same 24 hours: Moon grid azimuth ${lm.az.toFixed(2)}° — "${L.txt[1]}"`, `(d) ${JSON.stringify(L.sol[1])} "${L.txt[1]}"`);
  await pag.click('#dia [data-modo=propio]');

  // (h) Play
  await ir(0);
  await pag.click('#dia [data-a=play]');
  await pag.waitForTimeout(2500);
  const enMarcha = await pag.evaluate(() => ({ hora: window.__az.dia.estado.hora, anim: !!window.__az.dia.estado.anim, boton: document.querySelector('#dia [data-a=play]').textContent }));
  await pag.click('#dia [data-a=play]');
  await pag.waitForTimeout(300);
  const parado = await pag.evaluate(() => ({ hora: window.__az.dia.estado.hora, anim: !!window.__az.dia.estado.anim, boton: document.querySelector('#dia [data-a=play]').textContent }));
  comprobar(enMarcha.anim && enMarcha.hora > 0.3 && /Pause/.test(enMarcha.boton) && !parado.anim && /Play/.test(parado.boton), `(h) Play ran to ${enMarcha.hora.toFixed(1)} h in 2.5 s and paused at ${parado.hora.toFixed(1)} h`, `(h) play ${JSON.stringify(enMarcha)} pause ${JSON.stringify(parado)}`);

  // (j) el terreno cambia (vista Original): la tira se vuelve a calcular sola, no se queda esperando
  await ir(10);
  await pag.evaluate(() => document.querySelector('.panel[data-lado=a] .retoque [data-ver=original]').click());
  const colgada = await pag.waitForFunction(() => window.__az.dia.listo(), null, { timeout: 60000 }).then(() => false, () => true);
  await pag.waitForTimeout(300);
  L = await lectura();
  comprobar(!colgada && L.tira[0]?.celdas.length === 24 && !/working out/.test(L.tira[0].txt), `(j) after switching the terrain to Original the strip is worked out again: "${L.tira[0]?.txt}"`, `(j) strip after a terrain change: ${JSON.stringify(L.tira[0])}`);
  await pag.evaluate(() => document.querySelector('.panel[data-lado=a] .retoque [data-ver=retocado]').click());
  await pag.waitForFunction(() => window.__az.dia.listo(), null, { timeout: 60000 });

  // (i) a mano
  await pag.$eval('.panel[data-lado=a] .mandos [data-sol=el]', (i) => { i.value = 55; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await pag.waitForTimeout(400);
  L = await lectura();
  comprobar(!L.activo && L.sol[0].el === 55 && /Sun set by hand in Display \(55\.0° high\)/.test(L.txt[0]), `(i) moving the Earth Sun by hand releases the day: "${L.txt[0]}"`, `(i) by hand: ${JSON.stringify(L)}`);

  // móvil: la barra no desborda
  await pag.setViewportSize({ width: 390, height: 844 });
  await pag.waitForTimeout(600);
  const desborda = await pag.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  comprobar(!desborda, '(mobile) no horizontal overflow at 390 px', '(mobile) the page overflows sideways at 390 px');
  await pag.screenshot({ path: join(SALIDA, 'movil-390.png') });
  await limpiar();
} catch (e) {
  fallos.push(`script: ${e.message}`); console.error(e);
} finally {
  await nav.close();
  servidor.close();
}
console.log(fallos.length ? `\n${fallos.length} FAILED` : '\nall ok');
process.exit(fallos.length ? 1 : 0);
